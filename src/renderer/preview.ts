/**
 * Vista previa del menú de arranque: se dibuja en un lienzo de 1920×1080 con las mismas imágenes del tema que van al USB
 * (boot-theme/poxi) y las medidas de theme.txt, comprobadas contra una captura del menú real en QEMU.
 */
const PV = {
  W: 1920, H: 1080,
  menu: { x: 422.4, y: 313.2, w: 1075.2, h: 604.8 }, // boot_menu: left 22%, top 29%, 56% × 56%
  pitch: 62, box: 48, visible: 8, // item_height 28 + item_spacing 34; caja de selección = 28 + bordes de 10
}
const pvImgs = new Map<string, HTMLImageElement>()
const pvLoad = (src: string) => {
  const cached = pvImgs.get(src)
  if (cached) return Promise.resolve(cached)
  return new Promise<HTMLImageElement | null>(res => {
    const im = new Image()
    im.onload = () => { pvImgs.set(src, im); res(im) }
    im.onerror = () => res(null)
    im.src = src
  })
}
const PIECES = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']

/** Caja de 9 piezas como el "styled box" de GRUB: esquinas a su tamaño y lados estirados. */
function pv9(ctx: CanvasRenderingContext2D, prefix: string, x: number, y: number, w: number, h: number) {
  const p = (k: string) => pvImgs.get(`boot/${prefix}_${k}.png`)
  const nw = p('nw'), se = p('se')
  if (!nw || !se) return
  const l = nw.width, t = nw.height, r = se.width, b = se.height
  const draw = (k: string, dx: number, dy: number, dw: number, dh: number) => { const im = p(k); if (im && dw > 0 && dh > 0) ctx.drawImage(im, dx, dy, dw, dh) }
  draw('c', x + l, y + t, w - l - r, h - t - b)
  draw('n', x + l, y, w - l - r, t); draw('s', x + l, y + h - b, w - l - r, b)
  draw('w', x, y + t, l, h - t - b); draw('e', x + w - r, y + t, r, h - t - b)
  draw('nw', x, y, l, t); draw('ne', x + w - r, y, r, t); draw('sw', x, y + h - b, l, b); draw('se', x + w - r, y + h - b, r, b)
}

const pvFit = (ctx: CanvasRenderingContext2D, s: string, max: number) => {
  if (ctx.measureText(s).width <= max) return s
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}

function pvDraw(ctx: CanvasRenderingContext2D, items: { name: string; cls: string }[], sel: number, top: number) {
  const { menu: m, pitch, box, visible } = PV
  ctx.clearRect(0, 0, PV.W, PV.H)
  const bg = pvImgs.get('boot/bg.png')
  if (bg) ctx.drawImage(bg, 0, 0, PV.W, PV.H)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = '400 22px Inter'; ctx.fillStyle = '#8b9ab0'
  ctx.fillText(t('boot.pvMenuTitle'), PV.W / 2, PV.H * 0.21 + 20)
  ctx.font = '400 16px Inter'; ctx.fillStyle = '#6b7a90'
  ctx.fillText(t('boot.pvHotkeys'), PV.W / 2, PV.H * 0.93 + 14)

  pv9(ctx, 'menu', m.x, m.y, m.w, m.h)
  const sbX = m.x + m.w - 24, sbY = m.y + 22, sbH = m.h - 45
  const boxX = m.x + 38, boxW = sbX - 17 - boxX
  ctx.textAlign = 'left'
  items.slice(top, top + visible).forEach((it, k) => {
    const i = top + k, y = m.y + 38 + k * pitch, on = i === sel
    pv9(ctx, on ? 'select' : 'item', boxX, y, boxW, box)
    const icon = pvImgs.get(`boot/icons/${it.cls}.png`)
    if (icon) ctx.drawImage(icon, boxX + 10, y + 8, 32, 32)
    ctx.font = `${on ? 600 : 400} 22px Inter`; ctx.fillStyle = on ? '#031a24' : '#c3cfdf'
    ctx.fillText(pvFit(ctx, it.name, boxW - 76), boxX + 56, y + box / 2 + 1)
  })
  // barra de desplazamiento (scrollbar = true): marco y pulgar proporcional
  pv9(ctx, 'scroll_frame', sbX, sbY, 12, sbH)
  const n = Math.max(items.length, 1), th = items.length > visible ? Math.max(24, sbH * visible / n) : sbH
  const ty = items.length > visible ? sbY + (sbH - th) * top / (n - visible) : sbY
  pv9(ctx, 'scroll_thumb', sbX, ty, 12, th)
}

