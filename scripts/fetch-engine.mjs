import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'

const VER = '1.1.18'
const SHA = '082c478e8c432e1ac653899fcf50e3a4077a2851bc6112b5ddd30545962164a9'
const URL = `https://github.com/ventoy/Ventoy/releases/download/v${VER}/ventoy-${VER}-windows.zip`
const zip = 'engine/ventoy.zip'

if (existsSync('engine/ventoy/Ventoy2Disk.exe')) { console.log('motor ya presente'); process.exit(0) }
mkdirSync('engine', { recursive: true })
const res = await fetch(URL)
if (!res.ok) throw new Error(`descarga fallida: ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(zip))
const got = createHash('sha256').update(readFileSync(zip)).digest('hex')
if (got !== SHA) { rmSync(zip); throw new Error(`SHA-256 no coincide: ${got}`) }
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath 'engine' -Force`])
renameSync(`engine/ventoy-${VER}`, 'engine/ventoy')
rmSync(zip)
console.log('motor listo')
