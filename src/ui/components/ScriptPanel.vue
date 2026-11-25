<script setup lang="ts">
import { t } from '../i18n'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { useScriptStore } from '../stores/script'
import { useRuntimeStore } from '../stores/runtime'
import { scriptDeclarations } from '../../shared/script-declarations'
const scripts = useScriptStore(),
  runtime = useRuntimeStore(),
  mount = ref<HTMLElement>(),
  reference = ref(false)
let view: EditorView | undefined
function focus(): void {
  view?.focus()
}
defineExpose({ focus })
const colors = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword],
    color: '#c792ea',
  },
  { tag: tags.string, color: '#a5e28a' },
  { tag: tags.number, color: '#f7b267' },
  { tag: [tags.typeName, tags.className], color: '#4cc2ff' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: '#4cc2ff',
  },
  { tag: tags.comment, color: '#6b7890' },
])
onMounted(() => {
  const nonce =
    document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')
      ?.nonce ?? ''
  view = new EditorView({
    parent: mount.value,
    state: EditorState.create({
      doc: scripts.draft,
      extensions: [
        EditorView.cspNonce.of(nonce),
        EditorView.theme({}, { dark: true }),
        EditorView.contentAttributes.of({
          'aria-label': 'Project TypeScript',
          spellcheck: 'false',
        }),
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(colors),
        javascript({ typescript: true }),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              void scripts.apply()
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) scripts.draft = update.state.doc.toString()
        }),
      ],
    }),
  })
})
watch(
  () => scripts.draft,
  (value) => {
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      })
  },
)
onUnmounted(() => view?.destroy())
</script>
<template>
  <div class="xm-script-panel">
    <div class="xm-row mb-2">
      <span class="xm-faint flex-grow-1">{{ t('scriptPanel.scriptTs') }}
        <span
          v-if="scripts.dirty"
          :aria-label="t('scriptPanel.unappliedScriptChanges')"
        >{{ t('scriptPanel.symbol') }}</span></span>
      <span
        class="xm-script-status"
        :class="`is-${runtime.scriptStatus.state}`"
      >{{ runtime.scriptStatus.state }}</span>
      <button
        class="btn btn-sm btn-ghost"
        :aria-expanded="reference"
        @click="reference = !reference"
      >
        {{ t('scriptPanel.aPI') }}
      </button>
      <button
        class="btn btn-sm btn-primary"
        :disabled="!runtime.connected"
        :title="t('scriptPanel.applyScriptCtrlEnter')"
        :aria-label="t('scriptPanel.applyScript')"
        @click="scripts.apply"
      >
        {{ t('timeline.apply') }} <span class="xm-kbd">{{ t('scriptPanel.ctrl') }}</span>
      </button>
    </div>
    <div
      v-if="scripts.externalChange"
      class="xm-script-conflict"
      role="status"
    >
      {{ t('scriptPanel.scriptTsChangedOutsideThisDraftApplyReplacesItWith') }}
      <button
        class="btn btn-sm btn-ghost"
        @click="scripts.takeProject"
      >
        {{ t('scriptPanel.useProjectVersion') }}
      </button>
    </div>
    <div
      ref="mount"
      class="xm-code xm-script-editor"
    />
    <div
      v-if="reference"
      class="xm-script-reference"
    >
      <p class="xm-faint">
        {{ t('scriptPanel.synchronousHooksRegisters07Pads116NoteDurations') }}
      </p>
      <pre
        tabindex="0"
        :aria-label="t('scriptPanel.scriptAPIReference')"
      >{{
        scriptDeclarations
      }}</pre>
    </div>
    <div class="xm-row mt-2">
      <small class="xm-faint flex-grow-1">{{
        scripts.dirty
          ? 'Apply or save to use this draft.'
          : 'External edits reload after trust approval.'
      }}</small><button
        class="btn btn-sm btn-ghost"
        :disabled="runtime.scriptStatus.state !== 'running'"
        @click="scripts.disable"
      >
        {{ t('scriptPanel.disable') }}
      </button>
    </div>
    <div
      v-if="runtime.logs.some((e) => e.source === 'script')"
      class="xm-log xm-script-log"
      :aria-label="t('scriptPanel.scriptLog')"
      aria-live="polite"
    >
      <div
        v-for="(entry, index) in runtime.logs
          .filter((e) => e.source === 'script')
          .slice(-20)"
        :key="index"
      >
        <span class="xm-faint">{{ entry.time }} </span><span
          :class="`xm-log-${entry.level}`"
        >{{ t('scriptPanel.script') }} </span>{{ entry.message }}
      </div>
    </div>
  </div>
</template>
