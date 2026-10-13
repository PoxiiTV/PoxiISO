import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateCatalog, parseSums, pickLatest, resolveEntry, normalizeUrl, nameFromUrl, loadCatalog, type Entry } from '../src/main/catalog'

const bundled = JSON.parse(readFileSync('data/isos.json', 'utf8'))

describe('catálogo incluido en el repo', () => {
  it('es válido y tiene Windows primero', () => {
    const c = validateCatalog(bundled)
    expect(c.items.length).toBeGreaterThan(3)
    expect(c.items[0].group).toBe('windows')
    expect(c.items.filter(i => i.group === 'windows' && i.recommended)).toHaveLength(1)
    expect(new Set(c.items.map(i => i.id)).size).toBe(c.items.length)
  })
  it('todas las entradas tienen texto en inglés', () => {
    for (const i of validateCatalog(bundled).items) expect(i.en?.name && i.en.desc, i.id).toBeTruthy()
  })
})

describe('validateCatalog', () => {
  const ok = { version: 1, items: [{ id: 'a', group: 'linux', name: 'A', desc: 'd', kind: 'page', url: 'https://x.org/' }] }
  it('acepta un catálogo mínimo', () => expect(validateCatalog(ok).items).toHaveLength(1))
  it('textos en inglés opcionales; nombre vacío se rechaza', () => {
    const one = (en: unknown) => validateCatalog({ items: [{ ...ok.items[0], en }] }).items[0]
    expect(one({ name: 'A en', desc: 'd en' }).en).toEqual({ name: 'A en', desc: 'd en' })
    expect(one(undefined).en).toBeUndefined()
    expect(() => one({ name: '' })).toThrow()
  })
  it('rechaza http, javascript:, ids raros y grupos desconocidos', () => {
    const bad = (patch: object) => () => validateCatalog({ ...ok, items: [{ ...ok.items[0], ...patch }] })
    expect(bad({ url: 'http://x.org/' })).toThrow()
    expect(bad({ url: 'javascript:alert(1)' })).toThrow()
    expect(bad({ id: '../x' })).toThrow()
    expect(bad({ group: 'otros' })).toThrow()
    expect(bad({ kind: 'exe' })).toThrow()
  })
  it('rechaza patrones regex enormes o inválidos', () => {
    const it = (resolve: object) => ({ ...ok, items: [{ id: 'b', group: 'linux', name: 'B', desc: '', kind: 'download', resolve }] })
    const r = { baseUrl: 'https://x.org/', sumsUrl: 'https://x.org/SUMS', pattern: '^a$' }
    expect(() => validateCatalog(it(r))).not.toThrow()
    expect(() => validateCatalog(it({ ...r, pattern: '(' }))).toThrow()
    expect(() => validateCatalog(it({ ...r, pattern: 'a'.repeat(500) }))).toThrow()
  })
  it('rechaza entradas sin url ni resolve, o con nombre de archivo inválido', () => {
    expect(() => validateCatalog({ version: 1, items: [{ id: 'c', group: 'linux', name: 'C', desc: '', kind: 'download' }] })).toThrow()
    expect(() => validateCatalog({ version: 1, items: [{ id: 'c', group: 'linux', name: 'C', desc: '', kind: 'download', url: 'https://x.org/a', fileName: 'a.exe' }] })).toThrow()
  })
  it('rechaza basura', () => {
    for (const x of [null, 5, 'x', {}, { items: 'no' }]) expect(() => validateCatalog(x)).toThrow()
  })
})

describe('parseSums / pickLatest', () => {
  const sums = [
    'a'.repeat(64) + ' *ubuntu-24.04.3-desktop-amd64.iso',
    'b'.repeat(64) + ' *ubuntu-24.04.10-desktop-amd64.iso',
    'c'.repeat(64) + '  ubuntu-24.04.4-live-server-amd64.iso',
    'basura sin hash',
  ].join('\n')
  it('lee formato con * y con doble espacio', () => {
    const m = parseSums(sums)
    expect(m.get('ubuntu-24.04.3-desktop-amd64.iso')).toBe('a'.repeat(64))
    expect(m.get('ubuntu-24.04.4-live-server-amd64.iso')).toBe('c'.repeat(64))
    expect(m.size).toBe(3)
  })
  it('elige la versión más alta con orden numérico (10 > 4)', () => {
    expect(pickLatest([...parseSums(sums).keys()], /^ubuntu-24\.04(\.\d+)?-desktop-amd64\.iso$/)).toBe('ubuntu-24.04.10-desktop-amd64.iso')
  })
  it('null si nada encaja', () => expect(pickLatest(['a.iso'], /^b$/)).toBeNull())
  it('lee el formato de Fedora (SHA256 (nombre) = hash) e ignora la firma PGP', () => {
    const m = parseSums([
      '-----BEGIN PGP SIGNED MESSAGE-----', 'Hash: SHA256', '',
      '# Fedora-Workstation-Live-44-1.7.x86_64.iso: 2851612672 bytes',
      `SHA256 (Fedora-Workstation-Live-44-1.7.x86_64.iso) = ${'D'.repeat(64)}`,
      '-----BEGIN PGP SIGNATURE-----', 'iQIzBAEBCAAdFiEENvYS3PJ/fRpIqDXk2/z3HG2fkKYFAmnrjd8ACgkQ2/z3HG2f',
    ].join('\n'))
    expect([...m]).toEqual([['Fedora-Workstation-Live-44-1.7.x86_64.iso', 'd'.repeat(64)]])
  })
})

