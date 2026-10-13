import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isIsoName, listIsos, uniqueName, copyIsos, deleteIso, safeName, type CopyProgress } from '../src/main/isos'
import { resolveVentoyRoot } from '../src/main/usb'

// SOLO carpetas temporales: estos tests nunca tocan una unidad real.
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const file = (path: string, bytes = 10) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, Buffer.alloc(bytes, 1)) }

describe('isIsoName', () => {
  it('acepta extensiones de Ventoy sin importar mayúsculas', () => {
    for (const n of ['a.iso', 'a.ISO', 'a.wim', 'a.img', 'a.vhd', 'a.vhdx', 'a.efi']) expect(isIsoName(n)).toBe(true)
  })
  it('rechaza el resto', () => {
    for (const n of ['a.txt', 'iso', '.iso.exe', 'a.iso.part', '']) expect(isIsoName(n)).toBe(false)
  })
})

describe('safeName', () => {
  it('quita caracteres no válidos en Windows y rutas', () => {
    expect(safeName('a<b>c:d?.iso')).toBe('abcd.iso')
    expect(safeName('..\\..\\evil.iso')).toBe('evil.iso')
  })
  it('lanza si no queda nombre o extensión válida', () => {
    expect(() => safeName('???.iso')).toThrow()
    expect(() => safeName('foto.png')).toThrow()
  })
})

describe('uniqueName', () => {
  it('añade (1), (2)… si ya existe', () => {
    const d = tmp('poxi-u-')
    file(join(d, 'x.iso')); file(join(d, 'x (1).iso'))
    expect(uniqueName(d, 'x.iso')).toBe('x (2).iso')
    expect(uniqueName(d, 'y.iso')).toBe('y.iso')
  })
})

describe('listIsos', () => {
  it('lista ISOs de la raíz y subcarpetas, ignorando carpetas del sistema y ventoy', () => {
    const d = tmp('poxi-l-')
    file(join(d, 'win.iso'), 5)
    file(join(d, 'Linux', 'ubu.ISO'), 7)
    file(join(d, 'ventoy', 'theme', 'x.iso'))
    file(join(d, '$RECYCLE.BIN', 'x.iso'))
    file(join(d, 'System Volume Information', 'x.iso'))
    file(join(d, 'notas.txt'))
    const r = listIsos(d).map(i => [i.rel, i.sizeBytes])
    expect(r).toEqual([['Linux/ubu.ISO', 7], ['win.iso', 5]])
  })
  it('no falla con carpeta inexistente', () => {
    expect(listIsos(join(tmpdir(), 'poxi-no-existe-xyz'))).toEqual([])
  })
  it('respeta la profundidad máxima', () => {
    const d = tmp('poxi-d-')
    file(join(d, 'a', 'b', 'c', 'd', 'e', 'x.iso'))
    expect(listIsos(d, 2)).toEqual([])
  })
})

