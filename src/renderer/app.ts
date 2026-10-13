type Step = 'usb' | 'confirm' | 'progress' | 'error'
const st = {
  step: 'usb' as Step, disks: [] as UsbDisk[], sel: null as number | null, errCode: 'generic',
  advOpen: false, gpt: true, secureBoot: true, fs: 'exFAT' as Opts['fs'], reserveMB: 0, mode: 'install' as Opts['mode'],
}
let pollId: number | undefined
let setPct: (p: number) => void = () => {}

const selected = () => st.disks.find(d => d.number === st.sel)

function steps(active: number) {
  const row = h('div', { class: 'steps' })
  ;(['step.usb', 'step.confirm', 'step.done'] as const).forEach((k, i) => {
    if (i) row.append(h('span', { class: 'bar-s' }))
    const cls = i === active ? 'on' : i < active ? 'past' : ''
    row.append(h('div', { class: `step ${cls}` }, h('i', {}, String(i + 1)), t(k)))
  })
  return row
}

function renderUsb() {
  const list = h('div', { class: 'stagger' })
  let painted = false
  const paint = () => {
    if (painted) list.classList.remove('stagger') // la animación de entrada solo la primera vez: al refrescar no parpadea
    painted = true
    list.replaceChildren()
    if (!st.disks.length) {
      list.append(h('div', { class: 'card empty' }, tile(USB_ICON, 'pulse'), h('div', {}, t('usb.empty'))))
    }
    for (const d of st.disks) {
      const letters = d.letters.length ? volText(d) : t('usb.noletter')
      list.append(h('button', {
        class: `card usb${d.number === st.sel ? ' sel' : ''}`, type: 'button', 'aria-pressed': d.number === st.sel,
        onclick: () => { st.sel = d.number; paint(); next.toggleAttribute('disabled', false) },
      },
        tile(USB_ICON),
        h('div', { class: 'meta' },
          h('div', { class: 'name' }, d.name),
          h('div', { class: 'detail' }, `${formatBytes(d.sizeBytes)} · ${letters}`)),
        d.hasVentoy ? h('span', { class: 'badge' }, t('usb.installed')) : null,
        h('span', { class: 'tick' }, svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 13))))
    }
  }
  const next = h('button', { class: 'btn', type: 'button', disabled: !selected(), onclick: () => {
    const d = selected(); if (!d) return
    st.mode = d.hasVentoy ? 'update' : 'install'; go('confirm')
  } }, t('btn.next'))
  paint()
  show(h('section', { class: 'screen' },
    steps(0), h('h1', {}, t('usb.title')), h('p', { class: 'sub' }, t('usb.subtitle')),
    list, h('div', { class: 'actions' }, next)))

  // refresco automático; conserva la selección si el disco sigue ahí
  let firstLoad = true, pendingGone = ''
  const refresh = async () => {
    try {
      const fresh = await poxi.listUsb()
      if (JSON.stringify(fresh) === JSON.stringify(st.disks) && !firstLoad) { pendingGone = ''; return }
      // un USB que "desaparece" se confirma en la siguiente consulta: a veces Windows lo pierde un instante y la lista parpadeaba
      const gone = st.disks.filter(d => !fresh.some(f => f.number === d.number)).map(d => d.number).join(',')
      if (gone && !firstLoad && gone !== pendingGone) { pendingGone = gone; return }
      pendingGone = ''
      firstLoad = false
      st.disks = fresh
      if (st.sel != null && !selected()) st.sel = null
      if (st.step === 'usb') { paint(); next.toggleAttribute('disabled', !selected()) }
    } catch { /* se reintenta en el siguiente ciclo */ }
  }
  refresh()
  pollId = window.setInterval(refresh, 2500)
}

function renderConfirm() {
  const d = selected(); if (!d) return go('usb')
  const update = st.mode === 'update'
  const vars = { name: d.name, size: formatBytes(d.sizeBytes) }

  const grid = h('div', { class: 'grid' })
  // div y no label: un label reenvía el clic de las opciones al botón y el desplegable se volvería a abrir
  const field = (title: string, control: HTMLElement) => h('div', { class: 'field' }, h('span', {}, title), control)
  if (!update) {
    const part = dropdown(t('adv.partition'), [
      { value: 'GPT', label: 'GPT', hint: t('adv.gptHint') }, { value: 'MBR', label: 'MBR', hint: t('adv.mbrHint') },
    ], st.gpt ? 'GPT' : 'MBR', v => { st.gpt = v === 'GPT' })
    const fs = dropdown<Opts['fs']>(t('adv.fs'), [
      { value: 'exFAT', label: 'exFAT', hint: t('adv.exfatHint') }, { value: 'NTFS', label: 'NTFS', hint: t('adv.ntfsHint') },
      { value: 'FAT32', label: 'FAT32', hint: t('adv.fat32Hint') },
    ], st.fs, v => { st.fs = v })
    const res = h('input', { type: 'number', min: '0', step: '1024', value: String(st.reserveMB), 'aria-label': t('adv.reserve'), oninput: (e: Event) => {
      st.reserveMB = Math.max(0, Number((e.target as HTMLInputElement).value) || 0) } })
    grid.append(field(t('adv.partition'), part), field(t('adv.fs'), fs), field(t('adv.reserve'), res))
  }
  grid.append(h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: st.secureBoot, onchange: (e: Event) => { st.secureBoot = (e.target as HTMLInputElement).checked } }),
    t('adv.secureboot')))
  const adv = disclosure(SLIDERS_ICON, t('adv.title'), t('adv.hint'), st.advOpen, o => { st.advOpen = o }, grid)
  adv.classList.add('adv')

  const run = () => { go('progress'); void doInstall(d) }
  let actionBtn: HTMLElement
  if (update) {
    actionBtn = h('button', { class: 'btn', type: 'button', onclick: run }, t('btn.update'))
  } else {
    // mantener pulsado 1 s (también con Espacio/Enter); soltar cancela con vuelta rápida
    let timer: number | undefined
    const btn = h('button', { class: 'btn danger', type: 'button' },
      h('div', { class: 'fill' }), h('span', {}, t('confirm.hold')))
    const start = () => { if (timer) return; btn.classList.add('holding'); timer = window.setTimeout(run, 1000) }
    const stop = () => { clearTimeout(timer); timer = undefined; btn.classList.remove('holding') }
    btn.addEventListener('pointerdown', start)
    btn.addEventListener('pointerup', stop)
    btn.addEventListener('pointerleave', stop)
    btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start() } })
    btn.addEventListener('keyup', stop)
    btn.addEventListener('blur', stop)
    actionBtn = btn
  }

  show(h('section', { class: 'screen' },
    steps(1), h('h1', {}, t('confirm.title')),
    h('div', { class: `card warn${update ? ' safe' : ''}`, role: 'alert' },
      tile(update ? SHIELD_ICON : WARN_ICON, update ? '' : 'red'), h('div', {}, t(update ? 'confirm.warnUpdate' : 'confirm.warn', vars))),
    adv,
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => go('usb') }, t('btn.back')), actionBtn)))
}

