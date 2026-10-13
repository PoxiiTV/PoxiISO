import { isIsoName } from './isos'

export const GROUPS = ['windows', 'linux', 'gaming', 'tools', 'server', 'other'] as const
export type Group = typeof GROUPS[number]

export interface Entry {
  id: string
  group: Group
  name: string
  desc: string
  recommended?: boolean
  /** Se enseña siempre arriba, fuera del buscador (Windows, Ubuntu, Debian, Kali). */
  featured?: boolean
  en?: { name: string; desc: string }
  kind: 'download' | 'page'
  url?: string
  fileName?: string
  sizeBytes?: number
  sha256?: string
  sums?: { url: string; name: string }
  resolve?: { baseUrl: string; sumsUrl: string; pattern: string }
}
export interface Catalog { version: number; items: Entry[] }
export interface Resolved { url: string; fileName?: string; sha256?: string }

export const REMOTE_CATALOG = 'https://raw.githubusercontent.com/poxiitv/PoxiISO/main/data/isos.json'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 300): string => {
  if (typeof v !== 'string' || !v || v.length > max) throw new Error('INVALID_CATALOG')
  return v
}
const httpsUrl = (v: unknown): string => {
  const s = str(v, 2000)
  let u: URL
  try { u = new URL(s) } catch { throw new Error('INVALID_CATALOG') }
  if (u.protocol !== 'https:') throw new Error('INVALID_CATALOG')
  return s
}

/** El catálogo puede venir de internet: se valida todo y solo se admiten URLs https. */
export function validateCatalog(raw: unknown): Catalog {
  if (!isObj(raw) || !Array.isArray(raw.items) || raw.items.length > 300) throw new Error('INVALID_CATALOG')
  const items = raw.items.map((r): Entry => {
    if (!isObj(r)) throw new Error('INVALID_CATALOG')
    const id = str(r.id, 40)
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('INVALID_CATALOG')
    if (!(GROUPS as readonly unknown[]).includes(r.group)) throw new Error('INVALID_CATALOG')
    if (r.kind !== 'download' && r.kind !== 'page') throw new Error('INVALID_CATALOG')
    const e: Entry = { id, group: r.group as Group, name: str(r.name, 120), desc: typeof r.desc === 'string' ? r.desc.slice(0, 300) : '', kind: r.kind }
    if (r.recommended === true) e.recommended = true
    if (r.featured === true) e.featured = true
    if (isObj(r.en)) e.en = { name: str(r.en.name, 120), desc: typeof r.en.desc === 'string' ? r.en.desc.slice(0, 300) : '' }
    if (r.url !== undefined) e.url = httpsUrl(r.url)
    if (r.fileName !== undefined) {
      const f = str(r.fileName, 200)
      if (/[\\/]/.test(f) || !isIsoName(f)) throw new Error('INVALID_CATALOG')
      e.fileName = f
    }
    if (typeof r.sizeBytes === 'number' && r.sizeBytes > 0) e.sizeBytes = r.sizeBytes
    if (r.sha256 !== undefined) { if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(r.sha256)) throw new Error('INVALID_CATALOG'); e.sha256 = r.sha256.toLowerCase() }
    if (isObj(r.sums)) e.sums = { url: httpsUrl(r.sums.url), name: str(r.sums.name, 200) }
    if (isObj(r.resolve)) {
      const baseUrl = httpsUrl(r.resolve.baseUrl)
      if (!baseUrl.endsWith('/')) throw new Error('INVALID_CATALOG')
      const pattern = str(r.resolve.pattern, 120)
      try { new RegExp(pattern) } catch { throw new Error('INVALID_CATALOG') }
      e.resolve = { baseUrl, sumsUrl: httpsUrl(r.resolve.sumsUrl), pattern }
    }
    if (e.kind === 'page' && !e.url) throw new Error('INVALID_CATALOG')
    if (e.kind === 'download' && !e.url && !e.resolve) throw new Error('INVALID_CATALOG')
    return e
  })
  if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('INVALID_CATALOG')
  return { version: Number(raw.version) || 1, items }
}

export function parseSums(text: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const x = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    // gana la primera línea: algunos ficheros (GParted, Clonezilla) traen después un bloque BLAKE3, también de 64 hex
    const set = (name: string, hash: string) => { if (!m.has(name)) m.set(name, hash.toLowerCase()) }
    if (x) set(x[2].replace(/^\.\//, ''), x[1]) // algunos ficheros de sumas ponen ./nombre
    const bsd = /^SHA256 \((.+)\) = ([0-9a-fA-F]{64})\s*$/.exec(line) // formato de Fedora
    if (bsd) set(bsd[1], bsd[2])
  }
  return m
}

/** Entre los nombres que encajan con el patrón, el de versión más alta (orden numérico: 24.04.10 > 24.04.4). */
export function pickLatest(names: string[], re: RegExp): string | null {
  // sin la extensión: si no, "x-64-bit.iso" quedaría por encima de su revisión "x-64-bit-r2.iso" ('.' va después de '-')
  const base = (n: string) => n.replace(/\.[^.]+$/, '')
  const hit = names.filter(n => re.test(n)).sort((a, b) => base(a).localeCompare(base(b), undefined, { numeric: true }))
  return hit.length ? hit[hit.length - 1] : null
}

export async function resolveEntry(e: Entry, fetchText: (url: string) => Promise<string>): Promise<Resolved> {
  const sums = async (url: string) => { try { return parseSums(await fetchText(url)) } catch { throw new Error('SUMS_FAILED') } }
  if (e.resolve) {
    const map = await sums(e.resolve.sumsUrl)
    const name = pickLatest([...map.keys()], new RegExp(e.resolve.pattern))
    if (!name) throw new Error('NO_MATCH')
    return { url: e.resolve.baseUrl + encodeURIComponent(name), fileName: name, sha256: map.get(name) }
  }
  if (!e.url) throw new Error('INVALID_CATALOG')
  let sha256 = e.sha256
  if (!sha256 && e.sums) {
    sha256 = (await sums(e.sums.url)).get(e.sums.name)
    if (!sha256) throw new Error('NO_MATCH') // se pidió verificar y no hay hash: no se descarga sin verificar
  }
  return { url: e.url, fileName: e.fileName ?? nameFromUrl(e.url) ?? undefined, sha256 }
}

/** Solo https. Convierte los enlaces de "compartir" de Google Drive en descarga directa. */
export function normalizeUrl(input: string): string {
  let u: URL
  try { u = new URL(input.trim()) } catch { throw new Error('BAD_URL') }
  if (u.protocol !== 'https:') throw new Error('BAD_URL')
  if (u.hostname === 'drive.google.com') {
    const id = /\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('id')
    if (id && /^[\w-]+$/.test(id)) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`
  }
  return u.toString()
}

export function nameFromUrl(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
    return isIsoName(last) ? last : null
  } catch { return null }
}

export async function loadCatalog(
  fetchRemote: () => Promise<string>, bundled: unknown,
): Promise<{ catalog: Catalog; source: 'remote' | 'bundled' }> {
  try { return { catalog: validateCatalog(JSON.parse(await fetchRemote())), source: 'remote' } } catch { /* sin internet o catálogo roto: se usa el incluido */ }
  return { catalog: validateCatalog(bundled), source: 'bundled' }
}
