import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { iconClass, previewItems, SAMPLE_ISOS } from '../src/main/theme'

const classes = JSON.parse(readFileSync('boot-theme/ventoy.json', 'utf8')).menu_class

describe('iconClass (como Ventoy)', () => {
  it('usa la primera clave contenida en el nombre, distinguiendo mayúsculas', () => {
    expect(iconClass('ubuntu-24.04.5-desktop-amd64.iso', classes)).toBe('ubuntu')
    expect(iconClass('Win11-IOT-LTSC-2024-Custom-Poxi.iso', classes)).toBe('windows')
    expect(iconClass('linuxmint-22.2-cinnamon-64bit.iso', classes)).toBe('mint')
    expect(iconClass('UBUNTU.iso', classes)).toBe('vtoyiso') // ninguna clave en mayúsculas
  })
  it('sin coincidencia, el icono de su tipo', () => {
    expect(iconClass('hirens.iso', classes)).toBe('vtoyiso')
    expect(iconClass('install.wim', classes)).toBe('vtoywim')
    expect(iconClass('disk.VHDX', classes)).toBe('vtoyvhd')
  })
  it('la clave tiene que ser más corta que el nombre (strstr con patlen < namelen)', () => {
    expect(iconClass('Win', [{ key: 'Win', class: 'windows' }])).toBe('vtoyiso')
  })
  it('cada clase usada tiene su icono en el tema', () => {
    for (const c of new Set(previewItems(SAMPLE_ISOS, classes).map(i => i.cls)))
      expect(() => readFileSync(`boot-theme/poxi/icons/${c}.png`)).not.toThrow()
  })
})

describe('previewItems', () => {
  it('orden alfabético sin distinguir mayúsculas', () => {
    expect(previewItems(['b.iso', 'A.iso', 'c.iso'], []).map(i => i.name)).toEqual(['A.iso', 'b.iso', 'c.iso'])
  })
})
