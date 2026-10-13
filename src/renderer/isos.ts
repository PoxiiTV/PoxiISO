/** Pantalla "ISOs": copiar ISOs al USB (arrastrar o elegir), ver lo que hay y borrar. */
const isoSt = {
  disks: [] as UsbDisk[], letter: null as string | null,
  files: [] as IsoFile[], free: 0, filesKey: '', paintKey: '',
  busy: false, prog: null as CopyProgress | null,
  confirmDel: null as string | null,
  msg: null as { kind: 'ok' | 'warn' | 'err'; text: string; action?: { label: string; run: () => void } } | null,
}
let isoProgressUi: ((p: CopyProgress) => void) | null = null
let isoPaint: (() => void) | null = null

const withLetter = (d: UsbDisk) => d.hasVentoy && d.letters.length > 0

async function isoRefreshFiles() {
  if (!isoSt.letter || isoSt.busy) return
  const r = await poxi.listIsos(isoSt.letter).catch(() => null)
  if (!r || !r.ok) { isoSt.files = []; isoSt.free = 0; isoSt.filesKey = ''; return }
  const key = JSON.stringify([r.files, r.freeBytes])
  if (key === isoSt.filesKey) return
  isoSt.files = r.files; isoSt.free = r.freeBytes; isoSt.filesKey = key
}

async function isoRefresh() {
  isoSt.disks = (await poxi.listUsb().catch(() => [] as UsbDisk[])).filter(withLetter)
  if (!isoSt.disks.some(d => d.letters[0] === isoSt.letter)) {
    isoSt.letter = isoSt.disks[0]?.letters[0] ?? null
    isoSt.filesKey = ''
  }
  await isoRefreshFiles()
  // solo se repinta si cambió algo: así no se cierran desplegables ni se pierde el foco del campo de enlace
  const key = JSON.stringify([isoSt.disks, isoSt.letter, isoSt.files, isoSt.free])
  if (key !== isoSt.paintKey) { isoSt.paintKey = key; isoPaint?.() }
}

const isoMsgNow = () => isoSt.msg

function isoMessage(kind: 'ok' | 'warn' | 'err', text: string) { isoSt.msg = { kind, text } }

async function isoCopy(paths: string[], cleanup = false) {
  if (!isoSt.letter || isoSt.busy || !paths.length) return
  isoSt.busy = true; isoSt.prog = null; isoSt.msg = null; isoPaint?.()
  const r = await poxi.copyIsos(isoSt.letter, paths).catch(() => ({ ok: false as const, code: 'COPY_FAILED' }))
  isoSt.busy = false; isoSt.prog = null
  if (r.ok) {
    const { copied, skipped } = r.result
    // una descarga ya copiada al USB se borra del PC; si la copia falló, se conserva
    if (cleanup && copied.length === paths.length) for (const p of paths) await poxi.dlCleanup(p)
    const tooBig = skipped.filter(s => s.reason === 'TOO_BIG').length
    const other = skipped.length - tooBig
    const extra = [other ? t('isos.skipped', { n: other }) : '', tooBig ? t('isos.tooBig', { n: tooBig }) : ''].filter(Boolean).join(' · ')
    if (copied.length) isoMessage(tooBig ? 'warn' : 'ok', [t('isos.copied', { n: copied.length }), extra].filter(Boolean).join(' · '))
    else isoMessage('warn', tooBig ? t('isos.tooBig', { n: tooBig }) : t('isos.nothing'))
  } else {
    isoMessage(r.code === 'CANCELLED' ? 'warn' : 'err', t(`err.${r.code}`) === `err.${r.code}` ? t('err.generic') : t(`err.${r.code}`))
  }
  isoSt.filesKey = ''
  await isoRefreshFiles()
  isoPaint?.()
}

async function isoDelete(rel: string) {
  if (!isoSt.letter) return
  isoSt.confirmDel = null
  const r = await poxi.deleteIso(isoSt.letter, rel).catch(() => ({ ok: false }))
  if (!r.ok) isoMessage('err', t('err.DELETE_FAILED'))
  isoSt.filesKey = ''
  await isoRefreshFiles()
  isoPaint?.()
}

