<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'
import type { ControlDef } from '../../shared/model'
import { engineBus } from '../bus'
import { matchesKind, matchesGesture, type ControlAddress } from './controller'
import { t } from '../i18n'
import { feedbackDurationMs, type TourAction, type TourState } from './machine'
import type { TourStep } from './tours'

const props = defineProps<{ step: TourStep; state: TourState; busy: boolean }>()
const emit = defineEmits<{ action: [action: TourAction] }>()
const bubble = ref<HTMLElement>()
const host = shallowRef<HTMLElement>(document.body)
const anchor = shallowRef<HTMLElement>()
const rect = shallowRef<DOMRect>()
const size = ref({ w: 340, h: 170, viewportW: innerWidth, viewportH: innerHeight })
let frame = 0
let mutation: MutationObserver
let resize: ResizeObserver
const settings = useSettingsStore()
let prepared = ''
let scrollStep = ''
function locate() {
  frame = 0
  const modals = document.querySelectorAll<HTMLDialogElement>('dialog:modal')
  host.value = modals[modals.length - 1] ?? document.body
  const candidates = host.value.querySelectorAll<HTMLElement>(`[data-tour="${props.step.anchor}"]`)
  const element = Array.from(candidates).find(el => {
    if (!el.checkVisibility() || !el.getClientRects().length) return false
    return !props.step.controlAnchor || matchesKind(props.step.controlAnchor, el.dataset.controlKind as ControlDef['kind'])
  })
  if (!element && props.step.prepare && prepared !== props.step.id) {
    prepared = props.step.id
    const panel = props.step.prepare
    if (panel === 'Effects') {
      if (!modals.length) document.querySelector<HTMLElement>('[data-tour="fx-open"]')?.click()
    } else {
      if (settings.collapsed) settings.collapse()
      if (settings.sections[panel] === false) settings.toggle(panel)
      if (['balance','range'].includes(props.step.anchor)) {
        void nextTick(() => {
          const section = document.querySelector<HTMLDetailsElement>('details.xm-orc-sec')
          if (section) section.open = true
        })
      }
    }
    void nextTick(schedule)
  }
  if (anchor.value !== element) {
    if (anchor.value) resize.unobserve(anchor.value)
    anchor.value = element
    if (element) resize.observe(element)
  }
  if (element && props.step.id !== scrollStep) {
    scrollStep = props.step.id
    element.scrollIntoView({block:'nearest', inline:'nearest'})
  }
  rect.value = element?.getBoundingClientRect()
  size.value = { w: bubble.value?.offsetWidth ?? 340, h: bubble.value?.offsetHeight ?? 170, viewportW: innerWidth, viewportH: innerHeight }
}
function schedule() { if (!frame) frame = requestAnimationFrame(locate) }
const chosen: Partial<Record<NonNullable<TourStep['controller']>, ControlAddress>> = {}
watch(engineBus, (bus, _, cleanup) => {
  if (!bus) return
  cleanup(bus.on('control', event => {
    const expected = props.step.controller
    if (props.busy || props.state.phase !== 'active' || !expected) return
    if (!matchesGesture(expected, event, chosen[expected])) return
    chosen[expected] = { deviceId: event.deviceId, controlId: event.controlId }
    emit('action', 'matched')
  }))
}, { immediate: true })
function match(event: Event) {
  if (props.busy || props.state.phase !== 'active') return
  const clicked = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tour="control"]') : null
  const kind = props.step.controlAnchor
  if (event.type === 'click' && kind && props.step.waitFor === 'click' && clicked &&
      matchesKind(kind, clicked.dataset.controlKind as ControlDef['kind']) &&
      clicked.dataset.deviceId && clicked.dataset.controlId) {
    chosen[kind] = { deviceId: clicked.dataset.deviceId, controlId: clicked.dataset.controlId }
    emit('action', 'matched')
    return
  }
  if (props.step.waitFor === event.type && anchor.value && event.composedPath().includes(anchor.value))
    emit('action','matched')
}
function key(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) return
  if (props.state.phase !== 'active' && props.state.phase !== 'feedback' && props.state.phase !== 'confirmExit') return
  let action: TourAction
  if (event.key === 'Escape') action = props.state.phase === 'confirmExit' ? 'resume' : 'requestExit'
  else {
    if (props.state.phase === 'confirmExit' || (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable=true]'))) return
    if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('button')) return
    if (['Enter','ArrowRight'].includes(event.key)) action = 'next'
    else if (event.key === 'ArrowLeft') action = 'back'
    else return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  emit('action',action)
}
const position = computed(() => {
  const { w,h,viewportW,viewportH } = size.value
  const r = rect.value
  const clamp = (value:number, max:number) => Math.max(8, Math.min(value,max-8))
  const below = !r || r.bottom + h + 16 < viewportH || r.top < h + 16
  const x = clamp(r ? r.left + r.width/2 - w/2 : (viewportW-w)/2, viewportW-w)
  const y = clamp(r ? below ? r.bottom+12 : r.top-h-12 : (viewportH-h)/2, viewportH-h)
  return { left:x+'px', top:y+'px', '--arrow-x': (r ? clamp(r.left+r.width/2-x,w) : 0)+'px', '--arrow-y':below ? '-5px':'calc(100% - 5px)' }
})
watch(() => props.state.phase, (phase,_,cleanup) => {
  if (phase !== 'feedback') return
  const revision = props.state.revision
  const timer = setTimeout(() => emit('action',{feedbackElapsed:revision}),feedbackDurationMs)
  cleanup(() => clearTimeout(timer))
})
watch(() => props.step.id, async () => { prepared = ''; await nextTick(); schedule(); bubble.value?.focus({preventScroll:true}) })
onMounted(() => {
  resize = new ResizeObserver(schedule)
  if (bubble.value) resize.observe(bubble.value)
  mutation = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-tour-overlay]')))) schedule()
  })
  mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','class','hidden']})
  window.addEventListener('resize',schedule)
  window.addEventListener('scroll',schedule,true)
  window.addEventListener('keydown',key,true)
  for (const type of ['click','change']) document.addEventListener(type,match,true)
  locate()
  bubble.value?.focus({preventScroll:true})
})
onUnmounted(() => {
  mutation.disconnect(); resize.disconnect(); cancelAnimationFrame(frame)
  window.removeEventListener('resize',schedule)
  window.removeEventListener('scroll',schedule,true)
  window.removeEventListener('keydown',key,true)
  for (const type of ['click','change']) document.removeEventListener(type,match,true)
})
</script>
<template>
  <Teleport :to="host">
    <div
      data-tour-overlay
      class="tour-layer"
    >
      <div
        v-if="rect"
        class="tour-ring"
        :style="{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'}"
      />
      <aside
        ref="bubble"
        tabindex="-1"
        class="tour-bubble"
        :class="{pointed:!!rect}"
        :style="position"
        :aria-label="t(step.titleKey)"
      >
        <slot />
        <small
          v-if="state.phase==='feedback'"
          class="matched"
          role="status"
        >{{ t('tutorial.matched') }}</small>
        <small v-else-if="state.phase==='active' && !rect">{{ t('tutorial.missing') }}</small>
        <small v-else-if="state.phase==='active' && (step.waitFor || step.controller)">{{ t('tutorial.waiting') }}</small>
      </aside>
    </div>
  </Teleport>
</template>
<style scoped>
.tour-layer { pointer-events:none; position:fixed; inset:0; z-index:10000; }
.tour-ring { position:fixed; border:2px solid #61d9c1; border-radius:5px; box-shadow:0 0 0 200vmax #05080c66; }
.tour-bubble { position:fixed; pointer-events:auto; width:min(22rem,calc(100vw - 16px)); max-height:calc(100vh - 16px); overflow-y:auto; padding:1rem; border:1px solid #5e967f; border-radius:.5rem; background:#242d31; color:#f2f6f4; box-shadow:0 6px 20px #0007; }
.tour-bubble.pointed::before { content:''; position:fixed; width:10px; height:10px; margin-left:-5px; background:#5e967f; transform:rotate(45deg); }
.tour-bubble.pointed { overflow:visible; }
.tour-bubble.pointed::before { position:absolute; left:var(--arrow-x); top:var(--arrow-y); }
small { display:block; margin-top:.5rem; }
.matched { color:#82e5ae; }
@media (prefers-reduced-motion:no-preference) { .tour-ring {animation:tour-glow 1.6s ease-in-out infinite alternate;} @keyframes tour-glow {to {border-color:#b6ffe8;}} }
</style>
