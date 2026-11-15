import source from './script-api.ts?raw'

export const scriptDeclarations =
  '// Project script API. Registers use indices 0–7; pads use numbers 1–16.\n' +
  source.replace(/^export /gm, '') +
  '\ndeclare const xm: XmApi;\n'
