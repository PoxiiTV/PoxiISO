import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Json = Record<string, unknown>
type ControlItem = Record<string, string>
export type Lang = 'es' | 'en'

const MENU_LANG: Record<Lang, string> = { es: 'es_ES', en: 'en_US' }
const MENU_TITLE: Record<Lang, string> = { es: 'Elige qué quieres arrancar', en: 'Choose what to boot' }

/**
 * Fusiona la config base de PoxiISO con el ventoy.json que ya hubiera en el USB.
 * - Nunca borra claves del usuario.
 * - `control`: añade solo las claves que falten (si el usuario ya eligió idioma, se respeta).
 * - `theme`: se pone siempre en instalación; en actualización solo si no había uno.
 * - `menu_class` (iconos por sistema): solo si el usuario no tenía la suya.
 */
export function mergeConfig(existing: Json | null, base: Json, mode: 'install' | 'update'): Json {
  const out: Json = { ...(existing ?? {}) }
  const control: ControlItem[] = Array.isArray(out.control) ? [...(out.control as ControlItem[])] : []
  const have = new Set(control.flatMap(c => Object.keys(c)))
  for (const c of (base.control as ControlItem[] | undefined) ?? []) {
    if (!Object.keys(c).some(k => have.has(k))) control.push(c)
  }
  if (control.length) out.control = control
  if (base.theme && (mode === 'install' || !out.theme)) out.theme = base.theme
  if (base.menu_class && !out.menu_class) out.menu_class = base.menu_class
  return out
}

/**
 * Copia el tema y deja ventoy.json fusionado, con el menú en el idioma de la app.
 * Devuelve false si no se pudo (no es fatal para la instalación).
 */
export function applyTheme(driveRoot: string, themeSrc: string, mode: 'install' | 'update', lang: Lang = 'es'): boolean {
  try {
    const dest = join(driveRoot, 'ventoy')
    mkdirSync(join(dest, 'theme'), { recursive: true })
    const themeDir = join(dest, 'theme', 'poxi')
    rmSync(themeDir, { recursive: true, force: true })
    cpSync(join(themeSrc, 'poxi'), themeDir, { recursive: true })
    if (lang !== 'es') {
      const txt = join(themeDir, 'theme.txt')
      writeFileSync(txt, readFileSync(txt, 'utf8').replace(MENU_TITLE.es, MENU_TITLE[lang]))
    }

    const cfgPath = join(dest, 'ventoy.json')
    let existing: Json | null = null
    if (existsSync(cfgPath)) {
      try { existing = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^﻿/, '')) } catch { return false } // JSON del usuario ilegible: no lo tocamos
    }
    const base = JSON.parse(readFileSync(join(themeSrc, 'ventoy.json'), 'utf8')) as Json
    base.control = ((base.control as ControlItem[] | undefined) ?? [])
      .map(c => ('VTOY_MENU_LANGUAGE' in c ? { VTOY_MENU_LANGUAGE: MENU_LANG[lang] } : c))
    writeFileSync(cfgPath, JSON.stringify(mergeConfig(existing, base, mode), null, 2))
    return true
  } catch {
    return false
  }
}

export interface MenuClass { key?: string; parent?: string; dir?: string; class: string }
// Clase por defecto de cada tipo de imagen (Ventoy: g_menu_class en grub2/MOD_SRC/.../ventoy_cmd.c)
const TYPE_CLASS: Record<string, string> = { '.iso': 'vtoyiso', '.wim': 'vtoywim', '.efi': 'vtoyefi', '.img': 'vtoyimg', '.vhd': 'vtoyvhd', '.vhdx': 'vtoyvhd', '.vtoy': 'vtoyvtoy' }

/**
 * El icono que Ventoy pondrá a esa imagen en el menú (ventoy_plugin_get_menu_class): la primera `key` de menu_class
 * contenida en el nombre (distingue mayúsculas y tiene que ser más corta que el nombre); si no, la de su tipo.
 * Las reglas `parent` (por carpeta) no se usan en PoxiISO y aquí se ignoran.
 */
export function iconClass(name: string, classes: MenuClass[]): string {
  for (const c of classes) if (typeof c.key === 'string' && c.key.length < name.length && name.includes(c.key)) return c.class
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return TYPE_CLASS[ext] ?? 'vtoyiso'
}

/** Ejemplo para la vista previa cuando el USB aún no tiene ISOs (nombres reales de las descargas). */
export const SAMPLE_ISOS = [
  'Win11-IOT-LTSC-2024-Custom-Poxi.iso', 'Windows 10.iso', 'ubuntu-24.04.5-desktop-amd64.iso', 'debian-13.1.0-amd64-netinst.iso',
  'linuxmint-22.2-cinnamon-64bit.iso', 'Fedora-Workstation-Live-44-1.7.x86_64.iso', 'kali-linux-2026.3-installer-amd64.iso',
  'archlinux-2026.10.01-x86_64.iso', 'Hiren\'s.BootCD.PE.x64.iso',
]

/** Lista del menú como la enseña Ventoy por defecto: nombre del archivo, orden alfabético sin distinguir mayúsculas. */
export function previewItems(names: string[], classes: MenuClass[]): { name: string; cls: string }[] {
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(name => ({ name, cls: iconClass(name, classes) }))
}
