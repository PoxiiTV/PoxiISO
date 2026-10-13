import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve, sep } from 'node:path'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { fileSystemOf, listUsb, resolveVentoyRoot, waitForDataRoot } from './usb'
import { copyIsos, deleteIso, freeSpace, isIsoName, listIsos, FAT32_MAX, ISO_EXTS } from './isos'
import { loadCatalog, normalizeUrl, resolveEntry, REMOTE_CATALOG, type Catalog } from './catalog'
import { clearParts, downloadFile, partFiles } from './download'
import { runVentoy, selectPlugson, validateInstall } from './ventoy'
import { applyTheme, previewItems, SAMPLE_ISOS, type MenuClass } from './theme'
import { brandDrive } from './brand'
import { PLUGSON_URL, plugsonRunning, startPlugson, stopPlugson } from './plugson'

const engineDir = app.isPackaged
  ? join(process.resourcesPath, 'engine', 'ventoy')
  : join(app.getAppPath(), 'engine', 'ventoy')

const themeSrc = app.isPackaged
  ? join(process.resourcesPath, 'boot-theme')
  : join(app.getAppPath(), 'boot-theme')

// build/ no va dentro del asar: empaquetado, el icono viaja como recurso aparte
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'poxiiso.ico')
  : join(app.getAppPath(), 'build', 'icon.ico')

let win: BrowserWindow
let busy = false

function create() {
  win = new BrowserWindow({
    width: 980, height: 640, minWidth: 880, minHeight: 600,
    frame: false, backgroundColor: '#0a0e14', show: false,
    icon: iconPath,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.show())
}

ipcMain.handle('usb:list', () => listUsb())
ipcMain.handle('dict', () => {
  const rd = (n: string) => JSON.parse(readFileSync(join(__dirname, '..', 'i18n', n), 'utf8'))
  return { es: rd('es.json'), en: rd('en.json') }
})
ipcMain.handle('install', async (_e, raw: unknown) => {
  if (busy || copyAbort) return { ok: false, code: 'BUSY' }
  busy = true
  try {
    const o = validateInstall(raw, await listUsb()) // lista recién leída: el disco tiene que seguir siendo ese USB
    await runVentoy(o, engineDir, p => win.webContents.send('progress', p))
    const root = await waitForDataRoot(o.phyDrive)
    const theme = () => (root ? applyTheme(root, themeSrc, o.mode, o.lang) : false)
    // recién montada, la unidad a veces aún no deja escribir: un segundo intento tras 3 s
    const themeOk = theme() || (await new Promise(r => setTimeout(r, 3000)), theme())
    if (root) await brandDrive(root, iconPath)
    return { ok: true, theme: themeOk, letter: root ? root[0] : null }
  } catch (e) {
    const m = (e as Error).message
    return { ok: false, code: ['TIMEOUT', 'BAD_INPUT', 'NOT_ALLOWED'].includes(m) ? m : 'INSTALL_FAILED' }
  } finally {
    busy = false
    // el portable borra su carpeta temporal al cerrar: se guarda el log de Ventoy para poder ver qué pasó
    try { mkdirSync(app.getPath('logs'), { recursive: true }); copyFileSync(join(engineDir, 'cli_log.txt'), join(app.getPath('logs'), 'ventoy-ultimo.log')) } catch { /* sin log */ }
  }
})
// Toda operación con ISOs exige una letra que pertenezca a un USB con PoxiISO: nunca C: ni discos duros.
async function ventoyRoot(letter: unknown): Promise<string | null> {
  if (typeof letter !== 'string') return null
  return resolveVentoyRoot(await listUsb().catch(() => []), letter)
}
let copyAbort: AbortController | null = null

ipcMain.handle('isos:list', async (_e, letter: string) => {
  const root = await ventoyRoot(letter)
  if (!root) return { ok: false, code: 'NOT_ALLOWED' }
  try { return { ok: true, files: listIsos(root), freeBytes: freeSpace(root) } } catch { return { ok: false, code: 'READ_FAILED' } }
})
ipcMain.handle('isos:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'ISO / IMG / WIM / VHD', extensions: ISO_EXTS.map(e => e.slice(1)) }],
  })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('isos:copy', async (_e, letter: string, paths: unknown) => {
  if (typeof letter !== 'string') return { ok: false, code: 'NOT_ALLOWED' }
  const disks = await listUsb().catch(() => [])
  const root = resolveVentoyRoot(disks, letter)
  if (!root) return { ok: false, code: 'NOT_ALLOWED' }
  const fat32 = fileSystemOf(disks, letter)?.toUpperCase() === 'FAT32'
  if (busy || copyAbort) return { ok: false, code: 'BUSY' }
  if (!Array.isArray(paths) || !paths.every(p => typeof p === 'string')) return { ok: false, code: 'BAD_INPUT' }
  copyAbort = new AbortController()
  try {
    const result = await copyIsos(root, paths, p => win.webContents.send('isos:progress', p), { signal: copyAbort.signal, maxFileBytes: fat32 ? FAT32_MAX : undefined })
    return { ok: true, result }
  } catch (e) {
    const m = (e as Error).message
    return { ok: false, code: m === 'NO_SPACE' || m === 'CANCELLED' ? m : 'COPY_FAILED' }
  } finally { copyAbort = null }
})
ipcMain.on('isos:cancel', () => copyAbort?.abort())
ipcMain.handle('isos:delete', async (_e, letter: string, rel: unknown) => {
  const root = await ventoyRoot(letter)
  if (!root || typeof rel !== 'string') return { ok: false, code: 'NOT_ALLOWED' }
  try { deleteIso(root, rel); return { ok: true } } catch { return { ok: false, code: 'DELETE_FAILED' } }
})
// ---- Descargas: a una carpeta del PC (nunca directo al USB); después se copia con isos:copy ----
const dlDir = join(app.getPath('downloads'), 'PoxiISO')
let dlAbort: AbortController | null = null
let catalogCache: { catalog: Catalog; source: 'remote' | 'bundled' } | null = null

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error('HTTP')
  const text = await r.text()
  if (text.length > 1_000_000) throw new Error('TOO_BIG')
  return text
}
async function getCatalog() {
  if (!catalogCache) {
    const bundled = JSON.parse(readFileSync(join(app.getAppPath(), 'data', 'isos.json'), 'utf8'))
    catalogCache = await loadCatalog(() => fetchText(REMOTE_CATALOG), bundled)
  }
  return catalogCache
}

