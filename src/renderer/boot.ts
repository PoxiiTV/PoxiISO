/** Pantalla "Menú de arranque": abre el configurador avanzado (Plugson) para un USB sin enseñar la ventana de Ventoy. */
const bootSt = {
  disks: [] as UsbDisk[], letter: null as string | null, running: null as string | null,
  busy: false, msg: null as { kind: 'ok' | 'warn' | 'err'; text: string } | null, key: '',
}
let bootPaint: (() => void) | null = null

async function bootRefresh() {
  bootSt.disks = (await poxi.listUsb().catch(() => [] as UsbDisk[])).filter(withLetter)
  if (!bootSt.disks.some(d => d.letters[0] === bootSt.letter)) bootSt.letter = bootSt.disks[0]?.letters[0] ?? null
  bootSt.running = await poxi.plugsonStatus().catch(() => null)
  const key = JSON.stringify([bootSt.disks, bootSt.letter, bootSt.running])
  if (key !== bootSt.key) { bootSt.key = key; bootPaint?.() }
}

async function bootOpen() {
  if (!bootSt.letter || bootSt.busy) return
  bootSt.busy = true; bootSt.msg = null; bootPaint?.()
  const r = await poxi.plugsonStart(bootSt.letter, lang).catch(() => ({ ok: false, code: 'NO_DIALOG' }))
  bootSt.busy = false
  if (r.ok) bootSt.running = bootSt.letter
  else bootSt.msg = { kind: 'err', text: errText(r.code ?? 'generic') }
  bootPaint?.()
}

const usbLabel = (letter: string | null) => {
  const d = bootSt.disks.find(x => x.letters[0] === letter)
  return d ? `${d.name} (${letter}:)` : `${letter}:`
}

/** Tarjeta para abrir la vista previa del menú con las ISOs del USB elegido. */
function previewCard(letter: string | null) {
  const d = bootSt.disks.find(x => x.letters[0] === letter)
  return h('div', { class: 'card pv-card' },
    tile(DISC_ICON, 'soft'),
    h('div', { class: 'meta' }, h('b', {}, t('boot.pvTitle')), h('div', { class: 'detail' }, t('boot.pvCard'))),
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => void openBootPreview(letter, d ? `${d.name} (${letter}:)` : null) }, t('boot.pvOpen')))
}

function paintBoot(dyn: HTMLElement) {
  dyn.replaceChildren()
  if (bootSt.running) {
    dyn.append(h('div', { class: 'card warn safe', role: 'status' },
      tile(CHECK_ICON),
      h('div', { class: 'meta' }, h('b', {}, t('boot.running', { usb: usbLabel(bootSt.running) })), h('div', { class: 'detail' }, t('boot.runningText')))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => poxi.plugsonReopen() }, t('boot.reopen')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { poxi.plugsonStop(); bootSt.running = null; bootPaint?.() } }, t('boot.stop'))),
      previewCard(bootSt.running))
    return
  }
  if (!bootSt.disks.length) {
    dyn.append(h('div', { class: 'card empty' }, tile(USB_ICON, 'pulse'), h('b', {}, t('isos.noUsb')), h('div', {}, t('isos.noUsbText'))), previewCard(null))
    return
  }
  const list = h('div', {}, ...bootSt.disks.map(d => {
    const l = d.letters[0], on = l === bootSt.letter
    return h('button', {
      class: `card usb${on ? ' sel' : ''}`, type: 'button', 'aria-pressed': on, disabled: bootSt.busy,
      onclick: () => { bootSt.letter = l; bootPaint?.() },
    }, tile(USB_ICON), h('div', { class: 'meta' }, h('div', { class: 'name' }, d.name), h('div', { class: 'detail' }, `${formatBytes(d.sizeBytes)} · ${volText(d)}`)),
      h('span', { class: 'tick' }, svg(CHECK_ICON, 13)))
  }))
  dyn.append(h('div', { class: 'list-h' }, h('b', {}, t('boot.pick'))), list)
  if (bootSt.msg) dyn.append(h('div', { class: `msg ${bootSt.msg.kind}`, role: 'alert' }, bootSt.msg.text))
  dyn.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'button', disabled: bootSt.busy || !bootSt.letter, onclick: () => void bootOpen() }, t(bootSt.busy ? 'boot.opening' : 'boot.open'))),
    previewCard(bootSt.letter))
}

function renderBoot() {
  const dyn = h('div')
  const root = h('section', { class: 'screen' }, h('h1', {}, t('boot.title')), h('p', { class: 'sub' }, t('boot.sub')), dyn)
  bootPaint = () => paintBoot(dyn)
  bootPaint()
  void bootRefresh()
  const id = window.setInterval(() => { if (!bootSt.busy) void bootRefresh() }, 3000)
  show(root, () => { clearInterval(id); bootPaint = null })
}
