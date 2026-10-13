import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Solo usa ficheros del repo y carpetas temporales. Necesita `npm run engine` hecho y Python en el PATH.
const orig = 'engine/ventoy/ventoy/plugson.orig.tar.xz'
const py = spawnSync('python', ['--version'])
const can = existsSync(orig) && py.status === 0

describe.skipIf(!can)('plugson/build.py', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poxi-plugson-'))
  const out = join(dir, 'plugson.tar.xz')
  const run = spawnSync('python', ['plugson/build.py', '--in', orig, '--out', out], { encoding: 'utf8' })
  const ex = join(dir, 'x')
  const untar = () => spawnSync('python', ['-c', 'import tarfile,sys; tarfile.open(sys.argv[1]).extractall(sys.argv[2])', out, ex], { encoding: 'utf8' })
  const read = (p: string) => readFileSync(join(ex, 'www', p), 'utf8')

  it('genera el paquete sin textos sin traducir ni claves obsoletas', () => {
    expect(run.stderr + run.stdout).toContain('plugson listo')
    expect(run.status).toBe(0)
    expect(existsSync(out)).toBe(true)
  })

  it('fuerza español: idioma por defecto, ignora el del servidor y trae textos traducidos', () => {
    expect(untar().status).toBe(0)
    const vtoy = read('static/js/vtoy.js')
    expect(vtoy).toContain("var g_current_language = 'en';")
    expect(vtoy).toContain('g_vtoy_cur_language = g_vtoy_cur_language_en;')
    expect(read('plugson_main.html')).toContain('Información del hardware')
    expect(vtoy).toContain('¡Configuración guardada!')
    const index = read('index.html')
    expect(index).not.toContain('g_current_language = data.language;')
    expect(read('plugson_control.html')).toContain('Ignorar la comprobación de Secure Boot')
  })

  it('inyecta el estilo Poxi, la marca y la fuente; oculta lo que no aplica', () => {
    const index = read('index.html')
    expect(index).toContain('static/css/poxi.css')
    expect(index).toContain('<title>PoxiISO')
    expect(index).not.toContain('Ventoy Plugson</title>')
    expect(index).toContain('<html lang="es-ES" translate="no">') // si no, Chrome cree que es chino y ofrece traducir
    expect(index).toContain('<meta name="google" content="notranslate">')
    expect(existsSync(join(ex, 'www/static/css/poxi.css'))).toBe(true)
    expect(existsSync(join(ex, 'www/static/fonts/inter.woff2'))).toBe(true)
    const css = read('static/css/poxi.css')
    expect(css).toContain('#id_top_donation')
    expect(css).toContain('[id$="_cn"]')
  })

  it('explica cada pantalla en español y avisa de las pestañas', () => {
    const index = read('index.html')
    expect(index).toContain('POXI_HELP')
    for (const p of ['main', 'control', 'theme', 'menu_alias', 'menu_tip', 'menu_class', 'auto_install', 'persistence', 'injection', 'conf_replace', 'password', 'image_list', 'auto_memdisk', 'dud'])
      expect(index, `falta la ayuda de plugson_${p}`).toContain(`"plugson_${p}":`)
    expect(index).toContain('«Solo BIOS»')
    expect(index).toContain('ventoy_backup.json')
  })

  it('pestañas por tipo de arranque con nombre claro y aviso en las que no se usan', () => {
    const vtoy = read('static/js/vtoy.js')
    expect(vtoy).toContain('newhtml = POXI_TABS.labels[i]')
    expect(vtoy).toContain('"Solo BIOS"')
    expect(vtoy).toContain('PoxiTabNote(id.split(" ")[0], exists);')
    expect(read('static/css/poxi.css')).toContain('.poxi-tabnote')
  })

  it('no queda chino en los textos visibles por defecto (los bloques _cn se ocultan)', () => {
    expect(read('static/css/poxi.css')).toContain('[id$="_cn"] { display: none !important; }')
  })

  it('no toca el código de las librerías (jQuery, Bootstrap, DataTables…)', () => {
    const a = readFileSync(join(ex, 'www/static/js/jQuery-2.1.4.min.js'))
    expect(a.length).toBeGreaterThan(80000)
  })
})

describe.skipIf(!can)('plugson/build.py --lang en', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poxi-plugson-en-'))
  const out = join(dir, 'plugson.tar.xz')
  const run = spawnSync('python', ['plugson/build.py', '--lang', 'en', '--in', orig, '--out', out], { encoding: 'utf8' })
  const ex = join(dir, 'x')
  spawnSync('python', ['-c', 'import tarfile,sys; tarfile.open(sys.argv[1]).extractall(sys.argv[2])', out, ex])
  const read = (p: string) => readFileSync(join(ex, 'www', p), 'utf8')

  it('se genera en inglés, con estilo Poxi, ayuda en inglés y sin chino', () => {
    expect(run.status, run.stderr).toBe(0)
    const index = read('index.html')
    expect(index).toContain('<title>PoxiISO · Boot menu settings</title>')
    expect(index).toContain('<html lang="en" translate="no">')
    expect(index).toContain('What is this?')
    expect(index).not.toContain('¿Qué es esto?')
    expect(index).toContain('static/css/poxi.css')
    expect(index).not.toContain('g_current_language = data.language;')
    expect(read('static/js/vtoy.js')).toContain("var g_current_language = 'en';")
    expect(read('plugson_main.html')).not.toContain('Información del hardware')
  })
  it('la ayuda en inglés cubre las mismas pantallas que la española', () => {
    const es = JSON.parse(readFileSync('plugson/es.json', 'utf8')).help
    const en = JSON.parse(readFileSync('plugson/en.json', 'utf8')).help
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
  })
})
