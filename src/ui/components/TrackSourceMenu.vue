<script setup lang="ts">
import { t } from '../i18n'
import { ref } from 'vue'
import type { MidiTrack } from '../../shared/model'
import { useSourcesStore } from '../stores/sources'
import EditorPopover from './EditorPopover.vue'
const props = defineProps<{ track: MidiTrack }>(),
  emit = defineEmits<{ error: [reason: unknown] }>()
const sources = useSourcesStore(),
  anchor = ref<{ right: number; top: number } | null>(null)
function open(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  anchor.value = { right: rect.right, top: rect.bottom }
}
async function run(action: 'export' | 'discard' | 'detach'): Promise<void> {
  anchor.value = null
  try {
    if (action === 'export') await sources.exportForScore(props.track.id)
    else if (action === 'detach') sources.detach(props.track.id)
    else if (props.track.link)
      await sources.sync(props.track.link.sourceId, props.track.id)
  } catch (error) {
    emit('error', error)
  }
}
</script>
<template>
  <button
    class="btn btn-sm btn-ghost xm-source-menu"
    :aria-label="`${track.name} score actions`"
    :title="t('trackSourceMenu.scoreActions')"
    @click="open"
  >
    <i class="bi bi-three-dots" />
  </button>
  <EditorPopover
    v-if="anchor"
    :anchor="anchor"
    :title="t('trackSourceMenu.scoreActions')"
    style="width: 280px"
    @close="anchor = null"
  >
    <div class="d-grid gap-1">
      <button
        class="btn btn-xm text-start"
        @click="run('export')"
      >
        {{ t('menu.exportMidiForMusescore') }}
      </button><button
        v-if="track.link"
        class="btn btn-xm text-start"
        :disabled="sources.busy[track.link.sourceId]"
        @click="run('discard')"
      >
        {{ t('trackSourceMenu.discardReSync') }}
      </button><button
        v-if="track.link"
        class="btn btn-ghost text-start"
        @click="run('detach')"
      >
        {{ t('trackSourceMenu.detach') }}
      </button>
    </div>
  </EditorPopover>
</template>