function isoTargets() {
  return h('div', { class: 'chips', role: 'radiogroup', 'aria-label': t('isos.target') },
    ...isoSt.disks.map(d => {
      const l = d.letters[0]
      return h('button', {
        class: `chip${l === isoSt.letter ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': l === isoSt.letter,
        disabled: isoSt.busy,
        onclick: () => { isoSt.letter = l; isoSt.filesKey = ''; isoSt.msg = null; void isoRefreshFiles().then(() => isoPaint?.()) },
      }, svg(USB_ICON, 16), `${d.name} · ${volText(d)}`)
    }))
}

function isoDropZone(root: HTMLElement) {
  const zone = h('div', { class: 'drop', role: 'group', 'aria-label': t('isos.drop') },
    tile(UPLOAD_ICON),
    h('div', { class: 'drop-t' }, t('isos.drop')),
    h('div', { class: 'drop-s' }, t('isos.dropHint')),
    h('button', { class: 'btn', type: 'button', disabled: isoSt.busy, onclick: async () => { void isoCopy(await poxi.pickIsos()) } }, t('isos.pick')))
  // los listeners van en la sección completa para que soltar sobre la lista también funcione
  let depth = 0
  root.ondragenter = e => { e.preventDefault(); depth++; zone.classList.add('over') }
  root.ondragover = e => { e.preventDefault() }
  root.ondragleave = () => { if (--depth <= 0) { depth = 0; zone.classList.remove('over') } }
  root.ondrop = e => {
    e.preventDefault(); depth = 0; zone.classList.remove('over')
    void isoCopy(poxi.pathsFromFiles(Array.from(e.dataTransfer?.files ?? [])))
  }
  return zone
}

function isoProgressCard() {
  const fill = h('i'), name = h('div', { class: 'prog-n' }), meta = h('div', { class: 'prog-m' })
  const update = (p: CopyProgress) => {
    const pct = p.totalBytes ? Math.min(100, Math.round((p.doneBytes / p.totalBytes) * 100)) : 0
    fill.style.width = `${pct}%`
    name.textContent = t('isos.copying', { file: p.file })
    meta.textContent = `${t('isos.copyingOf', { i: p.fileIndex, n: p.fileCount })} · ${formatBytes(p.doneBytes)} / ${formatBytes(p.totalBytes)} · ${pct}%`
  }
  isoProgressUi = update
  if (isoSt.prog) update(isoSt.prog); else name.textContent = t('isos.preparing')
  return h('div', { class: 'card prog' }, name, h('div', { class: 'bar', role: 'progressbar', 'aria-label': t('isos.copying', { file: '' }) }, fill), meta,
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => poxi.cancelCopy() }, t('isos.cancel'))))
}

function isoRow(f: IsoFile) {
  const folder = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : ''
  const confirming = isoSt.confirmDel === f.rel
  const actions = confirming
    ? h('div', { class: 'row-actions' },
        h('button', { class: 'btn small danger-solid', type: 'button', onclick: () => void isoDelete(f.rel) }, t('isos.yesDelete')),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => { isoSt.confirmDel = null; isoPaint?.() } }, t('isos.keep')))
    : h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('isos.confirmDelete', { name: f.name }), title: t('isos.delete'), disabled: isoSt.busy,
        onclick: () => { isoSt.confirmDel = f.rel; isoPaint?.() } }, svg(TRASH_ICON, 18))
  return h('div', { class: `iso-row${confirming ? ' confirming' : ''}` },
    tile(DISC_ICON),
    h('div', { class: 'meta' },
      h('div', { class: 'name', title: f.name }, f.name),
      h('div', { class: 'detail' }, [folder, formatBytes(f.sizeBytes)].filter(Boolean).join(' · '))),
    actions)
}

const isoUi = { tab: 'usb' as 'usb' | 'download' }

function isoTabs() {
  const tab = (id: 'usb' | 'download', key: string) => h('button', {
    class: `tab${isoUi.tab === id ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': isoUi.tab === id,
    onclick: () => { isoUi.tab = id; isoPaint?.() },
  }, t(key))
  return h('div', { class: 'tabs', role: 'tablist' }, tab('usb', 'isos.tabUsb'), tab('download', 'isos.tabDl'))
}

function paintUsbTab(dyn: HTMLElement, root: HTMLElement) {
  if (!isoSt.disks.length) {
    dyn.append(h('div', { class: 'card empty' }, tile(USB_ICON, 'pulse'), h('b', {}, t('isos.noUsb')), h('div', {}, t('isos.noUsbText'))))
    return
  }
  if (isoSt.disks.length > 1) dyn.append(isoTargets())
  const m = isoSt.msg
  const msg = m && h('div', { class: `msg ${m.kind}${m.action ? ' lead' : ''}`, role: m.kind === 'err' ? 'alert' : 'status' },
    h('span', {}, m.text), m.action ? h('button', { class: 'btn small', type: 'button', onclick: m.action.run }, m.action.label) : null)
  // el aviso con acción (USB recién instalado) va arriba, antes de la zona de soltar
  if (msg && m.action) dyn.append(msg)
  dyn.append(isoDropZone(root))
  if (msg && !m.action) dyn.append(msg)
  if (isoSt.busy) dyn.append(isoProgressCard())
  const usb = isoSt.disks.find(d => d.letters[0] === isoSt.letter)
  dyn.append(h('div', { class: 'list-h' }, h('b', {}, `${t('isos.list')} (${isoSt.files.length})`),
    h('span', { class: 'list-h-r' },
      h('button', { class: 'link-btn', type: 'button', onclick: () => void openBootPreview(isoSt.letter, usb ? `${usb.name} (${isoSt.letter}:)` : null) }, t('boot.pvLink')),
      t('isos.free', { size: formatBytes(isoSt.free) }))))
  dyn.append(isoSt.files.length
    ? h('div', { class: 'card list' }, ...isoSt.files.map(isoRow))
    : h('div', { class: 'card empty small' }, t('isos.empty')))
}

function renderIsos() {
  const tabsBox = h('div'), dyn = h('div')
  const root = h('section', { class: 'screen' }, h('h1', {}, t('isos.title')), h('p', { class: 'sub' }, t('isos.sub')), tabsBox, dyn)

  isoPaint = () => {
    isoProgressUi = null; dlProgressUi = null
    root.ondragenter = root.ondragover = root.ondragleave = root.ondrop = null
    tabsBox.replaceChildren(isoTabs())
    dyn.replaceChildren()
    if (isoUi.tab === 'usb') paintUsbTab(dyn, root); else paintDownloadTab(dyn)
  }
  isoPaint()
  void isoRefresh()
  const id = window.setInterval(() => { if (!isoSt.busy && !dl.busy) void isoRefresh() }, 3000)
  show(root, () => { clearInterval(id); isoPaint = null; isoProgressUi = null; dlProgressUi = null; root.ondragenter = root.ondragover = root.ondragleave = root.ondrop = null })
}
