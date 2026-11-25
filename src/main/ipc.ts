import { requiredPlugins, pluginKey } from '../shared/plugins'
import { readLv2Ports } from './plugin-session'
import { ProjectPlugins } from './project-plugins'
import { projectSchema } from '../shared/schema'
import type { Project } from '../shared/model'
import type { PluginCommand } from '../shared/plugins'
import { detectCarla, findExecutable, PluginHost } from './plugin-host'
import { discoverPlugins } from './plugin-discovery'
import { exportPortable, importPortable } from './portable'
import { createPracticeProject, keepPracticeProject } from './tutorial-practice'
import { fromFiles } from '../shared/project-files'
import { rm, stat } from 'node:fs/promises'
import { readScoreXml } from './score-xml'
import { FluidSynthProcess, detectFluid } from './fluidsynth'
import { convertScore, detectMuseScore } from './musescore'
import { atomicWrite } from './project-io'
import type { Source } from '../shared/model'
import { isWindowSender } from './window-sender'
import { AudioCache } from './audio-cache'
import { audioExtension, audioFormats, type AudioPeaks } from '../shared/audio'
import { relaunchArgs } from './relaunch'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { basename, dirname, join } from 'node:path'
import type { FileMap } from '../shared/api'
import { ProjectIO, confined } from './project-io'
import { ProjectWatcher } from './watcher'
import { fileTokens } from './protocols'
import { loadSettings, saveSettings } from './settings'
import { liveProject } from '../shared/template'
import {
  defaultSoundfontDirs,
  findSoundfont,
  indexSoundfonts,
  scanSoundfonts,
} from './soundfonts'
import type { Windows } from './windows'

