interface UsbDisk { number: number; name: string; sizeBytes: number; letters: string[]; hasVentoy: boolean; labels?: string[] }
interface Opts { mode: 'install' | 'update'; phyDrive: number; gpt: boolean; secureBoot: boolean; fs: 'exFAT' | 'NTFS' | 'FAT32'; reserveMB: number; lang?: Lang }
interface IsoFile { rel: string; name: string; sizeBytes: number }
interface CopyProgress {
  file: string; fileIndex: number; fileCount: number
  fileBytes: number; fileTotal: number; doneBytes: number; totalBytes: number
}
type IsoList = { ok: true; files: IsoFile[]; freeBytes: number } | { ok: false; code: string }
type CopyRes = { ok: true; result: { copied: string[]; skipped: { file: string; reason: string }[] } } | { ok: false; code: string }
interface CatEntry { id: string; group: 'windows' | 'linux' | 'gaming' | 'tools' | 'server' | 'other'; name: string; desc: string; recommended?: boolean; featured?: boolean; en?: { name: string; desc: string }; kind: 'download' | 'page'; sizeBytes?: number }
interface DlProgress { phase: 'downloading' | 'verifying'; doneBytes: number; totalBytes: number; speedBps: number }
type DlRes = { ok: true; path: string; verified: boolean } | { ok: false; code: string }
interface PoxiApi {
  listUsb(): Promise<UsbDisk[]>
  install(o: Opts): Promise<{ ok: true; theme: boolean; letter: string | null } | { ok: false; code: string }>
  onProgress(cb: (p: number) => void): void
  dict(): Promise<{ es: Record<string, string>; en: Record<string, string> }>
  listIsos(letter: string): Promise<IsoList>
  pickIsos(): Promise<string[]>
  copyIsos(letter: string, paths: string[]): Promise<CopyRes>
  cancelCopy(): void
  deleteIso(letter: string, rel: string): Promise<{ ok: boolean; code?: string }>
  onIsoProgress(cb: (p: CopyProgress) => void): void
  pathsFromFiles(files: File[]): string[]
  dlCatalog(): Promise<{ items: CatEntry[]; source: string; dir: string }>
  dlStart(arg: { id: string } | { url: string }): Promise<DlRes>
  dlCancel(): void
  dlOpenPage(id: string): Promise<boolean>
  dlOpenFolder(): void
  dlCleanup(path: string): Promise<boolean>
  onDlProgress(cb: (p: DlProgress) => void): void
  plugsonStart(letter: string, lang: Lang): Promise<{ ok: boolean; code?: string }>
  plugsonStatus(): Promise<string | null>
  bootPreview(letter: string | null): Promise<{ sample: boolean; items: { name: string; cls: string }[] }>
  plugsonStop(): void
  plugsonReopen(): void
  onPlugsonClosed(cb: () => void): void
  appInfo(): Promise<{ version: string; dlDir: string; parts: { count: number; bytes: number } }>
  dlClearParts(): Promise<{ ok: boolean; code?: string }>
  openLink(k: 'repo'): void
  win(a: 'min' | 'max' | 'close'): void
}
declare const poxi: PoxiApi

let dict = { es: {} as Record<string, string>, en: {} as Record<string, string> }

type Lang = 'es' | 'en'
/** Idioma de la interfaz: se recuerda en este PC. Si el almacenamiento falla, español. */
let lang: Lang = (() => { try { return localStorage.getItem('lang') === 'en' ? 'en' : 'es' } catch { return 'es' } })()
const locale = () => (lang === 'en' ? 'en-US' : 'es-ES')

const t = (k: string, v: Record<string, string | number> = {}): string =>
  (dict[lang][k] ?? dict.es[k] ?? dict.en[k] ?? k).replace(/\{(\w+)\}/g, (m, n) => (n in v ? String(v[n]) : m))

type Child = Node | string | null
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, unknown> = {}, ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (v === true) el.setAttribute(k, '')
    else if (v !== false && v != null) el.setAttribute(k, String(v))
  }
  for (const c of kids) if (c != null) el.append(c)
  return el
}

/** Nombre visible de la clave de volumen: "E:" en Windows, "PoxiISO" (último tramo de /Volumes/PoxiISO) en macOS. */
const volName = (key: string | null) => (key && key.length === 1 ? `${key}:` : (key ?? '').split('/').pop() ?? '')

/** "PoxiISO (E:)" si la unidad tiene nombre; si no, "Unidad E:". */
const volText = (d: UsbDisk) => d.letters.map((l, i) => (d.labels?.[i] ? `${d.labels[i]} (${volName(l)})` : t('usb.letters', { letters: volName(l) }))).join(' · ')

const errText = (code: string) => (t(`err.${code}`) === `err.${code}` ? t('err.generic') : t(`err.${code}`))

const formatBytes = (n: number) =>
  n >= 2 ** 30 ? `${(n / 2 ** 30).toLocaleString(locale(), { maximumFractionDigits: 1 })} GB`
                : `${Math.round(n / 2 ** 20)} MB`

