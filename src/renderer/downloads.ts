/** Pestaña "Descargar" de la pantalla ISOs: Windows y las destacadas arriba, enlace propio y el resto con buscador. */
const dl = {
  items: [] as CatEntry[], dir: '', loaded: false, busy: false, name: '', url: '',
  query: '', cat: 'all' as string, searchFocus: false,
  prog: null as DlProgress | null,
  msg: null as { kind: 'ok' | 'warn' | 'err'; text: string; folder?: boolean } | null,
}
let dlProgressUi: ((p: DlProgress) => void) | null = null

async function dlLoad() {
  const c = await poxi.dlCatalog().catch(() => null)
  if (c) { dl.items = c.items; dl.dir = c.dir } else dl.msg = { kind: 'err', text: t('err.generic') }
  dl.loaded = true // también si falla: si no, cada repintado lo volvería a pedir sin parar
  isoPaint?.()
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

async function dlRun(arg: { id: string } | { url: string }, name: string) {
  if (dl.busy) return
  dl.busy = true; dl.name = name; dl.prog = null; dl.msg = null; isoPaint?.()
  const r = await poxi.dlStart(arg).catch(() => ({ ok: false as const, code: 'DL_FAILED' }))
  dl.busy = false; dl.prog = null
  if (!r.ok) {
    dl.msg = { kind: r.code === 'CANCELLED' ? 'warn' : 'err', text: errText(r.code) + (r.code === 'NETWORK' || r.code === 'CANCELLED' ? ` ${t('dl.resume')}` : '') }
    isoPaint?.(); return
  }
  const file = baseName(r.path)
  if (isoSt.letter) {
    // hay USB con PoxiISO: se copia y, si sale bien, se borra la copia temporal del PC
    isoUi.tab = 'usb'; isoSt.msg = null; isoPaint?.()
    await isoCopy([r.path], true)
    const m = isoMsgNow()
    if (m && m.kind !== 'ok') { m.text += ` · ${t('dl.kept', { file })}`; isoPaint?.() }
  } else {
    dl.msg = { kind: 'ok', text: `${t(r.verified ? 'dl.done' : 'dl.doneNoVerify', { name: file })} ${t('dl.savedIn', { dir: dl.dir })}`, folder: true }
    isoPaint?.()
  }
}

const fmtSpeed = (bps: number) => `${(bps / 2 ** 20).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB/s`
function fmtEta(sec: number) {
  if (!isFinite(sec) || sec <= 0) return '—'
  const m = Math.floor(sec / 60), s = Math.round(sec % 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m ? `${m} min ${s} s` : `${s} s`
}

function dlProgressCard() {
  const fill = h('i'), name = h('div', { class: 'prog-n' }, t('dl.downloading', { name: dl.name })), meta = h('div', { class: 'prog-m' }, t('isos.preparing'))
  const update = (p: DlProgress) => {
    const pct = p.totalBytes ? Math.min(100, Math.round((p.doneBytes / p.totalBytes) * 100)) : 0
    fill.style.width = `${pct}%`
    meta.textContent = p.phase === 'verifying'
      ? `${t('dl.verifying')} ${pct}%`
      : [p.totalBytes ? `${formatBytes(p.doneBytes)} / ${formatBytes(p.totalBytes)} · ${pct}%` : formatBytes(p.doneBytes),
         p.speedBps ? fmtSpeed(p.speedBps) : '', p.speedBps && p.totalBytes ? t('dl.eta', { eta: fmtEta((p.totalBytes - p.doneBytes) / p.speedBps) }) : ''].filter(Boolean).join(' · ')
  }
  dlProgressUi = update
  if (dl.prog) update(dl.prog)
  return h('div', { class: 'card prog' }, name, h('div', { class: 'bar', role: 'progressbar', 'aria-label': t('dl.downloading', { name: dl.name }) }, fill), meta,
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => poxi.dlCancel() }, t('isos.cancel'))))
}

function dlItem(e: CatEntry) {
  const locked = dl.busy || isoSt.busy
  const txt = lang === 'en' && e.en ? e.en : e
  const action = e.kind === 'page'
    ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => void poxi.dlOpenPage(e.id) }, t('dl.page'))
    : h('button', { class: 'btn small', type: 'button', disabled: locked, onclick: () => void dlRun({ id: e.id }, txt.name) }, t('dl.get'))
  const detail = [txt.desc, e.sizeBytes ? formatBytes(e.sizeBytes) : ''].filter(Boolean).join(' · ')
  return h('div', { class: 'card dl-item' },
    tile(DISC_ICON),
    h('div', { class: 'meta' },
      h('div', { class: 'name' }, txt.name, e.recommended ? h('span', { class: 'badge' }, t('dl.rec')) : null),
      h('div', { class: 'detail' }, detail)),
    action)
}

