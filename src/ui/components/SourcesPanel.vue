<script setup lang="ts">
import { t } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useSourcesStore } from '../stores/sources'
const doc = useProjectStore(),
  sources = useSourcesStore()
const emit = defineEmits<{ error: [reason: unknown] }>()
function modified(id: string): number { return doc.project.tracks.filter(t => t.kind === 'midi' && t.link?.sourceId === id && t.link.state === 'ahead').length }
async function open(file: string): Promise<void> {
  try {
    await window.xm.scores.open(file)
  } catch (error) {
    emit('error', error)
  }
}
</script>
<template>
  <div class="xm-sources">
    <div
      v-for="source in doc.project.sources"
      :key="source.id"
      class="xm-source-row"
    >
      <div class="xm-list">
        <div class="xm-source-summary">
          <i class="bi bi-file-earmark-music" /><div class="flex-grow-1 overflow-hidden">
            <b
              class="d-block text-truncate"
              :title="source.file"
            >{{ source.file }}</b><span
              class="xm-badge"
              :class="source.error ? 'is-orphan' : source.lastSync ? 'is-synced' : 'is-ahead'"
            >{{ sources.busy[source.id] ? 'syncing…' : source.error ? 'error' : source.lastSync ? `synced ${new Date(source.lastSync).toLocaleTimeString()}` : 'not synced' }}</span> <span
              v-if="modified(source.id)"
              class="xm-badge is-ahead"
            >{{ modified(source.id) }} {{ t('sourcesPanel.modifiedHere') }}</span><small class="xm-faint d-block">{{ doc.project.mapOwner === source.id ? 'Owns tempo, time and key' : 'Notes only' }}</small>
          </div>
        </div>
      </div>
      <p
        v-if="source.error"
        class="xm-banner mt-2"
        role="alert"
      >
        {{ source.error }}
      </p>
      <div class="d-flex flex-wrap gap-1 mt-2">
        <button
          class="btn btn-sm btn-xm"
          :disabled="sources.busy[source.id]"
          @click="sources.sync(source.id)"
        >
          {{ t('sourcesPanel.reSync') }}
        </button><button
          class="btn btn-sm btn-ghost"
          @click="open(source.file)"
        >
          {{ t('sourcesPanel.openInMuseScore') }}
        </button><button
          class="btn btn-sm btn-ghost text-danger"
          @click="sources.unlink(source.id)"
        >
          {{ t('sourcesPanel.unlink') }}
        </button>
      </div>
    </div>
    <button
      v-if="doc.project.sources.length"
      class="btn btn-sm btn-xm mb-2"
      @click="sources.exportForScore().catch(emit.bind(null, 'error'))"
    >
      {{ t('menu.exportMidiForMusescore') }}
    </button>
    <span
      v-if="!doc.project.sources.length"
      class="xm-faint"
    >{{ t('sourcesPanel.noLinkedScores') }}</span>
    <button
      class="btn btn-sm btn-ghost mt-2"
      @click="sources.link().catch(emit.bind(null, 'error'))"
    >
      {{ t('sourcesPanel.linkScore') }}
    </button>
  </div>
</template>