describe('resolveEntry', () => {
  const base: Entry = { id: 'u', group: 'linux', name: 'U', desc: '', kind: 'download',
    resolve: { baseUrl: 'https://r.test/noble/', sumsUrl: 'https://r.test/noble/SHA256SUMS', pattern: '^ubuntu-[\\d.]+-desktop-amd64\\.iso$' } }
  it('resuelve nombre, url y sha256 desde la lista de sumas', async () => {
    const r = await resolveEntry(base, async () => 'f'.repeat(64) + ' *ubuntu-24.04.4-desktop-amd64.iso\n')
    expect(r).toEqual({ url: 'https://r.test/noble/ubuntu-24.04.4-desktop-amd64.iso', fileName: 'ubuntu-24.04.4-desktop-amd64.iso', sha256: 'f'.repeat(64) })
  })
  it('falla con NO_MATCH si ninguna línea encaja y con SUMS_FAILED si no se descargan', async () => {
    await expect(resolveEntry(base, async () => 'f'.repeat(64) + ' *otra.iso')).rejects.toThrow('NO_MATCH')
    await expect(resolveEntry(base, async () => { throw new Error('red') })).rejects.toThrow('SUMS_FAILED')
  })
  it('url fija con sha256Name toma el hash de la lista', async () => {
    const e: Entry = { id: 'a', group: 'linux', name: 'A', desc: '', kind: 'download', url: 'https://r.test/arch.iso', sums: { url: 'https://r.test/sums', name: 'arch.iso' } }
    expect((await resolveEntry(e, async () => 'e'.repeat(64) + ' arch.iso')).sha256).toBe('e'.repeat(64))
  })
  it('url fija sin sumas: sin sha256', async () => {
    const e: Entry = { id: 'w', group: 'windows', name: 'W', desc: '', kind: 'download', url: 'https://r.test/w.iso', fileName: 'W.iso' }
    expect(await resolveEntry(e, async () => '')).toEqual({ url: 'https://r.test/w.iso', fileName: 'W.iso', sha256: undefined })
  })
})

describe('normalizeUrl / nameFromUrl', () => {
  it('convierte enlaces de Drive en descarga directa', () => {
    const want = 'https://drive.usercontent.google.com/download?id=ABC_123-x&export=download&confirm=t'
    expect(normalizeUrl('https://drive.google.com/file/d/ABC_123-x/view?usp=sharing')).toBe(want)
    expect(normalizeUrl('https://drive.google.com/uc?export=download&id=ABC_123-x')).toBe(want)
  })
  it('solo https; el resto lanza', () => {
    expect(normalizeUrl(' https://a.org/x.iso ')).toBe('https://a.org/x.iso')
    for (const u of ['http://a.org/x.iso', 'ftp://a.org/x.iso', 'file:///C:/x.iso', 'no es url', '']) expect(() => normalizeUrl(u)).toThrow()
  })
  it('saca el nombre del final de la ruta, decodificado', () => {
    expect(nameFromUrl('https://a.org/d/Mi%20ISO.iso?x=1')).toBe('Mi ISO.iso')
    expect(nameFromUrl('https://a.org/')).toBeNull()
    expect(nameFromUrl('https://a.org/foto.png')).toBeNull()
  })
})

describe('loadCatalog', () => {
  const good = JSON.stringify(bundled)
  it('usa el remoto si es válido', async () => {
    const r = await loadCatalog(async () => good, bundled)
    expect(r.source).toBe('remote')
  })
  it('cae al incluido si el remoto falla o es inválido', async () => {
    expect((await loadCatalog(async () => { throw new Error('offline') }, bundled)).source).toBe('bundled')
    expect((await loadCatalog(async () => '{"items":"x"}', bundled)).source).toBe('bundled')
    expect((await loadCatalog(async () => 'no json', bundled)).source).toBe('bundled')
  })
})

describe('categorías y destacadas', () => {
  const one = (extra: object) => validateCatalog({ version: 1, items: [{ id: 'x', group: 'linux', name: 'X', desc: '', kind: 'page', url: 'https://x.org/', ...extra }] }).items[0]
  it('acepta las categorías nuevas y rechaza las desconocidas', () => {
    for (const g of ['gaming', 'tools', 'server', 'other']) expect(one({ group: g }).group).toBe(g)
    expect(() => one({ group: 'juegos' })).toThrow()
  })
  it('featured solo si es true', () => {
    expect(one({ featured: true }).featured).toBe(true)
    expect(one({ featured: 'si' }).featured).toBeUndefined()
  })
  it('las sumas con ./nombre se leen sin el ./', () => {
    expect(parseSums(`${'a'.repeat(64)}  ./foo.iso`).get('foo.iso')).toBe('a'.repeat(64))
  })
})

describe('pickLatest con revisiones', () => {
  it('una revisión -r2 gana a la ISO original de la misma versión', () => {
    const re = /^Zorin-OS-17\.\d+-Core-64-bit(-r\d+)?\.iso$/
    expect(pickLatest(['Zorin-OS-17.3-Core-64-bit.iso', 'Zorin-OS-17.3-Core-64-bit-r2.iso', 'Zorin-OS-17.2-Core-64-bit.iso'], re)).toBe('Zorin-OS-17.3-Core-64-bit-r2.iso')
  })
})

describe('parseSums con varios bloques de hashes', () => {
  it('se queda con el SHA-256 (primero) y no con el BLAKE3 que viene después', () => {
    const txt = `### SHA256SUMS:\n${'a'.repeat(64)}  gparted.iso\n### B3SUMS:\n${'b'.repeat(64)}  gparted.iso\n`
    expect(parseSums(txt).get('gparted.iso')).toBe('a'.repeat(64))
  })
})
