<script setup lang="ts">
import { t } from '../i18n'
import { nextTick, ref, watch } from 'vue'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { useProjectStore } from '../stores/project'
import { useScriptStore } from '../stores/script'
const runtime = useRuntimeStore(),
  settings = useSettingsStore(),
  doc = useProjectStore()
const dialog = ref<HTMLDialogElement>(),
  pending = ref<{ hash: string; folder: string } | null>(null),
  busy = ref(false),
  error = ref('')
const dismissed = new Set<string>()
watch(
  () => useScriptStore().trustRequest,
  () => dismissed.clear(),
  { flush: 'sync' },
)
watch(
  () => doc.folder,
  () => {
    pending.value = null
    dialog.value?.close()
  },
)
watch(
  () => runtime.scriptStatus,
  async (status) => {
    if (status.state !== 'untrusted') {
      pending.value = null
      dialog.value?.close()
      return
    }
    const key = `${doc.folder}|${status.hash}`
    if (dismissed.has(key)) return
    pending.value = { hash: status.hash, folder: doc.folder }
    error.value = ''
    await nextTick()
    dialog.value?.showModal()
  },
)
function reject(): void {
  if (pending.value)
    dismissed.add(`${pending.value.folder}|${pending.value.hash}`)
  pending.value = null
  dialog.value?.close()
}
async function enable(): Promise<void> {
  const request = pending.value
  if (
    !request ||
    busy.value ||
    request.folder !== doc.folder ||
    request.hash !== runtime.scriptStatus.hash
  )
    return
  busy.value = true
  try {
    await settings.save({
      ...settings.value,
      trustedScripts: [
        ...new Set([...settings.value.trustedScripts, request.hash]),
      ],
    })
    if (pending.value?.hash === request.hash) {
      pending.value = null
      dialog.value?.close()
    }
  } catch (reason) {
    error.value = String(reason)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-script-trust"
    aria-labelledby="script-trust-title"
    @cancel.prevent="reject"
  >
    <div class="xm-dialog-h">
      <h5 id="script-trust-title">
        {{ t('scriptTrust.enableThisProjectSScript') }}
      </h5>
    </div>
    <div class="xm-dialog-b">
      <p>
        {{ t('scriptTrust.theScriptCanChangeNotesRoutingPlaybackAndControllerFeedback') }}
      </p>
      <p class="xm-faint">
        {{ doc.project.name }} {{ t('scriptTrust.scriptTs') }}
      </p>
      <p class="xm-faint">
        {{ t('scriptTrust.aChangedScriptNeedsApprovalAgainYourChoiceAppliesTo') }}
      </p>
      <p
        v-if="error"
        class="text-danger"
        role="alert"
      >
        {{ error }}
      </p>
    </div>
    <div class="xm-dialog-f">
      <button
        class="btn btn-sm btn-ghost"
        :disabled="busy"
        @click="reject"
      >
        {{ t('scriptTrust.keepDisabled') }}
      </button><button
        class="btn btn-sm btn-primary"
        :disabled="busy"
        @click="enable"
      >
        {{ busy ? 'Enabling…' : 'Enable script' }}
      </button>
    </div>
  </dialog>
</template>
