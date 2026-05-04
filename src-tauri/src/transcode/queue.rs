use super::{encoder, Job, JobStatus, Preset};
use crate::hw_accel::HwAccel;
use dashmap::DashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// Single-worker job queue. Concurrency is configurable via the semaphore but
/// defaults to 1 to avoid CPU thrashing on long encodes.
pub struct JobQueue {
    pub jobs: Arc<DashMap<Uuid, Job>>,
    pub cancels: Arc<DashMap<Uuid, CancellationToken>>,
    tx: mpsc::UnboundedSender<Uuid>,
}

impl JobQueue {
    pub fn new(app: AppHandle, hw_accel: Arc<parking_lot::RwLock<HwAccel>>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<Uuid>();
        let jobs: Arc<DashMap<Uuid, Job>> = Arc::new(DashMap::new());
        let cancels: Arc<DashMap<Uuid, CancellationToken>> = Arc::new(DashMap::new());
        let semaphore = Arc::new(Semaphore::new(1));

        let jobs_w = jobs.clone();
        let cancels_w = cancels.clone();
        let app_w = app.clone();

        // Spawn the dispatcher loop on the Tokio runtime that backs Tauri's async commands.
        tauri::async_runtime::spawn(async move {
            while let Some(id) = rx.recv().await {
                let permit = match semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => break,
                };

                let cancel = CancellationToken::new();
                cancels_w.insert(id, cancel.clone());

                // Snapshot job inputs before mutating
                let (input, output, preset) = match jobs_w.get(&id) {
                    Some(j) => (j.input.clone(), j.output.clone(), j.preset),
                    None => {
                        drop(permit);
                        cancels_w.remove(&id);
                        continue;
                    }
                };

                if let Some(mut j) = jobs_w.get_mut(&id) {
                    j.status = JobStatus::Encoding;
                }

                let hw = *hw_accel.read();
                let result =
                    encoder::run_job(app_w.clone(), id, &input, &output, preset, hw, cancel.clone())
                        .await;

                if let Some(mut j) = jobs_w.get_mut(&id) {
                    match &result {
                        Ok(outcome) => {
                            j.status = JobStatus::Done;
                            j.progress = 1.0;
                            j.stderr_tail = outcome.stderr_tail.clone();
                            j.error = None;
                        }
                        Err(crate::errors::JobError::Cancelled) => {
                            j.status = JobStatus::Cancelled;
                            j.error = Some(crate::errors::JobError::Cancelled);
                        }
                        Err(e) => {
                            j.status = JobStatus::Error;
                            j.error = Some(e.clone());
                        }
                    }
                }

                cancels_w.remove(&id);
                drop(permit);
            }
        });

        Self {
            jobs,
            cancels,
            tx,
        }
    }

    pub fn enqueue(&self, input: PathBuf, output: PathBuf, preset: Preset) -> Uuid {
        let job = Job::new(input, output, preset);
        let id = job.id;
        self.jobs.insert(id, job);
        let _ = self.tx.send(id);
        id
    }

    pub fn cancel(&self, id: Uuid) {
        if let Some(token) = self.cancels.get(&id) {
            token.cancel();
        }
        if let Some(mut j) = self.jobs.get_mut(&id) {
            if j.status == JobStatus::Pending {
                // Hadn't started yet — flip status directly so UI reacts.
                j.status = JobStatus::Cancelled;
                j.error = Some(crate::errors::JobError::Cancelled);
            }
        }
    }

    pub fn cancel_all(&self) {
        for entry in self.cancels.iter() {
            entry.value().cancel();
        }
        for mut entry in self.jobs.iter_mut() {
            if entry.status == JobStatus::Pending {
                entry.status = JobStatus::Cancelled;
                entry.error = Some(crate::errors::JobError::Cancelled);
            }
        }
    }
}