async function doInstall(d: UsbDisk) {
  const res = await poxi.install({
    mode: st.mode, phyDrive: d.number, gpt: st.gpt, secureBoot: st.secureBoot, fs: st.fs, reserveMB: st.reserveMB, lang,
  })
  if (!res.ok) { st.errCode = res.code; go('error'); return }
  // instalado: directo a meter ISOs en ese USB, con un aviso que lleva a las descargas
  st.step = 'usb'; st.sel = null
  if (res.letter) { isoSt.letter = res.letter; isoSt.filesKey = '' }
  isoUi.tab = 'usb'
  isoSt.msg = {
    kind: res.theme ? 'ok' : 'warn', text: [t('done.next'), res.theme ? '' : t('done.noTheme')].filter(Boolean).join(' '),
    action: { label: t('done.toDl'), run: () => { isoUi.tab = 'download'; isoSt.msg = null; isoPaint?.() } },
  }
  setSection('isos')
}

function renderProgress() {
  const C = 2 * Math.PI * 80
  const pct = h('div', { class: 'pct' }, '0%')
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  ring.setAttribute('viewBox', '0 0 190 190')
  ring.innerHTML = `<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
    <circle class="ring-bg" cx="95" cy="95" r="80"/><circle class="ring-fg" cx="95" cy="95" r="80"/>`
  const fg = ring.querySelector('.ring-fg') as SVGCircleElement
  setPct = p => { pct.textContent = `${p}%`; fg.style.strokeDashoffset = String(C * (1 - p / 100)) }
  show(h('section', { class: 'screen center' },
    steps(1), h('h1', {}, t(st.mode === 'update' ? 'progress.updating' : 'progress.title')),
    h('p', { class: 'sub' }, t('progress.hint')),
    h('div', { class: 'ringwrap', role: 'progressbar', 'aria-label': t('progress.title') }, ring, pct)))
}

function renderError() {
  const key = `err.${st.errCode}`
  const msg = t(key) === key ? t('err.generic') : t(key)
  show(h('section', { class: 'screen center' },
    h('h1', {}, t('err.title')), h('div', { class: 'card warn', role: 'alert' }, msg),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => go('usb') }, t('btn.back')))))
}

function go(step: Step) {
  clearInterval(pollId); pollId = undefined
  st.step = step
  ;({ usb: renderUsb, confirm: renderConfirm, progress: renderProgress, error: renderError })[step]()
}

type Section = 'install' | 'isos' | 'boot' | 'settings'
let section: Section = 'install'

function setSection(next: Section) {
  if (next === section) return
  if (section === 'install' && st.step === 'progress') return // no se sale mientras se instala
  section = next
  document.querySelectorAll<HTMLElement>('.nav[data-section]').forEach(n => {
    const on = n.dataset.section === next
    n.classList.toggle('active', on)
    if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current')
  })
  clearInterval(pollId); pollId = undefined
  renderSection()
}

function renderSection() {
  if (section === 'isos') renderIsos()
  else if (section === 'boot') renderBoot()
  else if (section === 'settings') void renderSettings()
  else go(st.step === 'progress' ? 'usb' : st.step)
}

/** Textos fijos del HTML; se repite al cambiar de idioma. */
function paintStatic() {
  document.documentElement.lang = lang
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!) })
  document.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nLabel!)))
}

async function boot() {
  dict = await poxi.dict()
  paintStatic()
  applyLang = () => { paintStatic(); renderSection() }
  document.getElementById('min')!.addEventListener('click', () => poxi.win('min'))
  document.getElementById('max')!.addEventListener('click', () => poxi.win('max'))
  document.getElementById('close')!.addEventListener('click', () => poxi.win('close'))
  document.querySelectorAll<HTMLElement>('.nav[data-section]').forEach(n =>
    n.addEventListener('click', () => setSection(n.dataset.section as Section)))
  // soltar un fichero fuera de la zona no debe navegar la ventana hacia él
  for (const ev of ['dragover', 'drop']) document.addEventListener(ev, e => e.preventDefault())
  poxi.onProgress(p => setPct(p))
  poxi.onIsoProgress(p => { isoSt.prog = p; isoProgressUi?.(p) })
  poxi.onDlProgress(p => { dl.prog = p; dlProgressUi?.(p) })
  poxi.onPlugsonClosed(() => { bootSt.running = null; bootPaint?.() })
  go('usb')
}
void boot()
