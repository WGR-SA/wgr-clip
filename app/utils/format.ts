export function formatDuration (totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—'
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function formatPercent (p: number): string {
  if (!Number.isFinite(p)) return '0%'
  return `${Math.round(p * 100)}%`
}

export function formatSpeed (s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—'
  return `${s.toFixed(2)}×`
}

export function basename (path: string): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const i = path.lastIndexOf(sep)
  return i >= 0 ? path.slice(i + 1) : path
}

export function dirname (path: string): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const i = path.lastIndexOf(sep)
  return i >= 0 ? path.slice(0, i) : path
}
