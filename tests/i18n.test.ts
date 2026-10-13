import { describe, it, expect } from 'vitest'
import { createT } from '../src/main/i18n'

const t = createT({ hola: 'Hola {name}', solo_es: 'Solo ES' }, { hola: 'Hello {name}', solo_en: 'Only EN' })

describe('t', () => {
  it('interpola variables', () => expect(t('hola', { name: 'Poxi' })).toBe('Hola Poxi'))
  it('cae a inglés si falta en español', () => expect(t('solo_en')).toBe('Only EN'))
  it('devuelve la clave si no existe en ninguno', () => expect(t('nada')).toBe('nada'))
})
