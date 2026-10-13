import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeConfig, applyTheme } from '../src/main/theme'

const base = {
  control: [{ VTOY_MENU_LANGUAGE: 'es_ES' }],
  theme: { file: '/ventoy/theme/poxi/theme.txt' },
}

describe('mergeConfig', () => {
  it('sin config previa usa la base', () => {
    expect(mergeConfig(null, base, 'install')).toEqual(base)
  })
  it('respeta claves del usuario y no pisa su idioma', () => {
    const user = { control: [{ VTOY_MENU_LANGUAGE: 'en_US' }, { VTOY_MENU_TIMEOUT: '5' }], auto_install: [{ image: '/x.iso' }] }
    const r = mergeConfig(user, base, 'install') as any
    expect(r.control).toEqual(user.control)
    expect(r.auto_install).toEqual(user.auto_install)
    expect(r.theme).toEqual(base.theme)
  })
  it('añade el idioma si el usuario tenía control sin idioma', () => {
    const r = mergeConfig({ control: [{ VTOY_MENU_TIMEOUT: '5' }] }, base, 'install') as any
    expect(r.control).toEqual([{ VTOY_MENU_TIMEOUT: '5' }, { VTOY_MENU_LANGUAGE: 'es_ES' }])
  })
  it('en actualización no cambia un tema ya elegido', () => {
    const mine = { file: '/ventoy/theme/otro/theme.txt' }
    expect((mergeConfig({ theme: mine }, base, 'update') as any).theme).toEqual(mine)
  })
  it('en actualización pone el tema si faltaba', () => {
    expect((mergeConfig({}, base, 'update') as any).theme).toEqual(base.theme)
  })
  it('añade los iconos (menu_class) solo si el usuario no tenía los suyos', () => {
    const b = { ...base, menu_class: [{ key: 'ubuntu', class: 'ubuntu' }] }
    expect((mergeConfig({}, b, 'update') as any).menu_class).toEqual(b.menu_class)
    const mine = [{ key: 'x', class: 'y' }]
    expect((mergeConfig({ menu_class: mine }, b, 'install') as any).menu_class).toEqual(mine)
  })
})

describe('applyTheme', () => {
  const mk = () => {
    const src = mkdtempSync(join(tmpdir(), 'poxi-src-'))
    mkdirSync(join(src, 'poxi', 'fonts'), { recursive: true })
    writeFileSync(join(src, 'poxi', 'theme.txt'), 'text = "Elige qué quieres arrancar"')
    writeFileSync(join(src, 'poxi', 'fonts', 'a.pf2'), 'f')
    writeFileSync(join(src, 'ventoy.json'), JSON.stringify(base))
    return { src, usb: mkdtempSync(join(tmpdir(), 'poxi-usb-')) }
  }
  it('copia el tema y escribe ventoy.json', () => {
    const { src, usb } = mk()
    expect(applyTheme(usb, src, 'install')).toBe(true)
    expect(existsSync(join(usb, 'ventoy', 'theme', 'poxi', 'fonts', 'a.pf2'))).toBe(true)
    expect(JSON.parse(readFileSync(join(usb, 'ventoy', 'ventoy.json'), 'utf8')).theme).toEqual(base.theme)
  })
  it('en inglés pone el menú en en_US y traduce el título del tema', () => {
    const { src, usb } = mk()
    expect(applyTheme(usb, src, 'install', 'en')).toBe(true)
    expect(JSON.parse(readFileSync(join(usb, 'ventoy', 'ventoy.json'), 'utf8')).control).toEqual([{ VTOY_MENU_LANGUAGE: 'en_US' }])
    expect(readFileSync(join(usb, 'ventoy', 'theme', 'poxi', 'theme.txt'), 'utf8')).toBe('text = "Choose what to boot"')
    expect(readFileSync(join(src, 'poxi', 'theme.txt'), 'utf8')).toContain('Elige') // el original no se toca
  })
  it('en español deja el título tal cual', () => {
    const { src, usb } = mk()
    applyTheme(usb, src, 'install')
    expect(readFileSync(join(usb, 'ventoy', 'theme', 'poxi', 'theme.txt'), 'utf8')).toContain('Elige qué quieres arrancar')
  })
  it('no toca un ventoy.json ilegible', () => {
    const { src, usb } = mk()
    mkdirSync(join(usb, 'ventoy'), { recursive: true })
    writeFileSync(join(usb, 'ventoy', 'ventoy.json'), '{ esto no es json')
    expect(applyTheme(usb, src, 'update')).toBe(false)
    expect(readFileSync(join(usb, 'ventoy', 'ventoy.json'), 'utf8')).toBe('{ esto no es json')
  })
  it('acepta un ventoy.json con BOM', () => {
    const { src, usb } = mk()
    mkdirSync(join(usb, 'ventoy'), { recursive: true })
    writeFileSync(join(usb, 'ventoy', 'ventoy.json'), '﻿' + JSON.stringify({ control: [{ VTOY_MENU_TIMEOUT: '3' }] }))
    expect(applyTheme(usb, src, 'update')).toBe(true)
    expect(JSON.parse(readFileSync(join(usb, 'ventoy', 'ventoy.json'), 'utf8')).control).toHaveLength(2)
  })
  it('devuelve false si el USB no existe, sin lanzar', () => {
    const { src, usb } = mk()
    writeFileSync(join(usb, 'archivo'), 'x') // un fichero donde debería haber carpeta: mkdir falla en cualquier SO
    expect(applyTheme(join(usb, 'archivo'), src, 'install')).toBe(false)
  })
})

describe('tema real del repo', () => {
  const cfg = JSON.parse(readFileSync('boot-theme/ventoy.json', 'utf8'))
  const txt = readFileSync('boot-theme/poxi/theme.txt', 'utf8')
  it('cada clase de menu_class tiene su icono', () => {
    for (const c of new Set<string>(cfg.menu_class.map((m: any) => m.class))) expect(existsSync(`boot-theme/poxi/icons/${c}.png`), c).toBe(true)
  })
  it('el título que se traduce existe en theme.txt', () => expect(txt).toContain('Elige qué quieres arrancar'))
  it('los elementos usan un fondo con los mismos bordes que la selección (si no, el seleccionado salta)', () => {
    expect(txt).toMatch(/item_pixmap_style = "item_\*\.png"/)
    for (const s of ['n', 'nw', 'ne', 'w', 'e', 's']) expect(existsSync(`boot-theme/poxi/item_${s}.png`)).toBe(true)
  })
})
