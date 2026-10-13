import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { UsbDisk } from './usb'

export interface InstallOptions {
  mode: 'install' | 'update'
  phyDrive: number
  gpt: boolean
  secureBoot: boolean
  fs: 'exFAT' | 'NTFS' | 'FAT32'
  reserveMB: number
  lang?: 'es' | 'en'
}

/**
 * Valida lo que llega de la interfaz antes de formatear nada: el disco tiene que ser uno de los USB que se acaban de
 * listar (nunca un disco interno) y, para actualizar, tener ya PoxiISO/Ventoy. Lanza BAD_INPUT o NOT_ALLOWED.
 */
export function validateInstall(raw: unknown, disks: UsbDisk[]): InstallOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  const mode = o.mode, fs = o.fs, reserveMB = o.reserveMB
  if ((mode !== 'install' && mode !== 'update') || (fs !== 'exFAT' && fs !== 'NTFS' && fs !== 'FAT32')
    || typeof o.phyDrive !== 'number' || typeof reserveMB !== 'number' || !Number.isFinite(reserveMB) || reserveMB < 0) throw new Error('BAD_INPUT')
  const disk = disks.find(d => d.number === o.phyDrive)
  if (!disk || (mode === 'update' && !disk.hasVentoy)) throw new Error('NOT_ALLOWED')
  return { mode, phyDrive: disk.number, gpt: o.gpt !== false, secureBoot: o.secureBoot !== false, fs, reserveMB: Math.floor(reserveMB), lang: o.lang === 'en' ? 'en' : 'es' }
}

export function buildArgs(o: InstallOptions): string[] {
  if (!Number.isInteger(o.phyDrive) || o.phyDrive < 0) throw new Error('phyDrive inválido')
  const a = ['VTOYCLI', o.mode === 'install' ? '/I' : '/U', `/PhyDrive:${o.phyDrive}`]
  if (o.mode === 'install' && o.gpt) a.push('/GPT')
  if (!o.secureBoot) a.push('/NOSB')
  if (o.mode === 'install') {
    a.push(`/FS:${o.fs}`)
    if (o.reserveMB > 0) a.push(`/R:${Math.floor(o.reserveMB)}`)
  }
  return a
}

export function parseDone(text: string): 'ok' | 'fail' | null {
  const t = text.trim()
  return t === '0' ? 'ok' : t === '1' ? 'fail' : null
}

export function parsePercent(text: string): number {
  const n = parseInt(text.trim(), 10)
  return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, n))
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

// ponytail: sondeo cada 400 ms de los ficheros del CLI; si Ventoy dejara de escribirlos habría que leer stdout.
export function runVentoy(
  o: InstallOptions, engineDir: string, onProgress: (p: number) => void, timeoutMs = 15 * 60_000,
): Promise<void> {
  const [doneF, pctF, logF] = ['cli_done.txt', 'cli_percent.txt', 'cli_log.txt'].map(f => join(engineDir, f))
  for (const f of [doneF, pctF, logF]) if (existsSync(f)) rmSync(f)
  return new Promise((resolve, reject) => {
    const child = spawn(join(engineDir, 'Ventoy2Disk.exe'), buildArgs(o), { cwd: engineDir })
    const started = Date.now()
    let finished = false
    const end = (err?: Error) => {
      if (finished) return
      finished = true; clearInterval(timer); child.kill()
      err ? reject(err) : resolve()
    }
    const timer = setInterval(() => {
      onProgress(parsePercent(read(pctF)))
      const done = parseDone(read(doneF))
      if (done === 'ok') { onProgress(100); end() }
      else if (done === 'fail') end(new Error('INSTALL_FAILED'))
      else if (Date.now() - started > timeoutMs) end(new Error('TIMEOUT'))
    }, 400)
    child.on('error', e => end(e))
    child.on('exit', () => {
      // el proceso puede terminar antes de que leamos el marcador
      setTimeout(() => end(parseDone(read(doneF)) === 'ok' ? undefined : new Error('INSTALL_FAILED')), 1000)
    })
  })
}

/**
 * VentoyPlugson.exe solo lee `ventoy/plugson.tar.xz`: deja ahí el paquete del idioma pedido (plugson.<lang>.tar.xz).
 * Si no existe o no se puede copiar, se queda el que hubiera (español) y devuelve false.
 */
export function selectPlugson(engineDir: string, lang: unknown): boolean {
  const dir = join(engineDir, 'ventoy')
  const pick = join(dir, `plugson.${lang === 'en' ? 'en' : 'es'}.tar.xz`)
  try {
    if (!existsSync(pick)) return false
    copyFileSync(pick, join(dir, 'plugson.tar.xz'))
    return true
  } catch { return false }
}