let pvOpen = false
/** Abre la vista previa a pantalla completa para ese USB (o un ejemplo si no hay o está vacío). */
async function openBootPreview(letter: string | null, usbName: string | null) {
  if (pvOpen) return
  pvOpen = true
  const opener = document.activeElement as HTMLElement | null
  const data = await poxi.bootPreview(letter).catch(() => ({ sample: true, items: [] as { name: string; cls: string }[] }))
  const files = ['bg', ...['menu', 'item', 'select', 'scroll_frame', 'scroll_thumb'].flatMap(p => PIECES.map(k => `${p}_${k}`))].map(f => `boot/${f}.png`)
  await Promise.all([...files, ...new Set(data.items.map(i => `boot/icons/${i.cls}.png`))].map(pvLoad))
  await document.fonts.load('600 22px Inter').catch(() => {})

  const canvas = h('canvas', { width: String(PV.W), height: String(PV.H), class: 'pv-canvas', role: 'img', 'aria-label': t('boot.pvTitle') })
  const ctx = canvas.getContext('2d')!
  const toast = h('div', { class: 'pv-toast', role: 'status' })
  let sel = 0, top = 0, toastId: number | undefined
  const paint = () => {
    if (sel < top) top = sel
    if (sel >= top + PV.visible) top = sel - PV.visible + 1
    pvDraw(ctx, data.items, sel, top)
  }
  const move = (d: number) => { if (data.items.length) { sel = Math.max(0, Math.min(data.items.length - 1, sel + d)); paint() } }
  const pvBoot = () => {
    const it = data.items[sel]; if (!it) return
    toast.textContent = t('boot.pvEnter', { name: it.name }); toast.classList.add('on')
    clearTimeout(toastId); toastId = window.setTimeout(() => toast.classList.remove('on'), 2600)
  }
  const sub = data.sample ? t('boot.pvSample') : t('boot.pvUsb', { usb: usbName ?? '' })
  const close = () => {
    document.removeEventListener('keydown', onKey, true)
    overlay.classList.add('out')
    setTimeout(() => { overlay.remove(); pvOpen = false; shell.inert = false; opener?.focus() }, 160)
  }
  const onKey = (e: KeyboardEvent) => {
    const k = e.key
    if (k === 'Escape') close()
    else if (k === 'ArrowDown') move(1)
    else if (k === 'ArrowUp') move(-1)
    else if (k === 'PageDown') move(PV.visible)
    else if (k === 'PageUp') move(-PV.visible)
    else if (k === 'Home') move(-1e6)
    else if (k === 'End') move(1e6)
    else if (k === 'Enter') pvBoot()
    else return
    e.preventDefault(); e.stopPropagation()
  }
  // clic sobre una fila: la selecciona (y doble clic, como Enter)
  const rowAt = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * PV.W / r.width, y = (e.clientY - r.top) * PV.H / r.height
    const { menu: m } = PV, k = Math.floor((y - m.y - 38) / PV.pitch)
    const inRow = x > m.x + 38 && x < m.x + m.w - 41 && k >= 0 && k < PV.visible && (y - m.y - 38) - k * PV.pitch <= PV.box
    return inRow && top + k < data.items.length ? top + k : -1
  }
  canvas.addEventListener('click', e => { const i = rowAt(e); if (i >= 0) { sel = i; paint() } })
  canvas.addEventListener('dblclick', e => { if (rowAt(e) >= 0) pvBoot() })
  canvas.addEventListener('wheel', e => { e.preventDefault(); move(e.deltaY > 0 ? 1 : -1) }, { passive: false })

  const overlay = h('div', { class: 'pv', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('boot.pvTitle'), tabindex: '-1',
    onclick: (e: Event) => { if (e.target === overlay) close() } },
    h('div', { class: 'pv-panel' },
      h('div', { class: 'pv-head' },
        h('div', {}, h('b', {}, t('boot.pvTitle')), h('small', {}, sub)),
        h('button', { class: 'icon-btn pv-x', type: 'button', 'aria-label': t('win.close'), onclick: close }, svg('<path d="M6 6l12 12M18 6L6 18"/>', 18))),
      h('div', { class: 'pv-frame' }, canvas, toast),
      h('div', { class: 'pv-hint' }, t('boot.pvHint'))))
  const shell = document.querySelector<HTMLElement>('.shell')!
  shell.inert = true // el foco no se escapa detrás del diálogo
  document.body.append(overlay)
  document.addEventListener('keydown', onKey, true)
  paint()
  overlay.focus()
}
