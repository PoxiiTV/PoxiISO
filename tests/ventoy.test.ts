import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArgs, parseDone, parsePercent, selectPlugson, validateInstall } from '../src/main/ventoy'

const base = { phyDrive: 2, gpt: true, secureBoot: true, fs: 'exFAT', reserveMB: 0 } as const

describe('buildArgs', () => {
  it('instala con GPT y exFAT', () => {
    expect(buildArgs({ ...base, mode: 'install' }))
      .toEqual(['VTOYCLI', '/I', '/PhyDrive:2', '/GPT', '/FS:exFAT'])
  })
  it('desactiva Secure Boot con /NOSB y reserva espacio', () => {
    expect(buildArgs({ ...base, mode: 'install', secureBoot: false, reserveMB: 2048 }))
      .toEqual(['VTOYCLI', '/I', '/PhyDrive:2', '/GPT', '/NOSB', '/FS:exFAT', '/R:2048'])
  })
  it('en actualización no pasa /GPT, /FS ni /R', () => {
    expect(buildArgs({ ...base, mode: 'update', reserveMB: 2048 }))
      .toEqual(['VTOYCLI', '/U', '/PhyDrive:2'])
  })
  it('en actualización respeta /NOSB', () => {
    expect(buildArgs({ ...base, mode: 'update', secureBoot: false }))
      .toEqual(['VTOYCLI', '/U', '/PhyDrive:2', '/NOSB'])
  })
  it('rechaza phyDrive inválido', () => {
    expect(() => buildArgs({ ...base, mode: 'install', phyDrive: -1 })).toThrow()
  })
})

describe('parseDone', () => {
  it('0 es ok, 1 es fallo, vacío es null', () => {
    expect(parseDone('0')).toBe('ok')
    expect(parseDone('1\n')).toBe('fail')
    expect(parseDone('')).toBeNull()
  })
})

describe('parsePercent', () => {
  it('acota a 0-100 y tolera basura', () => {
    expect(parsePercent('42')).toBe(42)
    expect(parsePercent('150')).toBe(100)
    expect(parsePercent('abc')).toBe(0)
  })
})

describe('selectPlugson', () => {
  const mk = () => {
    const eng = mkdtempSync(join(tmpdir(), 'poxi-eng-'))
    mkdirSync(join(eng, 'ventoy'))
    for (const n of ['es', 'en']) writeFileSync(join(eng, 'ventoy', `plugson.${n}.tar.xz`), n)
    writeFileSync(join(eng, 'ventoy', 'plugson.tar.xz'), 'es')
    return eng
  }
  const cur = (eng: string) => readFileSync(join(eng, 'ventoy', 'plugson.tar.xz'), 'utf8')
  it('pone el paquete del idioma pedido y vuelve al español', () => {
    const eng = mk()
    expect(selectPlugson(eng, 'en')).toBe(true); expect(cur(eng)).toBe('en')
    expect(selectPlugson(eng, 'es')).toBe(true); expect(cur(eng)).toBe('es')
  })
  it('un idioma raro cae en español (nunca rutas inventadas)', () => {
    const eng = mk()
    selectPlugson(eng, 'en')
    expect(selectPlugson(eng, '../../x')).toBe(true); expect(cur(eng)).toBe('es')
  })
  it('sin paquetes por idioma deja el que hubiera', () => {
    const eng = mkdtempSync(join(tmpdir(), 'poxi-eng-'))
    mkdirSync(join(eng, 'ventoy')); writeFileSync(join(eng, 'ventoy', 'plugson.tar.xz'), 'viejo')
    expect(selectPlugson(eng, 'en')).toBe(false); expect(cur(eng)).toBe('viejo')
  })
})

describe('validateInstall', () => {
  const usb = { number: 2, name: 'SanDisk', sizeBytes: 32e9, letters: ['E'], hasVentoy: false }
  const ok = { mode: 'install', phyDrive: 2, gpt: true, secureBoot: true, fs: 'exFAT', reserveMB: 0 }
  it('acepta un USB recién listado y normaliza', () => {
    expect(validateInstall({ ...ok, reserveMB: 10.7, lang: 'xx' }, [usb])).toEqual({ ...ok, reserveMB: 10, lang: 'es' })
  })
  it('rechaza un disco que no está en la lista de USB (p. ej. el disco del sistema)', () => {
    expect(() => validateInstall({ ...ok, phyDrive: 0 }, [usb])).toThrow('NOT_ALLOWED')
  })
  it('para actualizar exige que el USB ya tenga PoxiISO/Ventoy', () => {
    expect(() => validateInstall({ ...ok, mode: 'update' }, [usb])).toThrow('NOT_ALLOWED')
    expect(validateInstall({ ...ok, mode: 'update' }, [{ ...usb, hasVentoy: true }]).mode).toBe('update')
  })
  it('rechaza datos raros', () => {
    for (const bad of [null, 'x', { ...ok, mode: 'borrar' }, { ...ok, fs: 'ext4' }, { ...ok, phyDrive: '2' }, { ...ok, reserveMB: -1 }, { ...ok, reserveMB: NaN }])
      expect(() => validateInstall(bad, [usb])).toThrow('BAD_INPUT')
  })
})