const svg = (inner: string, size = 24) => {
  const w = document.createElement('span')
  w.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
  return w.firstElementChild as SVGElement
}
const USB_ICON = '<rect x="7" y="2" width="10" height="7" rx="1.5"/><path d="M9 9v3a3 3 0 0 0 6 0V9M12 15v7"/>'
const WARN_ICON = '<path d="M12 9v4m0 4h.01M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
const SHIELD_ICON = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'
const DISC_ICON = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2.5"/>'
const TRASH_ICON = '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>'
const UPLOAD_ICON = '<path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'
const CHEVRON_ICON = '<path d="M6 9l6 6 6-6"/>'
const CHECK_ICON = '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
const SLIDERS_ICON = '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>'
const SEARCH_ICON = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
const tile = (inner: string, cls = '') => { const d = h('div', { class: `tile ${cls}`.trim() }); d.append(svg(inner)); return d }

interface DdOpt<T> { value: T; label: string; hint?: string }
let ddSeq = 0
/** Desplegable con el estilo de la app (el <select> nativo abre la lista gris de Windows). Teclado: flechas, Enter, Esc. */
function dropdown<T extends string>(label: string, opts: DdOpt<T>[], value: T, onChange: (v: T) => void) {
  let cur = value
  const id = `dd${++ddSeq}`
  const text = h('span', { class: 'dd-v' })
  const btn = h('button', { class: 'dd-btn', type: 'button', 'aria-label': label, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id },
    text, svg(CHEVRON_ICON, 16))
  const rows = opts.map((o, i) => h('div', {
    class: 'dd-opt', role: 'option', id: `${id}-${i}`,
    onpointerdown: (e: Event) => e.preventDefault(), // el foco se queda en el botón: así no se cierra antes de elegir
    onpointermove: () => setActive(i), onclick: () => pick(i),
  }, h('span', {}, o.label, o.hint ? h('small', {}, o.hint) : null), svg(CHECK_ICON, 15)))
  const wrap = h('div', { class: 'dd' }, btn, h('div', { class: 'dd-list', role: 'listbox', id, 'aria-label': label }, ...rows))
  let active = -1
  const isOpen = () => wrap.classList.contains('open')
  const setActive = (i: number) => {
    active = i
    rows.forEach((r, j) => r.classList.toggle('act', j === i))
    if (i >= 0) btn.setAttribute('aria-activedescendant', rows[i].id); else btn.removeAttribute('aria-activedescendant')
  }
  const paint = () => {
    const i = opts.findIndex(o => o.value === cur)
    text.textContent = opts[i]?.label ?? ''
    rows.forEach((r, j) => { r.classList.toggle('sel', j === i); r.setAttribute('aria-selected', String(j === i)) })
  }
  const open = () => { wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); setActive(opts.findIndex(o => o.value === cur)) }
  const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); setActive(-1) }
  const pick = (i: number) => { close(); if (opts[i].value !== cur) { cur = opts[i].value; paint(); onChange(cur) } }
  btn.addEventListener('click', () => (isOpen() ? close() : open()))
  btn.addEventListener('blur', close) // clic fuera o Tab
  btn.addEventListener('keydown', e => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step) { e.preventDefault(); if (!isOpen()) open(); else setActive((active + step + opts.length) % opts.length) }
    else if ((e.key === 'Enter' || e.key === ' ') && isOpen()) { e.preventDefault(); if (active >= 0) pick(active) }
    else if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close() }
  })
  paint()
  return wrap
}

/** Sección plegable con el estilo de la app. Cerrada, su contenido no recibe foco (inert). */
function disclosure(icon: string, title: string, hint: string, open: boolean, onToggle: (open: boolean) => void, ...content: Child[]) {
  const inner = h('div', { class: 'disc-in' }, h('div', { class: 'disc-pad' }, ...content))
  const head = h('button', { class: 'disc-h', type: 'button', 'aria-expanded': String(open) },
    tile(icon, 'soft'),
    h('span', { class: 'disc-t' }, h('b', {}, title), h('small', {}, hint)),
    h('span', { class: 'disc-c' }, svg(CHEVRON_ICON, 18)))
  const box = h('div', { class: `disc${open ? ' open settled' : ''}` }, head, h('div', { class: 'disc-b' }, inner))
  inner.inert = !open
  head.addEventListener('click', () => {
    open = !open
    box.classList.toggle('open', open); box.classList.remove('settled')
    head.setAttribute('aria-expanded', String(open)); inner.inert = !open
    onToggle(open)
  })
  // abierta del todo, deja que los desplegables de dentro sobresalgan (durante la animación se recorta)
  box.addEventListener('transitionend', e => { if (open && e.target === box.lastElementChild) box.classList.add('settled') })
  return box
}

/** Pinta una pantalla en #view. `onLeave` se ejecuta al salir de ella (para parar temporizadores). */
let leaveCurrent: (() => void) | undefined
function show(node: HTMLElement, onLeave?: () => void) {
  leaveCurrent?.()
  leaveCurrent = onLeave
  document.getElementById('view')!.replaceChildren(node)
}
