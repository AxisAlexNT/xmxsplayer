import { analyzeSpectrum } from './spectrum'
self.onmessage = ({ data }) => {
  try {
    const result = analyzeSpectrum(
      data.left,
      data.right,
      data.mode,
      data.rate,
      (progress) => self.postMessage({ progress }),
    )
    self.postMessage({ result }, { transfer: [result] })
  } catch (reason) {
    self.postMessage({ error: String(reason) })
  }
}
