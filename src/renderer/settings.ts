/** Pantalla Ajustes: idioma, descargas a medias y "acerca de". */
let applyLang: (() => void) | null = null

function setLang(next: Lang) {
  if (next === lang) return
  lang = next
  try { localStorage.setItem('lang', next) } catch { /* sin almacenamiento: solo dura esta sesión */ }
  applyLang?.()
}

async function renderSettings() {
  const info = await poxi.appInfo().catch(() => null)
  const msg = h('div', { role: 'status' })

  const choice = (v: Lang, label: string) => h('button', {
    class: `tab${lang === v ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': lang === v, onclick: () => setLang(v),
  }, label)

  const parts = info?.parts ?? { count: 0, bytes: 0 }
  const clear = h('button', { class: 'btn ghost small', type: 'button', disabled: !parts.count, onclick: async () => {
    clear.toggleAttribute('disabled', true)
    const r = await poxi.dlClearParts().catch(() => ({ ok: false, code: 'DELETE_FAILED' }))
    if (r.ok) { partsText.textContent = t('set.partsNone'); msg.replaceChildren(h('div', { class: 'msg ok' }, t('set.partsCleared'))) }
    else { clear.toggleAttribute('disabled', false); msg.replaceChildren(h('div', { class: 'msg err' }, errText(r.code ?? 'generic'))) }
  } }, t('set.partsClear'))
  const partsText = h('div', { class: 'detail' },
    parts.count ? t('set.parts', { n: parts.count, size: formatBytes(parts.bytes) }) : t('set.partsNone'))

  const row = (title: string, detail: Node | string, ...actions: Child[]) =>
    h('div', { class: 'set-row' }, h('div', { class: 'meta' }, h('div', { class: 'name' }, title),
      typeof detail === 'string' ? h('div', { class: 'detail' }, detail) : detail), h('div', { class: 'row-actions' }, ...actions))

  show(h('section', { class: 'screen' },
    h('h1', {}, t('set.title')), h('p', { class: 'sub' }, t('set.sub')),
    h('div', { class: 'stagger' },
      h('div', { class: 'card set' },
        row(t('set.lang'), t('set.langHint'), h('div', { class: 'tabs', role: 'radiogroup', 'aria-label': t('set.lang') },
          choice('es', 'Español'), choice('en', 'English')))),
      h('div', { class: 'card set' },
        row(t('set.dlFolder'), info?.dlDir ?? '',
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => poxi.dlOpenFolder() }, t('dl.openFolder'))),
        row(t('set.partsTitle'), partsText, clear)),
      h('div', { class: 'card set' },
        row(`PoxiISO ${info?.version ?? ''}`.trim(), t('about.text'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => poxi.openLink('repo') }, 'GitHub')))),
    msg))
}
