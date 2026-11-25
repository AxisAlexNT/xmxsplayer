export const en = {
  'menu.file': 'File',
  'menu.newProject': 'New Project',
  'menu.open': 'Open',
  'menu.save': 'Save',
  'menu.importMidi': 'Import MIDI',
  'menu.importAudio': 'Import Audio',
  'menu.linkScore': 'Link Score',
  'menu.exportMidiForMusescore': 'Export MIDI for MuseScore',
  'menu.settings': 'Settings',
  'menu.quit': 'Quit',
  'menu.edit': 'Edit',
  'menu.undo': 'Undo',
  'menu.redo': 'Redo',
  'menu.view': 'View',
  'menu.collapseLeftPanel': 'Collapse left panel',
  'menu.staffLanes': 'Staff lanes',
  'menu.pianoRollLanes': 'Piano roll lanes',
  'menu.perTrackLaneView': 'Per-track lane view',
  'menu.help': 'Help',
  'menu.aboutXmxsplayer': 'About xmxsplayer',
  'conflict.changed': '{name} changed on disk, and you have unsaved changes in it.',
  'conflict.keep': 'Keep mine',
  'conflict.take': 'Take file',
} as const

type Message = string | { one: string; other: string }
export type Params = Record<string, string | number>

export function safeLocale(locale = 'en'): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? 'en'
  } catch {
    return 'en'
  }
}

export function formatMessage(message: Message, params: Params, locale: string): string {
  const template = typeof message === 'string' ? message :
    message[new Intl.PluralRules('en').select(Number(params.count)) === 'one' ? 'one' : 'other']
  return template.replace(/\{(\w+)\}/g, (token, name: string) => {
    const value = params[name]
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value ?? token
  })
}

export function translate(key: keyof typeof en, params: Params = {}, locale = 'en'): string {
  return formatMessage(en[key], params, safeLocale(locale))
}
