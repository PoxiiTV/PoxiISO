import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { freeSpace, safeName, uniqueName } from './isos'
import { nameFromUrl } from './catalog'

export interface DlProgress { phase: 'downloading' | 'verifying'; doneBytes: number; totalBytes: number; speedBps: number }
export interface DlOptions {
  sha256?: string
  onProgress: (p: DlProgress) => void
  signal?: AbortSignal
  freeBytes?: (dir: string) => number
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError'

function headerName(cd: string | null): string | null {
  if (!cd) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd)
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) } catch { /* sigue */ } }
  return /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? null
}

async function hashFile(path: string, total: number, onProgress: (p: DlProgress) => void): Promise<string> {
  const h = createHash('sha256')
  let done = 0
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    h.update(chunk as Buffer); done += (chunk as Buffer).length
    onProgress({ phase: 'verifying', doneBytes: done, totalBytes: total, speedBps: 0 })
  }
  return h.digest('hex')
}

/**
 * Descarga `url` a `dir`. Escribe en `<nombre>.part` y reanuda si ya existe; verifica SHA-256 si se da;
 * al terminar renombra sin pisar nada. Si se cancela o cae la red, el .part se conserva para reanudar.
 * Errores: CANCELLED, NETWORK, HTTP_ERROR, HTML_RESPONSE, NO_SPACE, SHA_MISMATCH, NOT_ISO.
 */
export async function downloadFile(url: string, dir: string, fileName: string | undefined, o: DlOptions): Promise<string> {
  mkdirSync(dir, { recursive: true })
  let name = fileName ? safeName(fileName) : null
  const request = async (offset: number): Promise<Response> => {
    try {
      return await fetch(url, { signal: o.signal, redirect: 'follow', headers: offset > 0 ? { range: `bytes=${offset}-` } : {} })
    } catch (e) { throw new Error(isAbort(e) ? 'CANCELLED' : 'NETWORK') }
  }

  let part = name ? join(dir, `${name}.part`) : null
  let offset = part && existsSync(part) ? statSync(part).size : 0
  let res = await request(offset)
  if (res.status === 416 && part) { // el .part no encaja con el fichero remoto: de cero
    await res.body?.cancel(); rmSync(part, { force: true }); offset = 0; res = await request(0)
  }
  if (res.status !== 200 && res.status !== 206) { await res.body?.cancel(); throw new Error('HTTP_ERROR') }
  if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) { await res.body?.cancel(); throw new Error('HTML_RESPONSE') }

  if (!name) { // sin nombre previo: el de Content-Disposition o el de la URL (sin reanudación)
    try { name = safeName(headerName(res.headers.get('content-disposition')) ?? nameFromUrl(url) ?? '') }
    catch (e) { await res.body?.cancel(); throw e }
    part = join(dir, `${name}.part`); offset = 0
    rmSync(part, { force: true })
  }
  const partPath = part as string

  const cr = /bytes (\d+)-\d+\/(\d+|\*)/.exec(res.headers.get('content-range') ?? '')
  if (res.status === 206 && cr && Number(cr[1]) === offset) {
    // se continúa desde `offset`
  } else {
    if (offset > 0) rmSync(partPath, { force: true })
    offset = 0 // el servidor ignoró Range: llega el fichero entero
  }
  const len = Number(res.headers.get('content-length') ?? 0)
  const total = res.status === 206 && cr && cr[2] !== '*' ? Number(cr[2]) : len ? offset + len : 0
  if (total && total - offset > (o.freeBytes ?? freeSpace)(dir)) { await res.body?.cancel(); throw new Error('NO_SPACE') }

  const fh = await open(partPath, offset > 0 ? 'a' : 'w')
  const started = Date.now()
  let session = 0, lastEmit = 0, written = offset
  try {
    const reader = res.body!.getReader()
    for (;;) {
      if (o.signal?.aborted) throw new Error('CANCELLED')
      const { done, value } = await reader.read()
      if (done) break
      await fh.write(value)
      session += value.length; written += value.length
      const now = Date.now()
      if (now - lastEmit >= 200) {
        lastEmit = now
        o.onProgress({ phase: 'downloading', doneBytes: written, totalBytes: total, speedBps: session / Math.max(0.001, (now - started) / 1000) })
      }
    }
  } catch (e) {
    await fh.close()
    throw new Error((e as Error).message === 'CANCELLED' || isAbort(e) ? 'CANCELLED' : 'NETWORK') // el .part se conserva
  }
  await fh.sync(); await fh.close()
  if (total && written !== total) throw new Error('NETWORK') // cortada a medias: se podrá reanudar
  o.onProgress({ phase: 'downloading', doneBytes: written, totalBytes: total || written, speedBps: 0 })

  if (o.sha256) {
    const got = await hashFile(partPath, written, o.onProgress)
    if (got !== o.sha256.toLowerCase()) { rmSync(partPath, { force: true }); throw new Error('SHA_MISMATCH') }
  }
  const final = join(dir, uniqueName(dir, name))
  renameSync(partPath, final)
  return final
}

/** Descargas a medias (`*.part`) que quedan en `dir` tras cancelar o perder la red. Solo el primer nivel. */
export function partFiles(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 }
  const parts = readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.part'))
  return { count: parts.length, bytes: parts.reduce((s, d) => s + statSync(join(dir, d.name)).size, 0) }
}

export function clearParts(dir: string): void {
  if (!existsSync(dir)) return
  for (const d of readdirSync(dir, { withFileTypes: true })) if (d.isFile() && d.name.endsWith('.part')) rmSync(join(dir, d.name), { force: true })
}
