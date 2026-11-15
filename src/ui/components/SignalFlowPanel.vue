<script setup lang="ts">
import { TimeMap } from '../../shared/time-map'
import { computed, useId } from 'vue'
import {
  flowGraph,
  type FlowEdge,
  type FlowNode,
  type FlowSelection,
} from '../flow/model'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
const emit = defineEmits<{
  select: [selection: FlowSelection, anchor: { right: number; top: number }]
  patch: [id: string, anchor: { right: number; top: number }]
}>()
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  settings = useSettingsStore(),
  uid = useId().replace(/[^a-z0-9]/gi, '')
const map = computed(() => new TimeMap(doc.project))
const barTick = computed(() =>
  map.value.barToTick(map.value.tickToBarBeat(runtime.transport.tick).bar),
)
const playing = computed(() => runtime.transport.playing)
const graph = computed(() =>
  flowGraph(
    doc.project,
    runtime.state,
    runtime.activity,
    runtime.midi.devices,
    settings.value,
    barTick.value,
    playing.value,
  ),
)
const nodeMap = computed(() => new Map(graph.value.nodes.map((n) => [n.id, n])))
function wire(edge: FlowEdge): string {
  const from = nodeMap.value.get(edge.from)!,
    to = nodeMap.value.get(edge.to)!,
    start = from.x + from.width,
    end = to.x,
    middle = (start + end) / 2
  return `M${start} ${from.y + 17} C${middle} ${from.y + 17} ${middle} ${to.y + 17} ${end} ${to.y + 17}`
}
function select(node: FlowNode, event: Event): void {
  if (node.selection)
    emit(
      'select',
      node.selection,
      (event.currentTarget as SVGGraphicsElement).getBoundingClientRect(),
    )
}
function patch(edge: FlowEdge, event: Event): void {
  const anchor = (
    event.currentTarget as SVGGraphicsElement
  ).getBoundingClientRect()
  if (edge.connectionId) emit('patch', edge.connectionId, anchor)
  else if (edge.selection) emit('select', edge.selection, anchor)
}
function edgeLabel(edge: FlowEdge): string {
  return `${nodeMap.value.get(edge.from)?.label} → ${nodeMap.value.get(edge.to)?.label}${edge.label ? ` · ${edge.label}` : ''}${!edge.enabled ? (edge.active ? ' · held notes' : ' · gate off') : ''}`
}
</script>
<template>
  <div
    class="xm-flow-viewport"
    tabindex="0"
    aria-label="Signal flow; scroll to see all routes"
  >
    <svg
      class="flow xm-flow"
      :viewBox="`0 0 ${graph.width} ${graph.height}`"
      :style="{ height: `${graph.height}px` }"
      role="group"
      aria-label="Effective signal flow"
    >
      <text
        v-for="(label, index) in [
          'Inputs',
          'Zones',
          'Tracks',
          'Instruments',
          'Outputs',
        ]"
        :key="label"
        class="cap"
        :x="[20, 240, 450, 660, 890][index]"
        y="18"
      >
        {{ label }}
      </text>
      <g
        v-for="edge in graph.edges"
        :key="edge.id"
        :style="{ '--c': edge.color }"
        :data-flow-edge="edge.id"
        :class="{ 'is-disabled': !edge.enabled && !edge.active }"
      >
        <path
          :d="wire(edge)"
          :class="{ on: edge.active, gated: edge.condition || edge.held }"
        />
        <g
          v-if="edge.label"
          :role="edge.connectionId || edge.selection ? 'button' : undefined"
          :tabindex="edge.connectionId || edge.selection ? 0 : undefined"
          :aria-label="edgeLabel(edge)"
          class="xm-flow-gate"
          @click="patch(edge, $event)"
          @keydown.enter.prevent="patch(edge, $event)"
          @keydown.space.prevent="patch(edge, $event)"
        >
          <title>{{ edgeLabel(edge) }}</title>
          <rect
            :x="nodeMap.get(edge.to)!.x - 60"
            :y="nodeMap.get(edge.to)!.y - 8"
            width="60"
            height="40"
            class="xm-flow-hit"
          />
          <text
            class="tag"
            :x="nodeMap.get(edge.to)!.x - 54"
            :y="nodeMap.get(edge.to)!.y + 12"
          >
            {{
              edge.label.length > 14
                ? edge.label.slice(0, 13) + '…'
                : edge.label
            }}
          </text>
        </g>
      </g>
      <g
        v-for="(node, index) in graph.nodes"
        :key="node.id"
        :data-flow-node="node.id"
        :data-active="node.active"
        :role="node.selection ? 'button' : undefined"
        :tabindex="node.selection ? 0 : undefined"
        :aria-label="node.label"
        :style="{ '--c': node.color }"
        class="xm-flow-node"
        @click="select(node, $event)"
        @keydown.enter.prevent="select(node, $event)"
        @keydown.space.prevent="select(node, $event)"
      >
        <title>{{ node.label }}</title>
        <defs>
          <clipPath :id="`${uid}-${index}`">
            <rect
              :x="node.x + 10"
              :y="node.y"
              :width="node.width - 20"
              height="34"
            />
          </clipPath>
        </defs>
        <rect
          :x="node.x"
          :y="node.y"
          :width="node.width"
          height="34"
          :class="{ on: node.active }"
        />
        <text
          :x="node.x + 12"
          :y="node.y + 22"
          :clip-path="`url(#${uid}-${index})`"
        >
          {{ node.label }}
        </text>
        <rect
          :x="node.x"
          :y="node.y - 3"
          :width="node.width"
          height="40"
          class="xm-flow-hit"
        />
      </g>
    </svg>
  </div>
  <p class="xm-faint xm-flow-help">
    Scroll to see all routes. Click a box to edit it; dashed lines are
    conditional.
  </p>
</template>
