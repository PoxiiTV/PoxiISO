import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTORUN, brandCommands, writeBrandFiles } from '../src/main/brand'

describe('brandCommands', () => {
  it('solo para una raíz de unidad X:\\ (nunca rutas sueltas)', () => {
    expect(brandCommands('C:\\Users\\x')).toEqual([])
    expect(brandCommands('E:')).toEqual([])
    expect(brandCommands("E:\\'; rm")).toEqual([])
  })
  it('oculta autorun.inf y ventoy, y pone la etiqueta PoxiISO a esa letra', () => {
    const c = brandCommands('e:\\')
    expect(c[0]).toEqual(['attrib', ['+h', '+s', 'E:\\autorun.inf']])
    expect(c[1]).toEqual(['attrib', ['+h', '+s', 'E:\\ventoy']])
    expect(c[2][1].at(-1)).toBe("Set-Volume -DriveLetter E -NewFileSystemLabel 'PoxiISO'")
  })
})

describe('writeBrandFiles', () => {
  it('copia el icono a ventoy/ y reescribe autorun.inf', () => {
    const root = mkdtempSync(join(tmpdir(), 'poxi-brand-'))
    mkdirSync(join(root, 'ventoy'))
    const ico = join(root, 'src.ico'); writeFileSync(ico, 'ICO')
    writeFileSync(join(root, 'autorun.inf'), 'viejo')
    expect(writeBrandFiles(root, ico)).toBe(true)
    expect(readFileSync(join(root, 'ventoy', 'poxiiso.ico'), 'utf8')).toBe('ICO')
    expect(readFileSync(join(root, 'autorun.inf'), 'utf8')).toBe(AUTORUN)
  })
  it('sin carpeta ventoy o sin icono no rompe', () => {
    const root = mkdtempSync(join(tmpdir(), 'poxi-brand-'))
    expect(writeBrandFiles(root, join(root, 'no.ico'))).toBe(false)
  })
})
