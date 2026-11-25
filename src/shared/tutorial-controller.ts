import type { DeviceProfile } from './model'

export const tutorialController: DeviceProfile = {
  id: 'tutorial-controller',
  name: 'On-screen controller',
  ports: [],
  controls: [
    { id: 'pad.1', label: 'Pad', kind: 'pad', mode: 'momentary', ui: { group: 'Pad', row: 0, col: 0 } },
    { id: 'fader.1', label: 'Fader', kind: 'fader', mode: 'absolute', ui: { group: 'Fader', row: 0, col: 0 } },
    { id: 'knob.1', label: 'Knob', kind: 'knob', mode: 'absolute', ui: { group: 'Knob', row: 0, col: 0 } },
  ],
}
