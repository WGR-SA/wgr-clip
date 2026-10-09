<script setup lang="ts">
import { basename } from '~/utils/format'
import { KIND_ICON } from '~/utils/mediaKind'
import { describeUserPreset } from '~/utils/userPresets'

const open = defineModel<boolean>('open', { required: true })

const queue = useTranscodeQueue()
const userPresets = useUserPresets()

const destLabel = computed(() => {
  const d = queue.outputDir.value
  if (!d) return 'Même dossier que la source'
  return basename(d) || d
})
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Réglages"
    description="Destination des fichiers convertis et presets importés."
  >
    <template #body>
      <section class="settings__block">
        <h3 class="settings__title">
          Destination
        </h3>
        <button
          type="button"
          class="settings__dest"
          :title="queue.outputDir.value ?? 'Même dossier que le fichier d\'entrée'"
          @click="queue.pickOutputDir()"
        >
          <UIcon
            name="i-lucide-folder-output"
            class="settings__dest-icon"
          />
          <strong class="settings__dest-label">{{ destLabel }}</strong>
        </button>
      </section>

      <section class="settings__block">
        <h3 class="settings__title">
          Presets importés
        </h3>
        <p class="settings__hint">
          Réglages nommés chargés depuis un fichier JSON. Ils apparaissent dans les menus de leur type et restent disponibles au prochain lancement.
        </p>
        <ul
          v-if="userPresets.presets.value.length > 0"
          class="settings__list"
        >
          <li
            v-for="p in userPresets.presets.value"
            :key="p.id"
            class="settings__row"
          >
            <UIcon
              :name="KIND_ICON[p.kind]"
              class="settings__row-icon"
            />
            <span class="settings__row-text">
              <strong class="settings__row-name">{{ p.name }}</strong>
              <span class="settings__row-hint">{{ describeUserPreset(p) }} · suffixe <code>_{{ p.id }}</code></span>
            </span>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Supprimer ${p.name}`"
              @click="userPresets.remove(p.id)"
            />
          </li>
        </ul>
        <p
          v-else
          class="settings__hint"
        >
          Aucun preset importé pour l'instant.
        </p>
        <UButton
          icon="i-lucide-file-json-2"
          label="Importer un fichier JSON…"
          color="neutral"
          variant="outline"
          size="xs"
          @click="userPresets.importFromFile()"
        />
      </section>
    </template>
  </USlideover>
</template>

<style scoped>
.settings__block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #2a2a2a;
}

.settings__block:last-child {
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 0;
}

.settings__title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #888;
  margin: 0;
}

.settings__hint {
  font-size: 0.75rem;
  color: #888;
  line-height: 1.4;
  margin: 0;
}

.settings__dest {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.8rem;
  color: inherit;
  max-width: 100%;
}

.settings__dest:hover {
  border-color: #3a3a3a;
}

.settings__dest-icon {
  width: 0.9rem;
  height: 0.9rem;
  color: var(--color-icterine-400);
  flex-shrink: 0;
}

.settings__dest-label {
  color: #FDF7F1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings__list {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.settings__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-top: 1px solid #2a2a2a;
}

.settings__row:first-child {
  border-top: 0;
  padding-top: 0;
}

.settings__row-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  color: var(--color-icterine-400);
}

.settings__row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.settings__row-name {
  font-size: 0.82rem;
  color: #FDF7F1;
}

.settings__row-hint {
  font-size: 0.72rem;
  color: #888;
  line-height: 1.3;
}

.settings__row-hint code {
  font-size: 0.7rem;
  color: #aaa;
}
</style>
