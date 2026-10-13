import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadFile, partFiles, clearParts, type DlProgress } from '../src/main/download'

// Servidor local con datos en memoria + carpetas temporales. No toca ninguna unidad real ni internet.
const DATA = Buffer.from(Array.from({ length: 3_000_000 }, (_, i) => (i * 7) % 251))
const SHA = createHash('sha256').update(DATA).digest('hex')
let server: Server, base = ''
let honorRange = true, rangeSeen: string | undefined

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? ''
    if (url === '/missing.iso') { res.writeHead(404).end('no'); return }
    if (url === '/drive.iso') { res.writeHead(200, { 'content-type': 'text/html' }).end('<html>cuota excedida</html>'); return }
    if (url === '/named') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': DATA.length, 'content-disposition': 'attachment; filename="De Cabecera.iso"' }).end(DATA); return
    }
    rangeSeen = req.headers.range
    const m = honorRange && req.headers.range ? /bytes=(\d+)-/.exec(req.headers.range) : null
    if (m) {
      const start = Number(m[1])
      if (start >= DATA.length) { res.writeHead(416).end(); return }
      res.writeHead(206, { 'content-length': DATA.length - start, 'content-range': `bytes ${start}-${DATA.length - 1}/${DATA.length}`, 'content-type': 'application/octet-stream' })
      res.end(DATA.subarray(start)); return
    }
    res.writeHead(200, { 'content-length': DATA.length, 'content-type': 'application/octet-stream' }).end(DATA)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => { server.close() })

const tmp = () => mkdtempSync(join(tmpdir(), 'poxi-dl-'))
const opts = (extra = {}) => ({ onProgress: () => {}, freeBytes: () => 1e12, ...extra })

describe('downloadFile', () => {
  it('descarga, verifica sha256, informa progreso y no deja .part', async () => {
    const d = tmp(), ev: DlProgress[] = []
    const f = await downloadFile(`${base}/a.iso`, d, 'a.iso', opts({ sha256: SHA, onProgress: (p: DlProgress) => ev.push(p) }))
    expect(readFileSync(f).equals(DATA)).toBe(true)
    expect(readdirSync(d)).toEqual(['a.iso'])
    expect(ev.some(p => p.phase === 'downloading' && p.doneBytes > 0)).toBe(true)
    expect(ev[ev.length - 1].phase).toBe('verifying')
  })
  it('hash incorrecto: borra todo y lanza SHA_MISMATCH', async () => {
    const d = tmp()
    await expect(downloadFile(`${base}/a.iso`, d, 'a.iso', opts({ sha256: '0'.repeat(64) }))).rejects.toThrow('SHA_MISMATCH')
    expect(readdirSync(d)).toEqual([])
  })
  it('reanuda desde un .part con Range', async () => {
    const d = tmp(); honorRange = true
    writeFileSync(join(d, 'r.iso.part'), DATA.subarray(0, 1_000_000))
    const f = await downloadFile(`${base}/r.iso`, d, 'r.iso', opts({ sha256: SHA }))
    expect(rangeSeen).toBe('bytes=1000000-')
    expect(readFileSync(f).equals(DATA)).toBe(true)
  })
  it('si el servidor ignora Range (200), empieza de cero sin corromper', async () => {
    const d = tmp(); honorRange = false
    writeFileSync(join(d, 's.iso.part'), Buffer.alloc(500_000, 9))
    const f = await downloadFile(`${base}/s.iso`, d, 's.iso', opts({ sha256: SHA }))
    honorRange = true
    expect(readFileSync(f).equals(DATA)).toBe(true)
  })
  it('un .part más grande que el fichero (416) se descarta y se baja entero', async () => {
    const d = tmp(); honorRange = true
    writeFileSync(join(d, 'g.iso.part'), Buffer.alloc(DATA.length + 10, 1))
    const f = await downloadFile(`${base}/g.iso`, d, 'g.iso', opts({ sha256: SHA }))
    expect(readFileSync(f).equals(DATA)).toBe(true)
  })
  it('cancelar conserva el .part para reanudar y lanza CANCELLED', async () => {
    const d = tmp(), ac = new AbortController()
    await expect(downloadFile(`${base}/c.iso`, d, 'c.iso', opts({ signal: ac.signal, onProgress: () => ac.abort() }))).rejects.toThrow('CANCELLED')
    expect(existsSync(join(d, 'c.iso'))).toBe(false)
    expect(existsSync(join(d, 'c.iso.part'))).toBe(true)
    expect(statSync(join(d, 'c.iso.part')).size).toBeLessThan(DATA.length)
  })
  it('respuesta HTML (cuota/confirmación de Drive): HTML_RESPONSE y sin ficheros', async () => {
    const d = tmp()
    await expect(downloadFile(`${base}/drive.iso`, d, 'drive.iso', opts())).rejects.toThrow('HTML_RESPONSE')
    expect(readdirSync(d)).toEqual([])
  })
  it('404: HTTP_ERROR', async () => {
    await expect(downloadFile(`${base}/missing.iso`, tmp(), 'm.iso', opts())).rejects.toThrow('HTTP_ERROR')
  })
  it('sin espacio: NO_SPACE antes de escribir', async () => {
    const d = tmp()
    await expect(downloadFile(`${base}/a.iso`, d, 'a.iso', opts({ freeBytes: () => 1000 }))).rejects.toThrow('NO_SPACE')
    expect(readdirSync(d)).toEqual([])
  })
  it('sin nombre previo usa el de Content-Disposition', async () => {
    const d = tmp()
    const f = await downloadFile(`${base}/named`, d, undefined, opts())
    expect(readdirSync(d)).toEqual(['De Cabecera.iso'])
    expect(f.endsWith('De Cabecera.iso')).toBe(true)
  })
  it('nombre peligroso o no ISO: NOT_ISO', async () => {
    await expect(downloadFile(`${base}/a.iso`, tmp(), 'virus.exe', opts())).rejects.toThrow('NOT_ISO')
  })
  it('no pisa un fichero existente: renombra', async () => {
    const d = tmp(); writeFileSync(join(d, 'a.iso'), 'otro')
    const f = await downloadFile(`${base}/a.iso`, d, 'a.iso', opts())
    expect(f.endsWith('a (1).iso')).toBe(true)
    expect(readFileSync(join(d, 'a.iso'), 'utf8')).toBe('otro')
  })
  it('error de red: NETWORK', async () => {
    await expect(downloadFile('http://127.0.0.1:1/x.iso', tmp(), 'x.iso', opts())).rejects.toThrow('NETWORK')
  })
})

describe('partFiles / clearParts', () => {
  it('cuenta y borra solo los .part del primer nivel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poxi-parts-'))
    writeFileSync(join(dir, 'a.iso.part'), Buffer.alloc(100))
    writeFileSync(join(dir, 'b.iso.part'), Buffer.alloc(50))
    writeFileSync(join(dir, 'lista.iso'), Buffer.alloc(10))
    mkdirSync(join(dir, 'sub.part'))
    expect(partFiles(dir)).toEqual({ count: 2, bytes: 150 })
    clearParts(dir)
    expect(readdirSync(dir).sort()).toEqual(['lista.iso', 'sub.part'])
    expect(partFiles(dir)).toEqual({ count: 0, bytes: 0 })
  })
  it('carpeta inexistente: cero y sin error', () => {
    const missing = join(tmpdir(), 'poxi-no-existe-' + Date.now())
    expect(partFiles(missing)).toEqual({ count: 0, bytes: 0 })
    expect(() => clearParts(missing)).not.toThrow()
  })
})
