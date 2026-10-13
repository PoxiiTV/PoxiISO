import { describe, it, expect } from 'vitest'
import { driveScript, killStrayScript } from '../src/main/plugson'

describe('driveScript', () => {
  it('rechaza letra o PID no válidos (nunca se mete texto libre en PowerShell)', () => {
    expect(() => driveScript(0, 'E')).toThrow('BAD_INPUT')
    expect(() => driveScript(1.5, 'E')).toThrow('BAD_INPUT')
    expect(() => driveScript(42, "E'; rm")).toThrow('BAD_INPUT')
    expect(() => driveScript(42, '')).toThrow('BAD_INPUT')
  })
  it('busca la ventana de ese proceso y elige el USB por su letra', () => {
    const s = driveScript(4242, 'e')
    expect(s).toContain('[PoxiPlugson]::Dialog(4242)')
    expect(s).toContain("StartsWith('E:')")
    expect(s).toContain('ShowWindow($dlg, 0)') // oculta la ventanita de Ventoy
  })
})

describe('killStrayScript', () => {
  it('solo cierra el VentoyPlugson de nuestra ruta y escapa las comillas', () => {
    expect(killStrayScript("C:\\it's\\VentoyPlugson.exe")).toContain("$_.Path -eq 'C:\\it''s\\VentoyPlugson.exe'")
  })
})