ipcMain.handle('dl:catalog', async () => { const c = await getCatalog(); return { items: c.catalog.items, source: c.source, dir: dlDir } })
ipcMain.handle('dl:start', async (_e, arg: unknown) => {
  if (busy || copyAbort || dlAbort) return { ok: false, code: 'BUSY' }
  if (!arg || typeof arg !== 'object') return { ok: false, code: 'BAD_INPUT' }
  const a = arg as { id?: unknown; url?: unknown }
  dlAbort = new AbortController()
  try {
    let target: { url: string; fileName?: string; sha256?: string }
    if (typeof a.id === 'string') {
      const entry = (await getCatalog()).catalog.items.find(i => i.id === a.id && i.kind === 'download')
      if (!entry) return { ok: false, code: 'BAD_INPUT' }
      target = await resolveEntry(entry, fetchText)
    } else if (typeof a.url === 'string') {
      target = { url: normalizeUrl(a.url) }
    } else return { ok: false, code: 'BAD_INPUT' }
    const path = await downloadFile(target.url, dlDir, target.fileName, {
      sha256: target.sha256, signal: dlAbort.signal, onProgress: p => win.webContents.send('dl:progress', p),
    })
    return { ok: true, path, verified: !!target.sha256 }
  } catch (e) {
    const m = (e as Error).message
    const known = ['CANCELLED', 'NETWORK', 'HTTP_ERROR', 'HTML_RESPONSE', 'NO_SPACE', 'SHA_MISMATCH', 'NOT_ISO', 'BAD_URL', 'NO_MATCH', 'SUMS_FAILED']
    return { ok: false, code: known.includes(m) ? m : 'DL_FAILED' }
  } finally { dlAbort = null }
})
ipcMain.on('dl:cancel', () => dlAbort?.abort())
ipcMain.handle('dl:openPage', async (_e, id: unknown) => {
  const entry = (await getCatalog()).catalog.items.find(i => i.id === id && i.kind === 'page')
  if (!entry?.url) return false
  await shell.openExternal(entry.url) // solo URLs https del catálogo validado
  return true
})
ipcMain.on('dl:openFolder', () => { void shell.openPath(dlDir) })
// Borra la ISO descargada una vez copiada al USB. Solo dentro de la carpeta de descargas de PoxiISO.
ipcMain.handle('dl:cleanup', (_e, p: unknown) => {
  if (typeof p !== 'string') return false
  const base = resolve(dlDir), t = resolve(p)
  if (!t.startsWith(base + sep) || !isIsoName(t.slice(base.length + 1))) return false
  try { rmSync(t, { force: true }); return true } catch { return false }
})
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dlDir, parts: partFiles(dlDir) }))
ipcMain.handle('dl:clearParts', () => {
  if (dlAbort) return { ok: false, code: 'BUSY' } // la descarga en curso escribe en su .part
  try { clearParts(dlDir); return { ok: true } } catch { return { ok: false, code: 'DELETE_FAILED' } }
})
const LINKS: Record<string, string> = { repo: 'https://github.com/poxiitv/PoxiISO' }
ipcMain.on('open-link', (_e, k: unknown) => { if (typeof k === 'string' && Object.hasOwn(LINKS, k)) void shell.openExternal(LINKS[k]) })
// Plugson (configurador web del menú): su ventanita de Ventoy se maneja oculta y el configurador se abre en el navegador.
let plugsonLetter: string | null = null
ipcMain.handle('plugson:start', async (_e, letter: unknown, lang: unknown) => {
  if (busy) return { ok: false, code: 'BUSY' }
  const root = await ventoyRoot(letter)
  if (!root) return { ok: false, code: 'NOT_ALLOWED' }
  selectPlugson(engineDir, lang)
  try {
    await startPlugson(join(engineDir, 'VentoyPlugson.exe'), engineDir, root[0], () => {
      plugsonLetter = null
      if (!win.isDestroyed()) win.webContents.send('plugson:closed')
    })
    plugsonLetter = root[0]
    return { ok: true }
  } catch (e) {
    const m = (e as Error).message
    return { ok: false, code: ['NO_DIALOG', 'NO_DISK', 'NO_SERVER'].includes(m) ? m : 'NO_DIALOG' }
  }
})
// Vista previa del menú: las ISOs del USB con el icono que les pondrá Ventoy (o un ejemplo si no hay USB o está vacío)
ipcMain.handle('boot:preview', async (_e, letter: unknown) => {
  const classesOf = (p: string): MenuClass[] | null => {
    try { const c = JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')).menu_class; return Array.isArray(c) ? c : null } catch { return null }
  }
  const base = classesOf(join(themeSrc, 'ventoy.json')) ?? []
  const root = await ventoyRoot(letter)
  if (root) {
    try {
      const names = listIsos(root).map(f => f.name)
      // el menu_class del propio USB manda (puede haberlo cambiado en el configurador)
      if (names.length) return { sample: false, items: previewItems(names, classesOf(join(root, 'ventoy', 'ventoy.json')) ?? base) }
    } catch { /* se enseña el ejemplo */ }
  }
  return { sample: true, items: previewItems(SAMPLE_ISOS, base) }
})
ipcMain.handle('plugson:status', () => (plugsonRunning() ? plugsonLetter : null))
ipcMain.on('plugson:stop', () => { stopPlugson(); plugsonLetter = null })
ipcMain.on('plugson:reopen', () => { if (plugsonRunning()) void shell.openExternal(PLUGSON_URL) })
app.on('will-quit', () => stopPlugson())
ipcMain.on('win', (_e, a: 'min' | 'max' | 'close') => {
  if (a === 'min') win.minimize()
  else if (a === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize())
  else win.close()
})

// Una sola ventana: dos PoxiISO a la vez podrían instalar o copiar sobre el mismo USB
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.whenReady().then(create)
}
app.on('window-all-closed', () => app.quit())
