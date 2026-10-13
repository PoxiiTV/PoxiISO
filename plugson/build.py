"""Genera el plugson.tar.xz de PoxiISO a partir del original de Ventoy.

  python plugson/build.py [--lang es|en] [--in <original.tar.xz>] [--out <salida.tar.xz>]

Genera ventoy/plugson.<lang>.tar.xz (y, en español, también ventoy/plugson.tar.xz, el que lee el exe por defecto).
La app copia el del idioma elegido sobre plugson.tar.xz antes de abrir Plugson.
- es: traduce al español (plugson/es.json) los textos en inglés, que es el idioma que Plugson fuerza.
- en: deja los textos originales en inglés, con la ayuda de plugson/en.json.
- Inyecta el estilo Poxi (plugson/poxi.css), logo, icono y fuente Inter.
- Oculta el selector de idioma y el apartado de donaciones al autor original.
- FALLA si queda algún texto en inglés sin traducir, para que no se cuele nada sin revisar.
No toca el ejecutable de Ventoy: solo el paquete web que este lee de ventoy/plugson.tar.xz.
"""
import argparse, io, json, lzma, re, shutil, sys, tarfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXT = ('.html', '.js')
SKIP = ('jQuery', 'jquery.validate.min', 'md5', 'bootstrap', 'AdminLTE', 'datatables', 'Chart')
LIT = re.compile(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)\"""")


def translatable(name: str) -> bool:
    n = name.replace('\\', '/')
    return n.endswith(TEXT_EXT) and not any(s in n for s in SKIP)


def block_after(text, start, open_ch='{', close_ch='}'):
    i = text.index(open_ch, start); depth = 0
    for j in range(i, len(text)):
        if text[j] == open_ch: depth += 1
        elif text[j] == close_ch:
            depth -= 1
            if depth == 0: return text[i:j + 1]
    return text[i:]


def js_regions(s: str) -> list[tuple[int, int]]:
    """Tramos de código con textos en inglés: objetos/arrays *_en y ramas `=== 'en'`. Fuera de ellos no se traduce nada."""
    spans = []
    for m in re.finditer(r"var\s+\w*_en\s*=\s*", s):
        nxt = s[m.end()]
        blk = block_after(s, m.end(), '[', ']') if nxt == '[' else block_after(s, m.end())
        i = s.index(blk, m.end() - 1); spans.append((i, i + len(blk)))
    for m in re.finditer(r"===\s*'en'\s*\)", s):
        blk = block_after(s, m.end()); i = s.index(blk, m.end()); spans.append((i, i + len(blk)))
    spans.sort(); merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]: merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else: merged.append((a, b))
    return merged


def js_inventory(s: str) -> set[str]:
    out = set()
    for a, b in js_regions(s):
        for m in LIT.finditer(s[a:b]):
            v = m.group(1) if m.group(1) is not None else m.group(2)
            if (re.search(r'[A-Za-z]{2}', v) and not v.startswith(('#', '.')) and not re.fullmatch(r'[a-z0-9_./#:\[\]=-]+', v)
                    and not re.fullmatch(r'[A-Z][A-Z0-9_]{2,}', v)):
                out.add(v)
    return out


class _En(HTMLParser):
    VOID = {'br', 'hr', 'img', 'input', 'meta', 'link'}
    def __init__(self):
        super().__init__(convert_charrefs=False); self.stack = []; self.out = []
    def handle_starttag(self, tag, attrs):
        if tag in self.VOID: return
        i = dict(attrs).get('id') or ''
        self.stack.append((tag, i.endswith('_en') or (self.stack[-1][1] if self.stack else False)))
    def handle_endtag(self, tag):
        if tag in self.VOID or not any(t == tag for t, _ in self.stack): return  # <br/> llega como inicio+fin: no debe vaciar la pila
        while self.stack:
            if self.stack.pop()[0] == tag: break
    def handle_data(self, data):
        if self.stack and self.stack[-1][1]:
            t = re.sub(r'\s+', ' ', data.strip())
            if re.search(r'[A-Za-z]{2}', t): self.out.append(t)


def html_inventory(s: str) -> set[str]:
    p = _En(); p.feed(s); return set(p.out)


def esc(v: str, q: str) -> str:
    return v.replace('\\', '\\\\').replace(q, '\\' + q)


def apply_js(s: str, table: dict[str, str], hits: dict[str, int]) -> str:
    for a, b in reversed(js_regions(s)):
        seg = s[a:b]
        for en, es in table.items():
            for q in ("'", '"'):
                needle = f'{q}{en}{q}'
                if needle in seg:
                    hits[en] = hits.get(en, 0) + seg.count(needle)
                    seg = seg.replace(needle, f'{q}{esc(es, q)}{q}')
        s = s[:a] + seg + s[b:]
    return s


def apply_html(s: str, table: dict[str, str], hits: dict[str, int]) -> str:
    for en, es in table.items():
        # el texto puede ir entre etiquetas o entre entidades (&nbsp;): se exige que empiece tras '>' o ';' y acabe antes de '&' o '<'
        pat = r'(?<=[>;])(\s*)' + r'\s+'.join(re.escape(w) for w in en.split()) + r'(?=\s*(?:&|<))'
        s, n = re.subn(pat, lambda m: m.group(1) + es, s)
        if n: hits[en] = hits.get(en, 0) + n
    return s


def apply_keys(s: str, table: dict[str, str], hits: dict[str, int]) -> str:
    """Sustituye el valor de claves concretas dentro del objeto g_vtoy_cur_language_en (para textos ambiguos como OK)."""
    m = re.search(r"var\s+g_vtoy_cur_language_en\s*=\s*", s)
    if not m: return s
    block = block_after(s, m.end()); start = s.index(block, m.end() - 1)
    for key, es in table.items():
        pat = re.compile(r'("%s"\s*:\s*)"(?:[^"\
]|\.)*"' % re.escape(key))
        block, n = pat.subn(lambda mm: mm.group(1) + '"' + esc(es, '"') + '"', block)
        if n: hits[key] = hits.get(key, 0) + n
    return s[:start] + block + s[start + len(block_after(s, m.end())):]


HELP_JS = '''
(function(){
  var box = document.getElementById('plugson-content'); if (!box) return;
  function apply() {
    var H = window.POXI_HELP, page = (location.hash || '#plugson_main').slice(1), txt = H[page];
    var host = box.firstElementChild;
    if (!txt || !host || box.querySelector('.poxi-help')) return;
    var d = document.createElement('div'); d.className = 'poxi-help';
    var t = document.createElement('b'); t.textContent = H._titulo; d.appendChild(t);
    [txt, host.querySelector('.nav-tabs') ? H._pestanas : '', page === 'plugson_main' ? '' : H._guardado].forEach(function (x) {
      if (!x) return; var p = document.createElement('p'); p.textContent = x; d.appendChild(p);
    });
    host.insertBefore(d, host.querySelector('.box-body') || host.firstChild);
  }
  new MutationObserver(apply).observe(box, { childList: true });
  window.addEventListener('hashchange', function () { setTimeout(apply, 80); });
  apply();
})();
'''


TABS_JS = '''
// PoxiISO: en las pestañas por tipo de arranque que no tienen datos se ven los valores por defecto de Ventoy
// (p. ej. en_US); se avisa de que no se usan para que nadie crea que el menú está en inglés.
function PoxiTabNote(ulSel, exists) {
    var ul = $(ulSel)[0]; if (!ul) return;
    if (exists) ul.poxiExists = exists; else exists = ul.poxiExists || [];
    var note = $(ul).siblings('.poxi-tabnote')[0];
    if (!note) { note = document.createElement('div'); note.className = 'poxi-tabnote'; note.textContent = POXI_TABS.note; $(ul).after(note); }
    var a = $(ul).find('li.active a')[0], i = a ? parseInt(a.getAttribute('href').replace('#tab_', ''), 10) : 0;
    note.style.display = i > 0 && !exists[i] ? '' : 'none';
}
$(document).on('click', '.nav-tabs a[href^="#tab_"]', function () {
    var ul = $(this).closest('ul'); setTimeout(function () { PoxiTabNote('#' + ul.attr('id')); }, 30);
});
'''


BRAND = {
    'es': ('PoxiISO · Configuración del menú', 'Menú'),
    'en': ('PoxiISO · Boot menu settings', 'Menu'),
}


def patch_file(name: str, data: bytes, es: dict, hits_js: dict, hits_html: dict, hits_keys: dict, lang: str = 'es') -> bytes:
    n = name.replace('\\', '/')
    if not translatable(n): return data
    s = data.decode('utf8')
    s = apply_js(s, es.get('js', {}), hits_js)
    s = apply_keys(s, es.get('keys', {}), hits_keys)
    if n.endswith('.html'): s = apply_html(s, es.get('html', {}), hits_html)
    if n.endswith('static/js/vtoy.js'):
        a, b = "var g_current_language = 'cn';", "var g_vtoy_cur_language = g_vtoy_cur_language_cn;"
        assert a in s and b in s, 'vtoy.js cambió: revisa el idioma por defecto'
        s = s.replace(a, "var g_current_language = 'en';").replace(b, "var g_vtoy_cur_language = g_vtoy_cur_language_en;")
        # pestañas: "control_legacy"... pasan a "Solo BIOS"... (la clave real queda como tooltip) y aviso en las que no se usan
        reps = [
            ('newhtml = name + g_bios_postfix[i] + exspan;', 'newhtml = POXI_TABS.labels[i] + exspan;'),
            ('newhtml = name + g_bios_postfix[i];', 'newhtml = POXI_TABS.labels[i];'),
            ('            $(fid).html(newhtml);', "            $(fid).html(newhtml).attr('title', name + g_bios_postfix[i]);"),
        ]
        for a, b in reps:
            assert s.count(a) == 1, f'vtoy.js cambió: falta {a!r}'
            s = s.replace(a, b)
        a = 'function CommonUpdateTabTitleIcon(exists, id, name) {'
        s = s.replace(a, a + '\n    PoxiTabNote(id.split(" ")[0], exists);')
        s += '\nvar POXI_TABS = ' + json.dumps(es['tabs'], ensure_ascii=False) + ';' + TABS_JS
    if n.endswith('www/index.html'):
        help_js = ('<script>window.POXI_HELP = ' + json.dumps(es['help'], ensure_ascii=False) + ';' + HELP_JS + '</script>')
        s = s.replace('</body>', help_js + '\n</body>', 1) if '</body>' in s else s + help_js
        reps = [
            # el servidor devuelve su propio idioma en 'sysinfo' (según el sistema): se ignora para no volver a chino/inglés
            ('g_current_language = data.language;', "g_current_language = 'en'; /* PoxiISO: el idioma lo fija el parche (textos ya en el idioma de la app) */"),
            ('<title>Ventoy Plugson</title>', f'<title>{BRAND[lang][0]}</title>'),
            ('&nbsp;Ventoy Plugson</span>', f'&nbsp;Poxi<em>ISO</em> · {BRAND[lang][1]}</span>'),
            ('</head>', '    <link rel="stylesheet" href="static/css/poxi.css">\n</head>'),
            # sin idioma, Chrome lo adivina por el texto (cuenta los bloques _cn ocultos) y ofrece traducir "del chino"
            ('<html>', f'<html lang="{"es-ES" if lang == "es" else "en"}" translate="no">'),
            ('<meta charset="utf-8">', '<meta charset="utf-8">\n    <meta name="google" content="notranslate">'),
        ]
        for a, b in reps:
            assert a in s, f'index.html cambió: falta {a!r}'
            s = s.replace(a, b, 1)
    return s.encode('utf8')


def check_like_plugson(xz: bytes, files: int):
    """Lee el paquete como ventoy_www_init (Plugson/src/Core/ventoy_util.c): xz con CRC32, ≤ 8 MB y cabeceras ustar seguidas."""
    if xz[6:8] != b'\x00\x01': sys.exit('plugson.tar.xz debe usar CRC32 (Plugson no lee CRC64)')
    raw = lzma.decompress(xz)
    if len(raw) > 8 * 1024 * 1024: sys.exit(f'plugson.tar ocupa {len(raw)} bytes: Plugson solo admite 8 MB')
    off = seen = 0
    while off < len(raw) and raw[off + 257:off + 262] == b'ustar':
        if raw[off + 156:off + 157] == b'0':
            seen += 1
            off += 512 + (int(raw[off + 124:off + 136].strip(b'\0 ') or b'0', 8) + 511) // 512 * 512
        else: off += 512
    if seen != files: sys.exit(f'Plugson solo vería {seen} de {files} archivos del paquete')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', default=str(ROOT / 'engine/ventoy/ventoy/plugson.orig.tar.xz'))
    ap.add_argument('--out')
    ap.add_argument('--lang', choices=('es', 'en'), default='es')
    a = ap.parse_args()
    engine = ROOT / 'engine/ventoy/ventoy'
    src, out = Path(a.src), Path(a.out) if a.out else engine / f'plugson.{a.lang}.tar.xz'
    if not src.exists():  # primera vez: se guarda el original para poder regenerar siempre desde él
        orig = engine / 'plugson.tar.xz'
        if not orig.exists(): sys.exit(f'No existe {orig}: ejecuta antes `npm run engine`')
        shutil.copyfile(orig, src)
    es = json.loads((ROOT / f'plugson/{a.lang}.json').read_text(encoding='utf8'))

    members, js_inv, html_inv = [], set(), set()
    with tarfile.open(src, 'r:xz') as tf:
        for m in tf.getmembers():
            data = tf.extractfile(m).read() if m.isfile() else None
            members.append((m, data))
            if data is not None and translatable(m.name):
                s = data.decode('utf8')
                js_inv |= js_inventory(s)
                if m.name.endswith('.html'): html_inv |= html_inventory(s)

    keep = set(es.get('keep', []))
    missing = [] if a.lang == 'en' else sorted((js_inv - set(es['js']) - keep) | {f'[html] {h}' for h in html_inv - set(es['html']) - keep})
    if missing:
        sys.exit('Faltan traducciones (añádelas a plugson/es.json):\n  ' + '\n  '.join(missing))

    hits_js, hits_html, hits_keys = {}, {}, {}
    prefix = './' if members and members[0][0].name.startswith('./') else ''
    new = []
    for m, data in members:
        new.append((m, patch_file(m.name, data, es, hits_js, hits_html, hits_keys, a.lang) if data is not None else None))
    stale = sorted(({*es.get('js', {})} - set(hits_js)) | ({*es.get('keys', {})} - set(hits_keys)) | {f'[html] {h}' for h in set(es.get('html', {})) - set(hits_html)})
    if stale:
        sys.exit('Claves de es.json que ya no existen en Plugson (versión nueva de Ventoy?):\n  ' + '\n  '.join(stale))

    extra = {
        f'{prefix}www/static/css/poxi.css': (ROOT / 'plugson/poxi.css').read_bytes(),
        f'{prefix}www/static/fonts/inter.woff2': (ROOT / 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').read_bytes(),
    }
    logo = (ROOT / 'build/icon.png').read_bytes()
    replace = {f'{prefix}www/static/img/logo_32.png': logo, f'{prefix}www/favicon.ico': logo}

    out.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    # ustar sin cabeceras pax: el lector de Plugson solo entiende cabeceras ustar de 512 bytes
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.USTAR_FORMAT) as tf:
        for m, data in new:
            if m.name in replace: data = replace[m.name]
            if data is None:
                tf.addfile(m); continue
            ti = tarfile.TarInfo(m.name); ti.size = len(data); ti.mode = m.mode; ti.mtime = m.mtime
            tf.addfile(ti, io.BytesIO(data))
        for name, data in extra.items():
            ti = tarfile.TarInfo(name); ti.size = len(data); ti.mode = 0o644
            tf.addfile(ti, io.BytesIO(data))
    # CRC32 obligatorio: el descompresor de VentoyPlugson.exe (xz-embedded sin CRC64) rechaza el CRC64 por defecto
    # de Python y el exe sale con "Internal error, the program will exit!"
    out.write_bytes(lzma.compress(buf.getvalue(), check=lzma.CHECK_CRC32, preset=6))
    check_like_plugson(out.read_bytes(), sum(1 for m, d in new if d is not None) + len(extra))
    if a.lang == 'es' and not a.out: shutil.copyfile(out, engine / 'plugson.tar.xz')  # el que abre el exe si la app no elige
    print(f'plugson listo ({a.lang}): {out} ({len(hits_js)} textos JS y {len(hits_html)} de HTML traducidos)')


if __name__ == '__main__':
    main()
