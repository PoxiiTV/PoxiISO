import { execFile } from 'node:child_process'

export interface UsbDisk {
  number: number
  name: string
  sizeBytes: number
  letters: string[]
  hasVentoy: boolean
  /** Sistema de archivos de cada letra (mismo orden que `letters`), p. ej. exFAT, NTFS, FAT32. */
  fileSystems?: string[]
  /** Nombre (etiqueta) de cada letra, mismo orden que `letters`: "PoxiISO", "Ventoy"… */
  labels?: string[]
}

const arr = (v: unknown): string[] => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)])

export function parseDisks(json: string): UsbDisk[] {
  if (!json.trim()) return []
  const raw = JSON.parse(json)
  return (Array.isArray(raw) ? raw : [raw]).map(d => ({
    number: Number(d.Number),
    name: String(d.FriendlyName ?? 'USB'),
    sizeBytes: Number(d.Size ?? 0),
    letters: arr(d.Letters),
    hasVentoy: arr(d.Labels).includes('VTOYEFI'),
    fileSystems: arr(d.FileSystems),
    labels: arr(d.DataLabels),
  })).sort((a, b) => a.number - b.number) // orden estable: si no, la lista se repinta sin cambios reales
}

/** Devuelve `X:\` solo si la letra pertenece a un USB que ya tiene PoxiISO. Cualquier otra unidad (C:, discos duros...) es null. */
export function resolveVentoyRoot(disks: UsbDisk[], letter: string): string | null {
  if (!/^[A-Za-z]$/.test(letter)) return null
  const L = letter.toUpperCase()
  const d = disks.find(x => x.hasVentoy && x.letters.some(l => l.toUpperCase() === L))
  return d ? `${L}:\\` : null
}

/** Sistema de archivos de la letra en un USB con PoxiISO (exFAT, NTFS, FAT32…), o null si no se sabe. */
export function fileSystemOf(disks: UsbDisk[], letter: string): string | null {
  const L = letter.toUpperCase()
  for (const d of disks) {
    const i = d.letters.findIndex(l => l.toUpperCase() === L)
    if (i >= 0) return d.fileSystems?.[i] || null
  }
  return null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Windows tarda unos segundos en dar letra a la partición de datos recién creada: sondea hasta que aparezca (ya como PoxiISO).
 * Con tope de tiempo total: con el disco a medio montar, cada consulta a PowerShell puede tardar hasta su timeout (20 s)
 * y 30 intentos así dejaban la app parada minutos en el 100 %.
 */
export async function waitForDataRoot(
  phyDrive: number, list: () => Promise<UsbDisk[]> = listUsb, wait: (ms: number) => Promise<void> = sleep, tries = 30, maxMs = 45_000,
): Promise<string | null> {
  const end = Date.now() + maxMs
  for (let i = 0; i < tries && Date.now() < end; i++) {
    const d = (await list().catch(() => [] as UsbDisk[])).find(x => x.number === phyDrive)
    if (d?.hasVentoy && d.letters[0]) return `${d.letters[0].toUpperCase()}:\\`
    await wait(500)
  }
  return null
}

const PS = `
$o = Get-Disk | Where-Object BusType -eq 'USB' | ForEach-Object {
  $v = @(Get-Partition -DiskNumber $_.Number -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ L = $_.DriveLetter; Vol = ($_ | Get-Volume -ErrorAction SilentlyContinue) } })
  # la partición VTOYEFI (32 MB, arranque) nunca se ofrece: ahí no se copian ISOs ni el tema
  $data = @($v | Where-Object { $_.L -and $_.Vol.FileSystemLabel -ne 'VTOYEFI' })
  [pscustomobject]@{
    Number = $_.Number; FriendlyName = $_.FriendlyName; Size = $_.Size
    Letters = @($data | ForEach-Object { [string]$_.L })
    FileSystems = @($data | ForEach-Object { [string]$_.Vol.FileSystem })
    DataLabels = @($data | ForEach-Object { [string]$_.Vol.FileSystemLabel })
    Labels = @($v | ForEach-Object { $_.Vol.FileSystemLabel })
  }
}
if ($o) { ConvertTo-Json -InputObject @($o) -Compress }
`

export function listUsb(): Promise<UsbDisk[]> {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS],
      { windowsHide: true, timeout: 20_000 },
      (err, stdout) => (err ? reject(err) : resolve(parseDisks(stdout))))
  })
}