function dlPaste() {
  const input = h('input', { class: 'url', type: 'text', placeholder: t('dl.pasteHint'), 'aria-label': t('dl.paste'), spellcheck: 'false', value: dl.url })
  const go = h('button', { class: 'btn small', type: 'button', disabled: !dl.url.trim() || dl.busy || isoSt.busy }, t('dl.get'))
  const run = () => { if (dl.url.trim()) void dlRun({ url: dl.url.trim() }, dl.url.trim().split('?')[0].split('/').pop() || t('dl.paste')) }
  input.addEventListener('input', () => { dl.url = input.value; go.toggleAttribute('disabled', !input.value.trim() || dl.busy || isoSt.busy) })
  input.addEventListener('keydown', e => { if (e.key === 'Enter') run() })
  go.addEventListener('click', run)
  return h('div', { class: 'card' }, h('div', { class: 'list-t' }, t('dl.paste')), h('div', { class: 'paste' }, input, go))
}

function paintDownloadTab(dyn: HTMLElement) {
  if (!dl.loaded) {
    void dlLoad()
    dyn.append(h('div', { class: 'card empty small' }, t('dl.loading')))
    return
  }
  const usb = isoSt.disks.find(d => d.letters[0] === isoSt.letter)
  dyn.append(h('p', { class: 'dl-dest' }, usb ? t('dl.toUsb', { usb: `${usb.name} (${isoSt.letter}:)` }) : t('dl.toPc', { dir: dl.dir })))
  if (dl.msg) dyn.append(h('div', { class: `msg ${dl.msg.kind}`, role: dl.msg.kind === 'err' ? 'alert' : 'status' },
    dl.msg.text, dl.msg.folder ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => poxi.dlOpenFolder() }, t('dl.openFolder')) : null))
  if (dl.busy) dyn.append(dlProgressCard())
  const win = dl.items.filter(i => i.group === 'windows')
  const top = dl.items.filter(i => i.featured && i.group !== 'windows')
  dyn.append(h('div', { class: 'list-h' }, h('b', {}, t('dl.windows'))))
  dyn.append(h('div', { class: 'dl-list' }, ...win.map(dlItem)))
  if (top.length) {
    dyn.append(h('div', { class: 'list-h' }, h('b', {}, t('dl.popular'))))
    dyn.append(h('div', { class: 'dl-list' }, ...top.map(dlItem)))
  }
  dyn.append(h('div', { class: 'list-h' }, h('b', {}, t('dl.custom'))))
  dyn.append(dlPaste())
  dyn.append(dlCatalogSearch(dl.items.filter(i => i.group !== 'windows' && !i.featured)))
}

const DL_GROUPS = ['linux', 'gaming', 'tools', 'server', 'other'] as const
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** "Más sistemas": buscador + categorías. Al escribir solo se repinta la lista, así el campo no pierde el foco. */
function dlCatalogSearch(rest: CatEntry[]) {
  const results = h('div')
  const count = (g: string) => rest.filter(i => g === 'all' || i.group === g).length
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': t('dl.more') })
  const paintChips = () => chips.replaceChildren(...(['all', ...DL_GROUPS] as const).filter(g => count(g)).map(g => h('button', {
    class: `chip${dl.cat === g ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': dl.cat === g,
    onclick: () => { dl.cat = g; paintChips(); paintResults() },
  }, t(`dl.g.${g}`), h('span', { class: 'chip-n' }, String(count(g))))))
  const paintResults = () => {
    const q = fold(dl.query.trim())
    const hits = rest.filter(i => (dl.cat === 'all' || i.group === dl.cat)
      && (!q || fold([i.name, i.desc, i.en?.name ?? '', i.en?.desc ?? '', t(`dl.g.${i.group}`)].join(' ')).includes(q)))
    results.replaceChildren()
    if (!hits.length) { results.append(h('div', { class: 'card empty small' }, t('dl.noResults', { q: dl.query.trim() }))); return }
    for (const g of DL_GROUPS) {
      const inG = hits.filter(i => i.group === g)
      if (!inG.length) continue
      if (dl.cat === 'all') results.append(h('div', { class: 'dl-g' }, t(`dl.g.${g}`)))
      results.append(h('div', { class: 'dl-list' }, ...inG.map(dlItem)))
    }
  }
  const input = h('input', { class: 'url search', type: 'search', placeholder: t('dl.search'), 'aria-label': t('dl.search'), spellcheck: 'false', value: dl.query })
  input.addEventListener('input', () => { dl.query = input.value; paintResults() })
  input.addEventListener('focus', () => { dl.searchFocus = true })
  input.addEventListener('blur', () => { dl.searchFocus = false })
  paintChips(); paintResults()
  // si se repinta la pestaña mientras se escribe (progreso de una descarga…), se recupera el foco
  if (dl.searchFocus) requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length) })
  return h('div', { class: 'dl-more' },
    h('div', { class: 'list-h' }, h('b', {}, t('dl.more')), h('span', {}, t('dl.moreHint', { n: rest.length }))),
    h('div', { class: 'search-box' }, svg(SEARCH_ICON, 18), input), chips, results)
}
