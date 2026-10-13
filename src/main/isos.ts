import { existsSync, readdirSync, statSync, statfsSync, unlinkSync, renameSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'

export const ISO_EXTS = ['.iso', '.wim', '.img', '.vhd', '.vhdx', '.efi']
const PROTECTED = new Set(['ventoy', 'system volume information', '$recycle.bin'])
const CHUNK = 1024 * 1024

export interface IsoFile { rel: string; name: string; sizeBytes: number }
export interface CopyProgress {
  file: string; fileIndex: number; fileCount: number
  fileBytes: number; fileTotal: number; doneBytes: number; totalBytes: number
}
export interface CopyResult { copied: string[]; skipped: { file: string; reason: 'NOT_ISO' | 'MISSING' | 'TOO_BIG' }[] }
export interface CopyOptions { freeBytes?: (root: string) => number; signal?: AbortSignal; maxFileBytes?: number }

/** FAT32 no admite ficheros de 4 GiB o más. */
export const FAT32_MAX = 2 ** 32 - 1

export function isIsoName(name: string): boolean {
  const i = name.lastIndexOf('.')
  return i > 0 && ISO_EXTS.includes(name.slice(i).toLowerCase())
}

const isProtectedDir = (name: string) => PROTECTED.has(name.toLowerCase()) || name.startsWith('.')

/** Nombre seguro para escribir en el USB: sin rutas, sin caracteres inválidos en Windows y con extensión permitida. */
export function safeName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const clean = leaf.replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '')
  if (!isIsoName(clean)) throw new Error('NOT_ISO')
  return clean
}

export function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name), base = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n++) {
    const cand = `${base} (${n})${ext}`
    if (!existsSync(join(dir, cand))) return cand
  }
}

export function listIsos(root: string, maxDepth = 4): IsoFile[] {
  const out: IsoFile[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (depth < maxDepth && !isProtectedDir(e.name)) walk(join(dir, e.name), r, depth + 1)
      } else if (e.isFile() && isIsoName(e.name)) {
        try { out.push({ rel: r, name: e.name, sizeBytes: statSync(join(dir, e.name)).size }) } catch { /* desapareció */ }
      }
    }
  }
  walk(root, '', 0)
  return out.sort((a, b) => a.rel.toLowerCase().localeCompare(b.rel.toLowerCase()))
}

export const freeSpace = (root: string) => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize) }

export async function copyIsos(
  root: string, sources: string[], onProgress: (p: CopyProgress) => void, opts: CopyOptions = {},
): Promise<CopyResult> {
  const result: CopyResult = { copied: [], skipped: [] }
  const jobs: { src: string; name: string; size: number }[] = []
  for (const src of sources) {
    let size: number
    try { const s = statSync(src); if (!s.isFile()) throw 0; size = s.size } catch { result.skipped.push({ file: basename(src), reason: 'MISSING' }); continue }
    let name: string
    try { name = safeName(basename(src)) } catch { result.skipped.push({ file: basename(src), reason: 'NOT_ISO' }); continue }
    if (opts.maxFileBytes && size > opts.maxFileBytes) { result.skipped.push({ file: basename(src), reason: 'TOO_BIG' }); continue }
    jobs.push({ src, name, size })
  }
  // restos de copias interrumpidas (app cerrada a mitad): ocupan sitio y no se ven en la lista
  try { for (const f of readdirSync(root)) if (f.endsWith('.poxipart')) rmSync(join(root, f), { force: true }) } catch { /* sin permiso: se dejan */ }
  const totalBytes = jobs.reduce((a, j) => a + j.size, 0)
  if (jobs.length && totalBytes > (opts.freeBytes ?? freeSpace)(root)) throw new Error('NO_SPACE')

  let doneBytes = 0
  for (const [i, job] of jobs.entries()) {
    const finalName = uniqueName(root, job.name)
    const part = join(root, `${finalName}.poxipart`)
    const rd = await open(job.src, 'r')
    const wr = await open(part, 'w').catch(async e => { await rd.close(); throw e })
    let fileBytes = 0
    try {
      const buf = Buffer.allocUnsafe(CHUNK)
      for (;;) {
        if (opts.signal?.aborted) throw new Error('CANCELLED')
        const { bytesRead } = await rd.read(buf, 0, CHUNK, null)
        if (!bytesRead) break
        await wr.write(buf, 0, bytesRead)
        fileBytes += bytesRead; doneBytes += bytesRead
        onProgress({ file: finalName, fileIndex: i + 1, fileCount: jobs.length, fileBytes, fileTotal: job.size, doneBytes, totalBytes })
      }
      await wr.sync()
    } catch (e) {
      await rd.close(); await wr.close()
      rmSync(part, { force: true })
      throw e
    }
    await rd.close(); await wr.close()
    renameSync(part, join(root, finalName))
    result.copied.push(finalName)
  }
  return result
}

/** Borra una ISO de la unidad. Solo ficheros ISO dentro de `root`, nunca de las carpetas protegidas. */
export function deleteIso(root: string, rel: string): void {
  const base = resolve(root)
  const target = resolve(base, rel)
  if (!target.startsWith(base + sep)) throw new Error('OUTSIDE_ROOT')
  const parts = target.slice(base.length + 1).split(sep)
  if (parts.slice(0, -1).some(isProtectedDir)) throw new Error('PROTECTED')
  if (!isIsoName(parts[parts.length - 1])) throw new Error('NOT_ISO')
  if (!statSync(target).isFile()) throw new Error('NOT_FILE')
  unlinkSync(target)
}
