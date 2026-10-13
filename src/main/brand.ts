import { execFile } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LABEL = 'PoxiISO'
/** Explorer lee icon/label de autorun.inf también en USB (lo que Windows bloquea es ejecutar, no el icono). */
export const AUTORUN = `[autorun]\r\nicon=ventoy\\poxiiso.ico\r\nlabel=${LABEL}\r\n`

/**
 * Comandos para dejar el USB con nombre PoxiISO y ocultar lo técnico. La carpeta `ventoy` no se puede renombrar
 * (el motor busca `/ventoy/ventoy.json` por ese nombre), así que se oculta. Solo para una raíz `X:\`; si no, nada.
 */
export function brandCommands(root: string): [string, string[]][] {
  const m = /^([A-Za-z]):\\$/.exec(root)
  if (!m) return []
  const L = m[1].toUpperCase()
  return [
    ['attrib', ['+h', '+s', `${L}:\\autorun.inf`]],
    ['attrib', ['+h', '+s', `${L}:\\ventoy`]],
    ['powershell', ['-NoProfile', '-NonInteractive', '-Command', `Set-Volume -DriveLetter ${L} -NewFileSystemLabel '${LABEL}'`]],
  ]
}

/** Escribe el icono y autorun.inf en la raíz (la carpeta `ventoy` ya existe tras aplicar el tema). */
export function writeBrandFiles(root: string, iconSrc: string): boolean {
  try {
    writeFileSync(join(root, 'ventoy', 'poxiiso.ico'), readFileSync(iconSrc))
    const inf = join(root, 'autorun.inf')
    rmSync(inf, { force: true }) // oculto + sistema: Windows no deja sobrescribirlo, pero sí borrarlo
    writeFileSync(inf, AUTORUN)
    return true
  } catch { return false }
}

const run = (file: string, args: string[]) =>
  new Promise<void>(r => { execFile(file, args, { windowsHide: true, timeout: 20_000 }, () => r()) })

/** Nombre, icono y carpetas ocultas. Nunca falla: si algo no sale, el USB funciona igual. */
export async function brandDrive(root: string, iconSrc: string): Promise<void> {
  const cmds = brandCommands(root)
  if (!cmds.length) return
  writeBrandFiles(root, iconSrc)
  for (const [file, args] of cmds) await run(file, args)
}