export function installIpc(windows: Windows): () => Promise<void> {
  const { ui } = windows
  const io = new ProjectIO()
  const audioCache = new AudioCache(() => io.folder)
  const watcher = new ProjectWatcher()
  const fluid = new FluidSynthProcess((event) => {
    for (const window of [ui, windows.getEngine()])
      if (!window.isDestroyed()) window.webContents.send('fluid:event', event)
  })
  const indexPlugins = (force=false) => discoverPlugins(join(app.getPath('userData'),'plugin-index.json'), undefined, force)
  const host = new PluginHost(event => {
    for(const window of [ui,windows.getEngine()]) if (!window.isDestroyed()) window.webContents.send('plugins:state',event)
  },process.env.XM_CARLA_DUMMY_TEST==='1'?'SDL':'JACK',undefined,join(app.getAppPath(),'resources/plugins/carla-control.py'))
  const plugins = new ProjectPlugins(host, join(app.getAppPath(),'resources/plugins/lv2-ports.py'),
    async () => (await indexPlugins()).plugins)
  const watchEngine = (
    _event: Electron.Event | undefined,
    window: BrowserWindow,
  ): void => {
    if (window === ui) return
    window.webContents.once('render-process-gone', () => {
      void fluid.stop()
      void plugins.stop()
    })
    window.once('closed', () => {
      void fluid.stop()
      void plugins.stop()
    })
  }
  watchEngine(undefined, windows.getEngine())
  app.on('browser-window-created', watchEngine)
  function fluidHandle(
    name: string,
    engineOnly: boolean,
    fn: (...args: never[]) => unknown,
  ): void {
    ipcMain.handle(name, (event, ...args) => {
      if (
        !(
          isWindowSender(windows.getEngine(), event) ||
          (!engineOnly && isWindowSender(ui, event))
        ) ||
        !event.senderFrame?.url.startsWith('app://xmxsplayer/')
      )
        throw Error('Forbidden')
      return fn(...(args as never[]))
    })
  }
  fluidHandle('fluid:detect', false, (path?: string) =>
    detectFluid(path ?? loadSettings().fluid.path),
  )
  fluidHandle('plugins:configure', true, async(project:Project,playing:boolean) => {
    if(process.env.XM_SMOKE==='1'||!io.folder) throw Error('Open a project before starting plugins')
    return plugins.configure(io.folder,projectSchema.parse(project),loadSettings().carlaPath,async()=>{
      if(!playing) return true
      const result=await dialog.showMessageBox(ui,{type:'question',message:'Apply plugin changes while playing?',
        detail:'Plugin notes will stop while Carla reloads the audio connections.',buttons:['Apply now','Apply after playback'],defaultId:1,cancelId:1})
      return result.response===0
    }, playing)
  })
  fluidHandle('plugins:send',true,(id:string,command:PluginCommand,values:number[])=>plugins.send(id,command,values))
  fluidHandle('fluid:start', true, () => {
    if (process.env.XM_SMOKE === '1')
      throw Error('FluidSynth is disabled during smoke checks')
    const settings = loadSettings()
    return fluid.start({
      ...settings.fluid,
      sampleRate: settings.audio.sampleRate,
    })
  })
  fluidHandle('fluid:stop', true, () => fluid.stop())
  fluidHandle('fluid:load', true, async (url: string) => {
    const path = await fileTokens.pathFor(url)
    if (!/\.sf[23]$/i.test(path)) throw Error('Choose an SF2 or SF3 soundfont')
    return fluid.load(path)
  })
  fluidHandle('fluid:presets', true, (font: number) => fluid.presets(font))
  fluidHandle('fluid:unload', true, (font: number) => fluid.unload(font))
  fluidHandle('fluid:send', true, (lines: string[]) => fluid.send(lines))
  let operations = Promise.resolve<unknown>(undefined)
  function handle(name: string, fn: (...args: never[]) => unknown): void {
    ipcMain.handle(name, (event, ...args) => {
      if (
        !isWindowSender(ui, event) ||
        !event.senderFrame?.url.startsWith('app://xmxsplayer/')
      )
        throw new Error('Forbidden')
      const work = operations.then(() => fn(...(args as never[])))
      operations = work.catch(() => undefined)
      return work
    })
  }
  const watch = async (): Promise<void> => {
    await plugins.stop()
    fileTokens.clear()
    await watcher.start(
      io,
      (changes) => {
        if (!ui.isDestroyed()) ui.webContents.send('project:changed', changes)
      },
      (change) => {
        if (!ui.isDestroyed()) ui.webContents.send('scores:changed', change)
      },
    )
  }
  handle('scores:xml', (file: string) => {
    if (!io.folder) throw Error('Open a project first')
    return readScoreXml(io.folder, file)
  })
  handle('scores:detect', (path?: string) =>
    detectMuseScore(path ?? loadSettings().musescorePath),
  )
  handle('scores:convert', async (source: Source) => {
    if (
      !source ||
      !['mscz', 'mid', 'musicxml'].includes(source.kind) ||
      typeof source.file !== 'string'
    )
      throw Error('Invalid score source')
    if (!io.folder) throw Error('Open a project first')
    const executable =
      source.kind === 'mscz'
        ? (await detectMuseScore(loadSettings().musescorePath)).path
        : ''
    return convertScore(io.folder, source, executable)
  })
  async function openFile(file: string): Promise<void> {
    if (!io.folder) throw Error('Open a project first')
    const error = await shell.openPath(await confined(io.folder, file))
    if (error) throw Error(error)
  }
  handle('scores:open', openFile)
  handle('scores:export', async (file: string, bytes: Uint8Array) => {
    if (
      !/^scores\/export\/[a-z0-9-]+\.mid$/.test(file) ||
      !(bytes instanceof Uint8Array)
    )
      throw Error('Invalid MIDI export')
    await atomicWrite(await confined(io.folder, file), bytes)
    await openFile(file)
    return file
  })
  let restored = false
  handle('project:restore', async () => {
    if (restored) return null
    restored = true
    const index = process.argv.indexOf('--reopen-project')
    if (index < 0 || !process.argv[index + 1]) return null
    const snapshot = await io.open(process.argv[index + 1])
    await watch()
    return snapshot
  })
  let practice: { folder: string; original: string } | null = null
  async function switchProject(folder: string) {
    const previous = { folder: io.folder, hashes: io.hashes }
    try {
      if (folder) {
        const snapshot = await io.open(folder)
        await watch()
        return snapshot
      }
      await plugins.stop()
      await watcher.close()
      fileTokens.clear()
      io.folder = ''
      io.hashes = {}
      return null
    } catch (error) {
      Object.assign(io, previous)
      if (previous.folder) await watch()
      throw error
    }
  }
  function requireFinishedPractice(): void {
    if (practice) throw Error('Finish the current practice session first')
  }
  handle('project:startPractice', async (files: FileMap | null) => {
    requireFinishedPractice()
    const original = io.folder
    const source = original ? { folder: original, files: files ?? await io.readAll() } : null
    const fonts = source ? [] : await scanSoundfonts(directories())
    const copy = await createPracticeProject(app.getPath('userData'), source, fonts.find(sf => sf.gm)?.file)
    try {
      await switchProject(copy.folder)
    } catch (error) {
      await rm(copy.folder, { recursive: true, force: true })
      throw error
    }
    practice = { folder: copy.folder, original }
    return copy
  })
  function currentPractice() {
    if (!practice || io.folder !== practice.folder) throw Error('Open a practice session first')
    return practice
  }
  handle('project:keepPractice', async (files: FileMap) => {
    const session = currentPractice()
    const result = await dialog.showSaveDialog(ui, {
      title: 'Save as project…', defaultPath: join(app.getPath('documents'), 'Tutorial project'),
      buttonLabel: 'Save project',
    })
    if (result.canceled || !result.filePath) return null
    await host.saveStates()
    const saved = await keepPracticeProject(result.filePath, { folder: session.folder, files })
    await switchProject(saved.folder)
    practice = null
    await rm(session.folder, { recursive: true, force: true }).catch(error => console.error('Practice folder cleanup failed', error))
    return saved
  })
  handle('project:discardPractice', async () => {
    const session = currentPractice()
    const original = await switchProject(session.original)
    practice = null
    await rm(session.folder, { recursive: true, force: true }).catch(error => console.error('Practice folder cleanup failed', error))
    return original
  })
  handle('project:create', async () => {
    requireFinishedPractice()
    const result = await dialog.showOpenDialog(ui, {
      title: 'Choose an empty project folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const available = await scanSoundfonts(directories())
    const template = liveProject(
      basename(result.filePaths[0]),
      available.find((sf) => sf.gm)?.file,
    )
    const snapshot = await io.create(result.filePaths[0], template)
    await watch()
    return snapshot
  })
  handle('project:open', async () => {
    requireFinishedPractice()
    const result = await dialog.showOpenDialog(ui, {
      title: 'Open project folder or project.yaml',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Project', extensions: ['yaml'] }],
    })
    if (result.canceled) return null
    const chosen = result.filePaths[0]
    const snapshot = await io.open(
      chosen.endsWith('.yaml') ? dirname(chosen) : chosen,
    )
    await watch()
    return snapshot
  })
  handle('project:exportPortable', async () => {
    if (!io.folder) throw new Error('Open a project first')
    const project = fromFiles(await io.readAll())
    const result = await dialog.showSaveDialog(ui, {
      title: 'Export portable project',
      defaultPath: join(dirname(io.folder), basename(io.folder) + '.xmxs.zip'),
      filters: [{ name: 'Portable project', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return null
    await exportPortable(io.folder, result.filePath, project.soundfonts.map(font => font.file),
      directories(), app.getVersion(), requiredPlugins(project).map(pluginKey))
    return result.filePath
  })
  handle('project:openPortable', async () => {
    requireFinishedPractice()
    const archive = await dialog.showOpenDialog(ui, {
      title: 'Open portable project', properties: ['openFile'],
      filters: [{ name: 'Portable project', extensions: ['zip'] }],
    })
    if (archive.canceled) return null
    const folder = await dialog.showOpenDialog(ui, {
      title: 'Choose an empty folder for the project', properties: ['openDirectory', 'createDirectory'],
    })
    if (folder.canceled) return null
    const manifest = await importPortable(archive.filePaths[0], folder.filePaths[0])
    const snapshot = await io.open(folder.filePaths[0])
    await watch()
    if (manifest.requiredPlugins.length) {
      const available = await discoverPlugins(join(app.getPath('userData'), 'plugin-index.json'))
      const installed = new Set(available.plugins.map(pluginKey))
      const missing = manifest.requiredPlugins.filter(key => !installed.has(key))
      if (missing.length) await dialog.showMessageBox(ui, {
        type: 'warning', message: 'Install these plugins to play every part of this project',
        detail: missing.join('\n'),
      })
    }
    return snapshot
  })
  handle('project:save', async(files: FileMap, hashes: Record<string,string>) => {
    await host.saveStates()
    return io.save(files,hashes)
  })
  handle('plugins:editor',(id:string)=>host.editor(id))
  handle('project:import', async (kind: 'audio' | 'score' | 'midi' | 'soundfont' | 'pdf') => {
    if (!['audio', 'score', 'midi','soundfont','pdf'].includes(kind))
      throw new Error('Invalid import kind')
    const result = await dialog.showOpenDialog(ui, {
      title: kind === 'score' ? 'Link score' : 'Import file',
      ...(kind === 'pdf' ? { filters:[{name:'PDF sheet music',extensions:['pdf']}] } : {}),
      ...(kind === 'soundfont' ? { filters:[{name:'Soundfonts',extensions:['sf2','sf3']}] } : {}),
      properties: ['openFile'],
      ...(kind === 'score'
        ? {
            filters: [
              {
                name: 'Scores',
                extensions: ['mscz', 'mscx', 'mid', 'musicxml', 'mxl'],
              },
            ],
          }
        : {}),
    })
    return result.canceled ? null : io.importFile(kind, result.filePaths[0])
  })
  handle('project:importDropped', (file: string) => {
    if (typeof file !== 'string' || !audioFormats.has(audioExtension(file)))
      throw Error('Choose WAV, MP3, OGG, FLAC or M4A audio')
    return io.importFile('audio', file)
  })
  handle('audio:source', async (file: string, rate: number) => {
    const source = await audioCache.source(file, rate)
    return {
      ...source,
      file: undefined,
      url: await fileTokens.issue(source.file, [io.folder]),
    }
  })
  handle(
    'audio:spectrumCache',
    (
      file: string,
      key: string,
      rate: number,
      mode: string,
      data?: ArrayBuffer,
    ) => audioCache.spectrum(file, key, rate, mode, data),
  )
  handle('audio:cache', (file: string, key: string, data: AudioPeaks) =>
    audioCache.store(file, key, data),
  )
  handle('project:url', async (path: string) => {
    if (!io.folder) throw new Error('Open a project first')
    return fileTokens.issue(await confined(io.folder, path), [io.folder])
  })
  function directories(): string[] {
    const settings = loadSettings()
    const configured = settings.soundfontDirs
    return [
      ...(io.folder ? [join(io.folder, 'soundfonts')] : []),
      ...(settings.soundfontDirsConfigured || configured.length ? configured : defaultSoundfontDirs()),
    ]
  }
  async function pickSoundfont(
    title: string,
  ): Promise<{ file: string; url: string } | null> {
    const chosen = await dialog.showOpenDialog(ui, {
      title,
      properties: ['openFile'],
      filters: [{ name: 'Soundfonts', extensions: ['sf2', 'sf3'] }],
    })
    if (chosen.canceled) return null
    const path = chosen.filePaths[0]
    const settings = loadSettings()
    const folder = dirname(path)
    settings.soundfontDirs = [
      ...new Set([
        ...(settings.soundfontDirsConfigured || settings.soundfontDirs.length
          ? settings.soundfontDirs
          : defaultSoundfontDirs()),
        folder,
      ]),
    ]
    saveSettings(settings)
    return { file: basename(path), url: await fileTokens.issue(path, [folder]) }
  }
  handle('soundfonts:index',()=>indexSoundfonts(directories(),join(app.getPath('userData'),'soundfont-index.json')))
  handle('soundfonts:dirs:get',()=>{ const s=loadSettings();return s.soundfontDirsConfigured || s.soundfontDirs.length?s.soundfontDirs:defaultSoundfontDirs() })
  handle('soundfonts:dirs:set',(dirs:string[])=>{
    if(!Array.isArray(dirs)||dirs.some(dir=>typeof dir!=='string'||!dir.trim()))throw Error('Invalid soundfont folders')
    saveSettings({...loadSettings(),soundfontDirsConfigured:true,soundfontDirs:[...new Set(dirs)]})
  })
  handle('soundfonts:dirs:choose',async()=>{
    const result=await dialog.showOpenDialog(ui,{properties:['openDirectory'],title:'Add soundfont folder'})
    return result.canceled?null:result.filePaths[0]
  })
  handle('soundfonts:copy',async(file:string)=>{
    const found=await findSoundfont(file,directories())
    if(!found)throw Error(`Missing soundfont: ${file}`)
    if(io.folder && dirname(found)===join(io.folder,'soundfonts'))return file
    return basename(await io.importFile('soundfont',found))
  })
  handle('soundfonts:scan', () => scanSoundfonts(directories()))
  handle('soundfonts:resolve', async (file: string, locate = false) => {
    const dirs = directories()
    const found = await findSoundfont(file, dirs)
    if (found) return { file, bytes:(await stat(found)).size, url: await fileTokens.issue(found, dirs) }
    return locate ? pickSoundfont(`Locate missing soundfont — ${file}`) : null
  })
  handle('soundfonts:pick', () => pickSoundfont('Add soundfont'))
  handle('app:confirmClose', async () => {
    const result = await dialog.showMessageBox(ui, {
      type: 'question',
      title: 'Unsaved changes',
      message: 'Discard unsaved changes and quit?',
      buttons: ['Discard and quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  })
  handle('app:relaunch', async () => {
    await windows.stopEngine()
    app.relaunch({ args: relaunchArgs(process.argv.slice(1), io.folder) })
    app.exit(0)
  })
  handle('plugins:ports', async(format:string,uri:string) => {
    if(format !== 'lv2') return null
    return (await readLv2Ports(join(app.getAppPath(),'resources/plugins/lv2-ports.py'),[uri]))[uri] ?? null
  })
  handle('plugins:detect', () => detectCarla(loadSettings().carlaPath))
  handle('plugins:scan', async(force?:boolean) => {
    const result = await indexPlugins(force===true)
    plugins.setInventory(result.plugins)
    const standalone: string[] = []
    if (await findExecutable('hydrogen')) standalone.push('Hydrogen')
    if (await findExecutable('zynaddsubfx')) standalone.push('ZynAddSubFX')
    return { ...result, standalone }
  })
  handle('settings:get', () => loadSettings())
  handle('settings:set', (value) => saveSettings(value))
  return async () => {
    app.removeListener('browser-window-created', watchEngine)
    await Promise.all([watcher.close(), fluid.stop(), plugins.stop()])
  }
}