describe('copyIsos', () => {
  it('copia varias, informa progreso y no deja ficheros temporales', async () => {
    const src = tmp('poxi-s-'), dst = tmp('poxi-t-')
    file(join(src, 'a.iso'), 3000); file(join(src, 'b.iso'), 5000)
    const ev: CopyProgress[] = []
    const r = await copyIsos(dst, [join(src, 'a.iso'), join(src, 'b.iso')], p => ev.push(p), { freeBytes: () => 1e9 })
    expect(r.copied.sort()).toEqual(['a.iso', 'b.iso'])
    expect(readFileSync(join(dst, 'b.iso')).length).toBe(5000)
    expect(readdirSync(dst).some(n => n.endsWith('.poxipart'))).toBe(false)
    const last = ev[ev.length - 1]
    expect(last.doneBytes).toBe(8000); expect(last.totalBytes).toBe(8000); expect(last.fileCount).toBe(2)
  })
  it('en FAT32 omite las de más de 4 GB (TOO_BIG) y copia el resto', async () => {
    const src = tmp('poxi-s-'), dst = tmp('poxi-t-')
    file(join(src, 'grande.iso'), 200); file(join(src, 'peque.iso'), 50)
    const r = await copyIsos(dst, [join(src, 'grande.iso'), join(src, 'peque.iso')], () => {}, { freeBytes: () => 1e9, maxFileBytes: 100 })
    expect(r.copied).toEqual(['peque.iso'])
    expect(r.skipped).toEqual([{ file: 'grande.iso', reason: 'TOO_BIG' }])
  })
  it('borra restos .poxipart de copias interrumpidas y no toca nada más', async () => {
    const src = tmp('poxi-s-'), dst = tmp('poxi-t-')
    file(join(src, 'a.iso'), 10); file(join(dst, 'vieja.iso.poxipart'), 500); file(join(dst, 'mia.iso'), 7)
    await copyIsos(dst, [join(src, 'a.iso')], () => {}, { freeBytes: () => 1e9 })
    expect(readdirSync(dst).sort()).toEqual(['a.iso', 'mia.iso'])
  })
  it('no pisa: si existe, renombra', async () => {
    const src = tmp('poxi-s-'), dst = tmp('poxi-t-')
    file(join(src, 'a.iso'), 10); file(join(dst, 'a.iso'), 99)
    const r = await copyIsos(dst, [join(src, 'a.iso')], () => {}, { freeBytes: () => 1e9 })
    expect(r.copied).toEqual(['a (1).iso'])
    expect(readFileSync(join(dst, 'a.iso')).length).toBe(99)
  })
  it('omite lo que no es ISO o no existe y copia el resto', async () => {
    const src = tmp('poxi-s-'), dst = tmp('poxi-t-')
    file(join(src, 'ok.iso')); file(join(src, 'foto.png'))
    const r = await copyIsos(dst, [join(src, 'foto.png'), join(src, 'no-existe.iso'), join(src, 'ok.iso')], () => {}, { freeBytes: () => 1e9 })
    expect(r.copied).toEqual(['ok.iso'])
    expect(r.skipped.map(s => s.reason).sort()).toEqual(['MISSING', 'NOT_ISO'])
  })
  it('falla antes de copiar nada si no hay espacio', async () => {
    const src = tmp('poxi-s-'), dst = tmp('poxi-t-')
    file(join(src, 'a.iso'), 5000)
    await expect(copyIsos(dst, [join(src, 'a.iso')], () => {}, { freeBytes: () => 1000 })).rejects.toThrow('NO_SPACE')
    expect(readdirSync(dst)).toEqual([])
  })
  it('cancelar borra el parcial y lanza CANCELLED', async () => {
    const src = tmp('poxi-s-'), dst = tmp('poxi-t-')
    file(join(src, 'a.iso'), 4 * 1024 * 1024)
    const ac = new AbortController()
    await expect(copyIsos(dst, [join(src, 'a.iso')], () => ac.abort(), { freeBytes: () => 1e9, signal: ac.signal })).rejects.toThrow('CANCELLED')
    expect(readdirSync(dst)).toEqual([])
  })
  it('un ISO sin copiar (lista vacía) no falla', async () => {
    const dst = tmp('poxi-t-')
    expect(await copyIsos(dst, [], () => {}, { freeBytes: () => 1 })).toEqual({ copied: [], skipped: [] })
  })
})

describe('deleteIso', () => {
  it('borra una ISO dentro de la raíz', () => {
    const d = tmp('poxi-x-'); file(join(d, 'Linux', 'a.iso'))
    deleteIso(d, 'Linux/a.iso')
    expect(existsSync(join(d, 'Linux', 'a.iso'))).toBe(false)
  })
  it('bloquea salir de la raíz, carpetas protegidas y no-ISOs', () => {
    const d = tmp('poxi-x-'); const out = tmp('poxi-out-')
    file(join(out, 'secreto.iso')); file(join(d, 'ventoy', 'a.iso')); file(join(d, 'nota.txt'))
    expect(() => deleteIso(d, '../' + out.split(/[\\/]/).pop() + '/secreto.iso')).toThrow()
    expect(() => deleteIso(d, 'ventoy/a.iso')).toThrow()
    expect(() => deleteIso(d, 'nota.txt')).toThrow()
    expect(existsSync(join(out, 'secreto.iso'))).toBe(true)
    expect(existsSync(join(d, 'nota.txt'))).toBe(true)
  })
})

describe('resolveVentoyRoot', () => {
  const disks = [
    { number: 1, name: 'A', sizeBytes: 1, letters: ['E'], hasVentoy: true },
    { number: 2, name: 'B', sizeBytes: 1, letters: ['F'], hasVentoy: false },
  ]
  it('acepta solo una letra de un USB con PoxiISO', () => {
    expect(resolveVentoyRoot(disks, 'E')).toBe('E:\\')
    expect(resolveVentoyRoot(disks, 'e')).toBe('E:\\')
  })
  it('rechaza USB sin PoxiISO, letras ajenas (C:) y basura', () => {
    for (const l of ['F', 'C', 'EE', '', '..', 'E:\\x']) expect(resolveVentoyRoot(disks, l)).toBeNull()
  })
})
