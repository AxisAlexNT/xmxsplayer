import {
  binHz,
  createSpectrum,
  dbByte,
  spectrumBins,
  spectrumHop,
  readSpectrum,
} from '../../shared/spectrum'
import type { AudioTrack } from '../../shared/model'
// Each band uses a centred Hann window. Lower bands are decimated before the FFT.
function band(
  samples: Float32Array,
  rate: number,
  window: number,
  stride: number,
  lo: number,
  hi: number,
) {
  const windowSamples = window / stride,
    padding = lo === 0 ? 4 : 1,
    n = windowSamples * padding,
    real = new Float64Array(n),
    imag = new Float64Array(n),
    reverse = new Uint16Array(n),
    hann = new Float64Array(n),
    cos = new Float64Array(n / 2),
    sin = new Float64Array(n / 2),
    power = new Float64Array(n / 2)
  const signal =
    stride === 1
      ? samples
      : new Float32Array(Math.ceil(samples.length / stride))
  if (stride > 1) {
    const radius = 4 * stride,
      cutoff = 0.38 / stride
    const taps = Float64Array.from({ length: 2 * radius + 1 }, (_, i) => {
      const x = i - radius
      return (
        (x === 0
          ? 2 * cutoff
          : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)) *
        (0.5 + 0.5 * Math.cos((Math.PI * x) / radius))
      )
    })
    const sum = taps.reduce((a, b) => a + b, 0)
    for (let i = 0; i < signal.length; i++) {
      const base = i * stride - radius
      let value = 0
      for (
        let j = Math.max(0, -base);
        j < Math.min(taps.length, samples.length - base);
        j++
      )
        value += samples[base + j] * taps[j]
      signal[i] = value / sum
    }
  }
  for (let i = 0; i < n; i++) {
    reverse[i] = (reverse[i >> 1] >> 1) | ((i & 1) * (n >> 1))
    hann[i] =
      i < windowSamples
        ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / windowSamples)
        : 0
    if (i < n / 2) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n)
      sin[i] = Math.sin((-2 * Math.PI * i) / n)
    }
  }
  const bins = Array.from({ length: spectrumBins }, (_, i) => ({
    i,
    k: (binHz(i) * window * padding) / rate,
  })).filter((b) => binHz(b.i) >= lo && binHz(b.i) < hi)
  return (center: number, data: Uint8Array, offset: number) => {
    const start = center / stride - windowSamples / 2
    for (let i = 0; i < n; i++) {
      const j = reverse[i]
      real[j] = (signal[start + i] ?? 0) * hann[i]
      imag[j] = 0
    }
    for (let width = 2; width <= n; width *= 2) {
      const half = width / 2,
        step = n / width
      for (let a = 0; a < n; a += width)
        for (let j = 0; j < half; j++) {
          const l = a + j,
            r = l + half,
            k = j * step,
            tr = real[r] * cos[k] - imag[r] * sin[k],
            ti = real[r] * sin[k] + imag[r] * cos[k]
          real[r] = real[l] - tr
          imag[r] = imag[l] - ti
          real[l] += tr
          imag[l] += ti
        }
    }
    for (let k = 0; k < power.length; k++)
      power[k] = real[k] * real[k] + imag[k] * imag[k]
    const scale = 20 * Math.log10(4 / windowSamples)
    for (const { i, k } of bins) {
      let j = Math.round(k)
      if (power[j - 1] > power[j] && power[j - 1] > power[j - 2]) j--
      else if (power[j + 1] > power[j] && power[j + 1] > power[j + 2]) j++
      const x = k - j
      const a = 10 * Math.log10(Math.max(1e-20, power[j - 1])),
        b = 10 * Math.log10(Math.max(1e-20, power[j])),
        c = 10 * Math.log10(Math.max(1e-20, power[j + 1]))
      data[offset + i] = dbByte(
        scale + b + 0.5 * x * (c - a + x * (a - 2 * b + c)),
      )
    }
  }
}
export function analyzeSpectrum(
  left: Float32Array,
  right: Float32Array | undefined,
  mode: AudioTrack['channelMode'],
  rate: number,
  progress: (fraction: number) => void = () => {},
) {
  if (mode === 'stereo' && right) {
    const a = readSpectrum(
      analyzeSpectrum(left, undefined, 'left', rate, (f) => progress(f / 2)),
    )
    const b = readSpectrum(
      analyzeSpectrum(right, undefined, 'left', rate, (f) =>
        progress(0.5 + f / 2),
      ),
    )
    // Combine channel powers so out-of-phase stereo stays visible.
    const correction = Array.from(
      { length: 256 },
      (_, d) =>
        (255 / 90) * 10 * Math.log10((1 + 10 ** ((-d * 90) / 255 / 10)) / 2),
    )
    for (let i = 0; i < a.data.length; i++) {
      const x = a.data[i],
        y = b.data[i]
      a.data[i] = Math.round(Math.max(x, y) + correction[Math.abs(x - y)])
    }
    return a.buffer
  }
  const mono = new Float32Array(left.length)
  for (let i = 0; i < mono.length; i++) {
    const l = left[i],
      r = right?.[i] ?? l
    mono[i] =
      mode === 'left'
        ? l
        : mode === 'right'
          ? r
          : mode === 'side'
            ? (l - r) / 2
            : (l + r) / 2
  }
  const out = createSpectrum(rate, Math.ceil(mono.length / spectrumHop))
  const bands = [
    band(mono, rate, 8192, 16, 0, 200),
    band(mono, rate, 4096, 4, 200, 1600),
    band(mono, rate, 2048, 2, 1600, Infinity),
  ]
  for (let f = 0; f < out.frames; f++) {
    for (const transform of bands)
      transform(f * spectrumHop, out.data, f * spectrumBins)
    if (f % 256 === 0) progress(f / out.frames)
  }
  progress(1)
  return out.buffer
}
