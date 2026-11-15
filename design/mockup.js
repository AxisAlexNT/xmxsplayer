/* Mockup-only drawing helpers: fake staves, piano rolls, waveforms, ruler and keyboard.
   In the app these are produced by Verovio (staves) and canvas lanes; only the
   geometry conventions below are part of the design:
   - every lane page starts with a lead-in gutter (--xm-lane-gutter),
   - after the gutter, x is shared by all lanes (bars line up vertically). */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const BEATS = 16; // one page in the mockup = 4 bars of 4/4
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let curG = 96; // gutter of the lane being drawn (a container may override --xm-lane-gutter)
  const gutterOf = (el) => {
    const v = parseFloat(getComputedStyle(el).getPropertyValue('--xm-lane-gutter'));
    return Number.isNaN(v) ? 96 : v;
  };
  const G = () => curG;
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const X = (W, beat) => G() + (beat / BEATS) * (W - G());
  const parseNotes = (s) =>
    (s || '').split(',').filter(Boolean).map((t) => {
      const [b, p, d, f] = t.trim().split(':');
      return { b: +b, p: +p, d: +(d || 1), f: f || '' };
    });

  function stage(lane) {
    curG = gutterOf(lane);
    lane.querySelectorAll('svg.mk').forEach((n) => n.remove());
    const W = lane.clientWidth, H = lane.clientHeight;
    const svg = svgEl('svg', { class: 'mk', viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    lane.prepend(svg);
    return { svg, W, H };
  }

  /* ---- Staff: notes are "beat:step:beats[:flags]", step 0 = bottom line; flags: s sounding, x expected, r rest ---- */
  function drawStaff(lane) {
    const { svg, W, H } = stage(lane);
    const paper = lane.classList.contains('is-paper');
    const ink = css(paper ? '--xm-paper-ink' : '--xm-staff-ink');
    const line = css(paper ? '--xm-paper-line' : '--xm-staff-line');
    const color = lane.dataset.color || css('--xm-accent');
    const sp = +(lane.dataset.sp || 14), mid = H / 2, g = G();
    const y = (step) => mid + 2 * sp - (step * sp) / 2;
    const bass = lane.dataset.clef === 'bass';
    const now = +(lane.dataset.now ?? -1);
    for (let i = 0; i < 5; i++) svgEl('line', { x1: 8, x2: W, y1: y(i * 2), y2: y(i * 2), stroke: line, 'stroke-width': 1 }, svg);
    svgEl('line', { x1: 8, x2: 8, y1: y(8), y2: y(0), stroke: ink, 'stroke-width': 1.2 }, svg);
    // clef, key signature (4 flats), time signature
    const clef = svgEl('text', { x: 10, y: bass ? y(1.9) : y(2), fill: ink, 'font-size': sp * 4, 'font-family': "'Noto Music','Bravura Text','FreeSerif','Segoe UI Symbol',serif" }, svg);
    clef.textContent = bass ? '\u{1D122}' : '\u{1D11E}';
    (bass ? [2, 5, 1, 4] : [4, 7, 3, 6]).forEach((s, i) => {
      const t = svgEl('text', { x: 42 + i * 8, y: y(s) + sp * 0.55, fill: ink, 'font-size': sp * 2.5, 'font-family': "'Noto Music','FreeSerif',serif" }, svg);
      t.textContent = '♭';
    });
    if (lane.dataset.time !== 'no') [6, 2].forEach((s) => {
      const t = svgEl('text', { x: g - 9, y: y(s) + sp * 0.72, fill: ink, 'font-size': sp * 2.1, 'font-weight': 700, 'font-family': "'FreeSerif','Times New Roman',serif", 'text-anchor': 'middle' }, svg);
      t.textContent = '4';
    });
    for (let k = 1; k <= 4; k++) {
      const x = Math.min(X(W, k * 4), W - 1);
      svgEl('line', { x1: x, x2: x, y1: y(8), y2: y(0), stroke: ink, 'stroke-width': 1.2 }, svg);
    }
    const notes = parseNotes(lane.dataset.notes);
    const rx = sp * 0.64, ry = sp * 0.45, stemLen = sp * 3.4;
    const pos = (n) => X(W, n.b + 0.42);
    notes.forEach((n, i) => {
      const x = pos(n), yy = y(n.p);
      if (n.f.includes('r')) {
        const t = svgEl('text', { x: x - 4, y: y(4) + sp * 0.9, fill: ink, 'font-size': sp * 3.2, 'font-family': "'Noto Music','FreeSerif',serif" }, svg);
        t.textContent = n.d >= 4 ? '\u{1D13B}' : n.d >= 2 ? '\u{1D13C}' : '\u{1D13D}';
        return;
      }
      const sounding = n.f.includes('s') || (now >= n.b && now < n.b + n.d);
      const c = sounding ? color : ink;
      const grp = svgEl('g', sounding ? { filter: 'drop-shadow(0 0 5px ' + color + ')' } : {}, svg);
      for (let l = -2; l >= n.p; l -= 2) svgEl('line', { x1: x - rx - 4, x2: x + rx + 4, y1: y(l), y2: y(l), stroke: line, 'stroke-width': 1 }, grp);
      for (let l = 10; l <= n.p; l += 2) svgEl('line', { x1: x - rx - 4, x2: x + rx + 4, y1: y(l), y2: y(l), stroke: line, 'stroke-width': 1 }, grp);
      const hollow = n.d >= 2;
      svgEl('ellipse', { cx: x, cy: yy, rx, ry, transform: `rotate(-20 ${x} ${yy})`, fill: hollow ? 'none' : c, stroke: c, 'stroke-width': hollow ? 1.8 : 0.6 }, grp);
      if (n.d < 4) {
        const up = n.p < 4, sx = up ? x + rx - 0.8 : x - rx + 0.8, ey = up ? yy - stemLen : yy + stemLen;
        svgEl('line', { x1: sx, x2: sx, y1: yy, y2: ey, stroke: c, 'stroke-width': 1.3 }, grp);
        if (n.d === 0.5) {
          const m = notes[i + 1], onBeat = Number.isInteger(n.b);
          if (onBeat && m && m.d === 0.5 && m.b === n.b + 0.5 && m.p < 4 === up) {
            const mx = pos(m) + (up ? rx - 0.8 : -rx + 0.8), my = up ? y(m.p) - stemLen : y(m.p) + stemLen;
            svgEl('line', { x1: sx, x2: mx, y1: ey, y2: my, stroke: ink, 'stroke-width': sp * 0.45 }, svg);
          } else if (!(notes[i - 1] && notes[i - 1].d === 0.5 && notes[i - 1].b === n.b - 0.5 && !onBeat)) {
            svgEl('path', { d: `M${sx} ${ey} q ${sp * 0.9} ${up ? sp * 0.9 : -sp * 0.9} ${sp * 0.5} ${up ? sp * 2 : -sp * 2}`, fill: 'none', stroke: c, 'stroke-width': 1.4 }, grp);
          }
        }
      }
      if (n.f.includes('x')) svgEl('circle', { cx: x, cy: yy, r: sp * 1.15, fill: 'none', stroke: css('--xm-warn'), 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }, svg);
    });
    if (lane.dataset.dyn) lane.dataset.dyn.split(',').forEach((d) => {
      const [b, txt] = d.split(':');
      const t = svgEl('text', { x: X(W, +b + 0.3), y: y(0) + sp * 3.2, fill: ink, 'font-size': sp * 1.9, 'font-style': 'italic', 'font-weight': 700, 'font-family': "'FreeSerif','Times New Roman',serif" }, svg);
      t.textContent = txt;
    });
  }

  /* ---- Piano roll: notes are "beat:pitch:beats[:flags]" ---- */
  function grid(svg, W, H) {
    for (let b = 0; b <= BEATS; b++) {
      const x = Math.min(X(W, b), W - 0.5);
      svgEl('line', { x1: x, x2: x, y1: 0, y2: H, stroke: css(b % 4 === 0 ? '--xm-grid-bar' : '--xm-grid-beat'), 'stroke-width': 1 }, svg);
    }
  }
  function drawRoll(lane) {
    const { svg, W, H } = stage(lane);
    const color = lane.dataset.color || css('--xm-accent'), g = G();
    const lo = +(lane.dataset.lo || 36), hi = +(lane.dataset.hi || 60), rows = hi - lo + 1, rh = H / rows;
    const names = (lane.dataset.rows || '').split('|').filter(Boolean);
    const black = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
    for (let p = lo; p <= hi; p++) {
      const yy = H - (p - lo + 1) * rh;
      const dark = names.length ? (p - lo) % 2 === 1 : black(p);
      if (dark) svgEl('rect', { x: g, y: yy, width: W - g, height: rh, fill: css('--xm-bg-lane-alt') }, svg);
      if (names.length) {
        const t = svgEl('text', { x: g - 8, y: yy + rh / 2 + 4, fill: css('--xm-text-muted'), 'font-size': 11, 'text-anchor': 'end', 'font-family': css('--xm-font') }, svg);
        t.textContent = names[p - lo] || '';
      } else {
        svgEl('rect', { x: g - 34, y: yy + 0.5, width: dark ? 20 : 30, height: Math.max(rh - 1, 1), fill: dark ? '#0a0c10' : '#cfd5df', opacity: dark ? 1 : 0.85 }, svg);
        if (p % 12 === 0) {
          const t = svgEl('text', { x: g - 40, y: yy + rh / 2 + 4, fill: css('--xm-text-faint'), 'font-size': 10, 'text-anchor': 'end', 'font-family': css('--xm-font-mono') }, svg);
          t.textContent = 'C' + (p / 12 - 1);
        }
      }
    }
    svgEl('line', { x1: g, x2: g, y1: 0, y2: H, stroke: css('--xm-border-strong'), 'stroke-width': 1 }, svg);
    grid(svg, W, H);
    const now = +(lane.dataset.now ?? -1), outline = lane.dataset.mode === 'live';
    parseNotes(lane.dataset.notes).forEach((n) => {
      const x = X(W, n.b), w = Math.max(X(W, n.b + n.d) - x - 1.5, 3), yy = H - (n.p - lo + 1) * rh;
      const sounding = now >= n.b && now < n.b + n.d, sel = n.f.includes('e');
      svgEl('rect', { x, y: yy + 1, width: w, height: Math.max(rh - 2, 2), rx: 2, fill: outline ? 'none' : color, 'fill-opacity': sounding ? 1 : 0.78,
        stroke: sel ? '#fff' : sounding ? '#fff' : outline ? color : 'none', 'stroke-width': sel || sounding ? 1.5 : 1.2,
        filter: sounding ? 'drop-shadow(0 0 5px ' + color + ')' : '' }, svg);
    });
  }

  /* ---- Audio waveform ---- */
  function drawWave(lane) {
    const { svg, W, H } = stage(lane);
    const color = lane.dataset.color || css('--xm-c11'), g = G(), r = rng(+(lane.dataset.seed || 7)), mid = H / 2;
    grid(svg, W, H);
    svgEl('line', { x1: g, x2: W, y1: mid, y2: mid, stroke: css('--xm-grid-beat') }, svg);
    let d = '';
    for (let x = g; x < W; x += 2) {
      const beat = ((x - g) / (W - g)) * BEATS, ph = beat % 1;
      const env = 0.22 + 0.62 * Math.exp(-ph * 5) + 0.25 * Math.exp(-Math.abs(ph - 0.5) * 9);
      const a = Math.min(0.96, env * (0.55 + r() * 0.6)) * (mid - 6);
      d += `M${x} ${mid - a}V${mid + a}`;
    }
    svgEl('path', { d, stroke: color, 'stroke-width': 1.3, opacity: 0.85 }, svg);
    (lane.dataset.anchors || '').split(',').filter(Boolean).forEach((b) => {
      const x = X(W, +b);
      svgEl('path', { d: `M${x} 2 l5 6 l-5 6 l-5 -6 z`, fill: css('--xm-warn') }, svg);
    });
  }

  /* ---- Ruler ---- */
  function drawRuler(lane) {
    const { svg, W, H } = stage(lane);
    const first = +(lane.dataset.first || 17);
    for (let b = 0; b <= BEATS; b++) {
      const x = Math.min(X(W, b), W - 0.5), bar = b % 4 === 0;
      svgEl('line', { x1: x, x2: x, y1: bar ? 4 : H - 7, y2: H, stroke: css(bar ? '--xm-border-strong' : '--xm-border'), 'stroke-width': 1 }, svg);
      if (bar && b < BEATS) {
        const t = svgEl('text', { x: x + 6, y: 17, fill: css('--xm-text-muted'), 'font-size': 12, 'font-weight': 600, 'font-family': css('--xm-font-mono') }, svg);
        t.textContent = first + b / 4;
      }
    }
    if (lane.dataset.loop) {
      const [a, z] = lane.dataset.loop.split('-').map(Number), xa = X(W, a), xz = Math.min(X(W, z), W);
      svgEl('rect', { x: xa, y: H - 6, width: xz - xa, height: 6, fill: css('--xm-accent'), opacity: 0.85, rx: 1 }, svg);
    }
  }

  /* ---- Keyboard: data-held="60:1,64:1,43:3" (pitch:paletteIndex), data-next="67" ---- */
  function keyGeom(W, lo, hi) {
    const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);
    const whites = []; for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);
    const ww = W / whites.length;
    const xOf = (p) => (isBlack(p) ? whites.indexOf(p - 1) * ww + ww * 0.68 : whites.indexOf(p) * ww);
    return { isBlack, whites, ww, xOf };
  }
  function drawKeys(lane) {
    const { svg, W, H } = stage(lane);
    const lo = +(lane.dataset.lo || 36), hi = +(lane.dataset.hi || 96), k = keyGeom(W, lo, hi);
    const held = Object.fromEntries((lane.dataset.held || '').split(',').filter(Boolean).map((t) => t.split(':')));
    const next = (lane.dataset.next || '').split(',').filter(Boolean).map(Number);
    const fillOf = (p, base) => (held[p] ? css('--xm-c' + held[p]) : base);
    for (let p = lo; p <= hi; p++) if (!k.isBlack(p)) {
      const x = k.xOf(p);
      svgEl('rect', { x: x + 0.5, y: 0, width: k.ww - 1, height: H, rx: 2, fill: fillOf(p, '#dfe3ea') }, svg);
      if (next.includes(p)) svgEl('rect', { x: x + 2, y: 2, width: k.ww - 4, height: H - 4, rx: 2, fill: 'none', stroke: css('--xm-warn'), 'stroke-width': 2.5, 'stroke-dasharray': '4 3' }, svg);
      if (p % 12 === 0) {
        const t = svgEl('text', { x: x + k.ww / 2, y: H - 6, fill: '#5b6472', 'font-size': 10, 'text-anchor': 'middle', 'font-family': css('--xm-font-mono') }, svg);
        t.textContent = 'C' + (p / 12 - 1);
      }
    }
    for (let p = lo; p <= hi; p++) if (k.isBlack(p)) {
      svgEl('rect', { x: k.xOf(p), y: 0, width: k.ww * 0.64, height: H * 0.62, rx: 2, fill: fillOf(p, '#0a0c10'), stroke: '#000', 'stroke-width': 0.5 }, svg);
    }
    const zones = lane.closest('.xm-keys, .mk-keys')?.querySelector('.xm-zones');
    if (zones) zones.querySelectorAll('.xm-zone').forEach((z) => {
      const a = k.xOf(+z.dataset.lo), b = k.xOf(+z.dataset.hi) + k.ww;
      z.style.left = a + 1 + 'px'; z.style.width = b - a - 2 + 'px';
    });
  }

  /* ---- Overlays positioned in lane coordinates ---- */
  function place() {
    document.querySelectorAll('[data-at]').forEach((e) => {
      const W = e.parentElement.clientWidth;
      curG = gutterOf(e.parentElement);
      e.style.left = X(W, +e.dataset.at) + 'px';
      if (e.dataset.to) e.style.width = X(W, +e.dataset.to) - X(W, +e.dataset.at) + 'px';
    });
  }

  const draw = { staff: drawStaff, roll: drawRoll, wave: drawWave, ruler: drawRuler, keys: drawKeys };
  const run = () => {
    document.querySelectorAll('[data-draw]').forEach((e) => draw[e.dataset.draw]?.(e));
    place();
  };
  window.addEventListener('resize', run);
  if (document.fonts?.ready) document.fonts.ready.then(run);
  window.addEventListener('load', run);
})();
