import { describe, it, expect } from 'vitest'
import { fileSystemOf, parseDisks, waitForDataRoot } from '../src/main/usb'

const one = { Number: 2, FriendlyName: 'SanDisk Ultra', Size: 32008618496, Letters: ['E'], FileSystems: ['exFAT'], Labels: ['VTOYEFI', 'Ventoy'], DataLabels: ['PoxiISO'] }

describe('parseDisks', () => {
  it('acepta un único objeto (PowerShell no lo envuelve en array)', () => {
    expect(parseDisks(JSON.stringify(one)))
      .toEqual([{ number: 2, name: 'SanDisk Ultra', sizeBytes: 32008618496, letters: ['E'], hasVentoy: true, fileSystems: ['exFAT'], labels: ['PoxiISO'] }])
  })
  it('ordena por número de disco (PowerShell no garantiza el orden)', () => {
    expect(parseDisks(JSON.stringify([{ ...one, Number: 5 }, one])).map(d => d.number)).toEqual([2, 5])
  })
  it('acepta array', () => {
    expect(parseDisks(JSON.stringify([one, { ...one, Number: 3, Labels: [] }]))).toHaveLength(2)
  })
  it('salida vacía = sin discos', () => {
    expect(parseDisks('')).toEqual([])
    expect(parseDisks('  \n')).toEqual([])
  })
  it('disco sin letra ni particiones sigue listándose', () => {
    const r = parseDisks(JSON.stringify({ Number: 4, FriendlyName: 'USB', Size: 8e9, Letters: null, Labels: null }))
    expect(r[0].letters).toEqual([])
    expect(r[0].hasVentoy).toBe(false)
  })
  it('detecta Ventoy solo por VTOYEFI', () => {
    expect(parseDisks(JSON.stringify({ ...one, Labels: ['Ventoy'] }))[0].hasVentoy).toBe(false)
  })
})

describe('waitForDataRoot', () => {
  const d = (letters: string[]) => ({ number: 2, name: 'X', sizeBytes: 1, letters, hasVentoy: true })
  it('espera hasta que Windows asigna letra y devuelve la raíz', async () => {
    let calls = 0, waits = 0
    const list = async () => (++calls < 3 ? [d([])] : [d(['f'])])
    expect(await waitForDataRoot(2, list, async () => { waits++ }, 10)).toBe('F:\\')
    expect(waits).toBe(2)
  })
  it('ignora otros discos y se rinde tras los intentos', async () => {
    const list = async () => [{ ...d(['G']), number: 9 }]
    expect(await waitForDataRoot(2, list, async () => {}, 3)).toBeNull()
  })
  it('no da por buena la letra hasta que el disco ya es PoxiISO (letra vieja de antes de formatear)', async () => {
    let n = 0
    const list = async () => [n++ < 2 ? { ...d(['E']), hasVentoy: false } : d(['E'])]
    expect(await waitForDataRoot(2, list, async () => {}, 5)).toBe('E:\\')
    expect(n).toBe(3)
  })
  it('se rinde al pasar el tiempo máximo aunque queden intentos (consultas lentas)', async () => {
    let calls = 0
    const slow = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return [d([])] }
    expect(await waitForDataRoot(2, slow, async () => {}, 1000, 80)).toBeNull()
    expect(calls).toBeLessThan(6)
  })
  it('un error al listar no rompe: reintenta', async () => {
    let n = 0
    const list = async () => { if (n++ < 1) throw new Error('ps'); return [d(['H'])] }
    expect(await waitForDataRoot(2, list, async () => {}, 5)).toBe('H:\\')
  })
})

describe('fileSystemOf', () => {
  const disks = [{ number: 2, name: 'X', sizeBytes: 1, letters: ['E', 'F'], hasVentoy: true, fileSystems: ['FAT32', 'NTFS'] }]
  it('devuelve el sistema de archivos de esa letra', () => {
    expect(fileSystemOf(disks, 'e')).toBe('FAT32')
    expect(fileSystemOf(disks, 'F')).toBe('NTFS')
  })
  it('null si no se conoce la letra o no hay dato', () => {
    expect(fileSystemOf(disks, 'Z')).toBeNull()
    expect(fileSystemOf([{ ...disks[0], fileSystems: undefined }], 'E')).toBeNull()
  })
})
