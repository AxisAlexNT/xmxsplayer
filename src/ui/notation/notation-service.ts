import { computed, shallowRef } from 'vue'
import type { Project, Track } from '../../shared/model'
import { NotationClient } from './client'
import { mergeNotation, type MergedNotation } from './merge-score'
import type { NotationInfo, NotationOptions } from './protocol'
import { safeSvg, measurePage, type NotationPage } from './svg-page'
import { NotationAxis } from '../timeline/notation-axis'
export class NotationService {
  readonly info = shallowRef<NotationInfo | null>(null)
  readonly merged = shallowRef<MergedNotation | null>(null)
  readonly pages = shallowRef<ReadonlyMap<number, NotationPage>>(new Map())
  readonly error = shallowRef('')
  readonly busy = shallowRef(false)
  readonly axis = computed(() =>
    this.info.value && this.merged.value
      ? new NotationAxis(
          this.info.value,
          this.width,
          this.merged.value.grid,
          new Map([...this.pages.value].map(([p, page]) => [p, page.points])),
        )
      : null,
  )
  private client?: NotationClient
  private revision = 0
  private serial = 0
  private width = 1200
  private timer?: ReturnType<typeof setTimeout>
  private pending = new Map<number, Promise<void>>()
  private target = 0
  private defs?: SVGDefsElement
  private measuring?: HTMLDivElement
  private live = true
  private fonts = new Map<string, Promise<void>>()
  private faces: FontFace[] = []
  onRebuilt?: (durationMs: number) => void
  private expectedSignature = ''
  schedule(
    project: Project,
    ownerXml: string | undefined,
    options: NotationOptions,
  ): void {
    clearTimeout(this.timer)
    const revision = ++this.revision
    this.busy.value = true
    this.error.value = ''
    this.timer = setTimeout(() => {
      void this.rebuild(project, ownerXml, options, revision)
    }, 300)
  }
  private async rebuild(
    project: Project,
    ownerXml: string | undefined,
    options: NotationOptions,
    revision: number,
  ): Promise<void> {
    try {
      const started = performance.now()
      const merged = mergeNotation(project, ownerXml)
      if (!merged.staffTrackIds.length) {
        if (revision === this.revision) {
          this.clear()
          this.merged.value = merged
        }
        return
      }
      this.client ??= new NotationClient()
      const info = await this.client.request('load', {
        musicxml: merged.musicxml,
        options,
      })
      if (revision !== this.revision || !this.live) return
      this.clear()
      this.width = options.pageWidth
      this.merged.value = merged
      this.info.value = info
      this.serial++
      await this.ensure(this.target)
      if (revision === this.revision && this.live) this.onRebuilt?.(performance.now() - started)
    } catch (error) {
      if (revision === this.revision && this.live) {
        this.error.value = String(error)
        this.clear()
      }
    } finally {
      if (revision === this.revision) this.busy.value = false
    }
  }
  private mount(): void {
    if (this.defs) return
    const hub = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    hub.setAttribute('width', '0')
    hub.setAttribute('height', '0')
    hub.setAttribute('aria-hidden', 'true')
    hub.classList.add('xm-notation-definitions')
    this.defs = document.createElementNS(
      hub.namespaceURI,
      'defs',
    ) as SVGDefsElement
    hub.appendChild(this.defs)
    document.body.appendChild(hub)
    this.measuring = document.createElement('div')
    this.measuring.className = 'xm-notation-measure'
    document.body.appendChild(this.measuring)
  }
  private async installFonts(svg: string): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const match of svg.matchAll(
      /@font-face\s*\{\s*font-family:\s*['"]([^'"]+)['"];[^}]*base64,([A-Za-z0-9+/=]+)/g,
    )) {
      const [, name, data] = match
      if (name !== 'Leipzig' || data.length > 2 * 1024 * 1024)
        throw Error('Unsupported notation font')
      if (!this.fonts.has(name))
        this.fonts.set(
          name,
          (async () => {
            const face = new FontFace(
              name,
              Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer,
            )
            await face.load()
            if (this.live) {
              document.fonts.add(face)
              this.faces.push(face)
            }
          })(),
        )
      tasks.push(this.fonts.get(name)!)
    }
    await Promise.all(tasks)
  }
  async ensure(page: number): Promise<void> {
    const info = this.info.value
    if (!info || !this.client || !this.live) return
    this.target = Math.max(0, Math.min(info.pageCount - 1, page))
    const revision = this.revision,
      serial = this.serial,
      range = Array.from({ length: 5 }, (_, i) => this.target + i - 2).filter(
        (p) => p >= 0 && p < info.pageCount,
      )
    for (const p of [...this.pages.value.keys()])
      if (!range.includes(p)) {
        this.pages.value.get(p)!.svg.remove()
        const next = new Map(this.pages.value)
        next.delete(p)
        this.pages.value = next
      }
    await Promise.all(
      range.map((p) => {
        if (this.pages.value.has(p)) return Promise.resolve()
        const existing = this.pending.get(p)
        if (existing) return existing
        const job = (async () => {
          const raw = await this.client!.request('render', { page: p + 1 })
          if (
            revision !== this.revision ||
            serial !== this.serial ||
            !this.live ||
            Math.abs(p - this.target) > 2
          )
            return
          await this.installFonts(raw)
          if (
            revision !== this.revision ||
            serial !== this.serial ||
            !this.live ||
            Math.abs(p - this.target) > 2
          )
            return
          this.mount()
          const svg = safeSvg(raw, `xm-vrv-${serial}-${p}-`)
          this.measuring!.appendChild(svg)
          const measured = measurePage(svg, p, info, this.width)
          this.defs!.appendChild(svg)
          this.pages.value = new Map([...this.pages.value, [p, measured]])
        })()
          .catch((error) => {
            if (revision === this.revision) this.error.value = String(error)
          })
          .finally(() => {
            if (this.pending.get(p) === job) this.pending.delete(p)
          })
        this.pending.set(p, job)
        return job
      }),
    )
  }
  highlight(
    project: Project,
    tick: number,
    playing: boolean,
    held: { key: number; trackIds: string[] }[],
    expected: { tick: number; key: number; trackId: string }[],
    modeOf: (track: Track) => Track['mode'] = (track) => track.mode,
    recent?: ReadonlyMap<string, number>,
    replaced?: [number, number][],
  ): void {
    const info = this.info.value,
      tracks = this.merged.value?.staffTrackIds
    if (!info || !tracks) return
    const signature = JSON.stringify([
      expected,
      [...this.pages.value.values()].map((p) => p.id),
    ])
    const expectedChanged = signature !== this.expectedSignature
    this.expectedSignature = signature
    for (const page of this.pages.value.values()) {
      if (expectedChanged)
        for (const rect of page.svg.querySelectorAll('.xm-expected-note'))
          rect.remove()
      for (const entry of info.timemap.filter(
        (n) => n.page === page.page + 1 && n.key !== undefined,
      )) {
        const note = page.notes.get(entry.id)
        if (!note) continue
        const trackId = tracks[entry.staff - 1],
          track = project.tracks.find((t) => t.id === trackId)
        const isExpected = expected.some(
          (n) =>
            n.trackId === trackId &&
            Math.abs(n.tick - entry.qstamp * 480) < 1 &&
            n.key === entry.key,
        )
        const atPlayhead =
          entry.qstamp * 480 <= tick && (entry.end ?? entry.qstamp) * 480 > tick
        const mode = track && modeOf(track)
        const on =
          track &&
          mode !== 'mute' &&
          (mode === 'live'
            ? (atPlayhead || isExpected) &&
              held.some(
                (h) => h.key === entry.key && h.trackIds.includes(trackId),
              )
            : playing && atPlayhead)
        if (note.el.classList.contains('is-sounding') !== !!on)
          note.el.classList.toggle('is-sounding', !!on)
        const highlighted = recent?.get(`${trackId}:${Math.round(entry.qstamp * 480)}:${entry.key}`)
        const base = highlighted && highlighted > performance.now() ? 'var(--xm-accent)' : on ? track!.color : 'inherit'
        const color =
          on &&
          project.view.staffTheme === 'paper' &&
          /^#[0-9a-f]{6}$/i.test(base)
            ? '#' +
              [1, 3, 5]
                .map((i) =>
                  Math.round(parseInt(base.slice(i, i + 2), 16) * 0.65)
                    .toString(16)
                    .padStart(2, '0'),
                )
                .join('')
            : base
        const onset = Math.round(entry.qstamp * 480)
        const faded = track?.kind === 'midi' && track.armed &&
          replaced?.some(([start, end]) => onset >= start && onset < end) &&
          track.notes.some(n => n[0] === onset && n[2] === entry.key)
        note.el.classList.toggle('is-record-replaced', !!faded)
        if (note.el.getAttribute('color') !== color)
          note.el.setAttribute('color', color)
        if (expectedChanged && isExpected) {
          const r = note.rect,
            rect = document.createElementNS(page.svg.namespaceURI, 'rect')
          rect.setAttribute('class', 'xm-expected-note')
          for (const [key, value] of Object.entries({
            x: r.x - 4,
            y: r.y - 4,
            width: r.width + 8,
            height: r.height + 8,
            rx: 6,
          }))
            rect.setAttribute(key, String(value))
          page.svg.appendChild(rect)
        }
      }
    }
  }
  private clear(): void {
    for (const page of this.pages.value.values()) page.svg.remove()
    this.pages.value = new Map()
    this.pending.clear()
    this.info.value = null
    this.merged.value = null
  }
  destroy(): void {
    this.live = false
    this.revision++
    clearTimeout(this.timer)
    this.client?.destroy()
    for (const face of this.faces) document.fonts.delete(face)
    this.faces = []
    this.clear()
    this.measuring?.remove()
    this.defs?.parentElement?.remove()
  }
}
export { notationKey } from './context'
