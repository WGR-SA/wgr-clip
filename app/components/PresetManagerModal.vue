<script setup lang="ts">
import type { MediaKind } from '~/types/job'
import { describeUserPreset } from '~/utils/userPresets'

const userPresets = useUserPresets()
const open = userPresets.managerOpen

const kindIcon: Record<MediaKind, string> = {
  video: 'i-lucide-film',
  image: 'i-lucide-image',
  audio: 'i-lucide-music'
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Presets importés"
    description="Réglages nommés chargés depuis un fichier JSON. Ils apparaissent dans les menus de leur type et restent disponibles au prochain lancement."
    :ui="{ content: 'manager' }"
  >
    <template #body>
      <ul
        v-if="userPresets.presets.value.length > 0"
        class="manager__list"
      >
        <li
          v-for="p in userPresets.presets.value"
          :key="p.id"
          class="manager__row"
        >
          <UIcon
            :name="kindIcon[p.kind]"
            class="manager__icon"
          />
          <span class="manager__text">
            <strong class="manager__name">{{ p.name }}</strong>
            <span class="manager__hint">{{ describeUserPreset(p) }} · suffixe <code>_{{ p.id }}</code></span>
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
        class="manager__empty"
      >
        Aucun preset importé pour l'instant.
      </p>
    </template>

    <template #footer>
      <UButton
        icon="i-lucide-file-json-2"
        label="Importer un fichier JSON…"
        color="neutral"
        variant="outline"
        @click="userPresets.importFromFile()"
      />
    </template>
  </UModal>
</template>

<style scoped>
.manager__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.manager__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0;
  border-top: 1px solid #2a2a2a;
}

.manager__row:first-child {
  border-top: 0;
  padding-top: 0;
}

.manager__icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  color: var(--color-icterine-400);
}

.manager__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.manager__name {
  font-size: 0.82rem;
  color: #FDF7F1;
}

.manager__hint {
  font-size: 0.72rem;
  color: #888;
  line-height: 1.3;
}

.manager__hint code {
  font-size: 0.7rem;
  color: #aaa;
}

.manager__empty {
  margin: 0;
  font-size: 0.8rem;
  color: #888;
}
</style>
