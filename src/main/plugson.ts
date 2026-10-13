import { execFile, spawn, type ChildProcess } from 'node:child_process'

export const PLUGSON_URL = 'http://127.0.0.1:24681/index.html' // puerto por defecto de VentoyPlugson.exe

// IDs de la ventanita de VentoyPlugson.exe (Plugson/vs/.../resource.h, comprobados en los recursos del exe 1.1.18)
const IDC_COMBO = 1002, IDC_START = 1006

const ps = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * PowerShell que maneja la ventanita de VentoyPlugson.exe sin enseñarla (está en inglés/chino y no se puede traducir):
 * la oculta, elige en su lista el USB por su letra y pulsa Start. Plugson abre solo el navegador con el configurador.
 * Escribe OK, NODIALOG (no apareció) o NODISK (Plugson no ve ese USB).
 */
export function driveScript(pid: number, letter: string): string {
  if (!Number.isInteger(pid) || pid <= 0 || !/^[A-Za-z]$/.test(letter)) throw new Error('BAD_INPUT')
  return `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class PoxiPlugson {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static IntPtr Dialog(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && GetDlgItem(h, ${IDC_COMBO}) != IntPtr.Zero) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$dlg = [IntPtr]::Zero
for ($i = 0; $i -lt 150 -and $dlg -eq [IntPtr]::Zero; $i++) {
  $dlg = [PoxiPlugson]::Dialog(${pid})
  if ($dlg -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
}
if ($dlg -eq [IntPtr]::Zero) { 'NODIALOG'; exit 2 }
[void][PoxiPlugson]::ShowWindow($dlg, 0)
$combo = [PoxiPlugson]::GetDlgItem($dlg, ${IDC_COMBO})
$n = [int][PoxiPlugson]::SendMessageW($combo, 0x146, [IntPtr]::Zero, [IntPtr]::Zero)
$sel = -1
for ($i = 0; $i -lt $n; $i++) {
  $len = [int][PoxiPlugson]::SendMessageW($combo, 0x149, [IntPtr]$i, [IntPtr]::Zero)
  $sb = New-Object System.Text.StringBuilder ($len + 2)
  [void][PoxiPlugson]::SendMessageW($combo, 0x148, [IntPtr]$i, $sb)
  if ($sb.ToString().ToUpper().StartsWith(${ps(letter.toUpperCase() + ':')})) { $sel = $i }
}
if ($sel -lt 0) { 'NODISK'; exit 3 }
[void][PoxiPlugson]::SendMessageW($combo, 0x14E, [IntPtr]$sel, [IntPtr]::Zero)
# WM_COMMAND con BN_CLICKED del botón Start; Post y no Send: si Plugson saca un aviso, no nos quedamos esperando
[void][PoxiPlugson]::PostMessageW($dlg, 0x111, [IntPtr]${IDC_START}, [PoxiPlugson]::GetDlgItem($dlg, ${IDC_START}))
'OK'
`
}

const runPs = (script: string, timeout = 30_000) => new Promise<string>(resolve => {
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout },
    (_err, stdout) => resolve(String(stdout ?? '').trim().split(/\r?\n/).pop() ?? ''))
})

/** Cierra cualquier VentoyPlugson.exe nuestro que siguiera abierto (por ejemplo, si la app se cerró de golpe). */
export function killStrayScript(exe: string): string {
  return `Get-Process VentoyPlugson -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${ps(exe)} } | Stop-Process -Force -ErrorAction SilentlyContinue`
}

async function serverUp(fetchFn: typeof fetch, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetchFn(PLUGSON_URL, { signal: AbortSignal.timeout(1500) })).ok) return true } catch { /* aún no */ }
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}

let child: ChildProcess | null = null

/** Abre Plugson para ese USB sin enseñar su ventana. Lanza NO_DIALOG, NO_DISK o NO_SERVER. */
export async function startPlugson(exe: string, cwd: string, letter: string, onExit: () => void): Promise<void> {
  stopPlugson()
  await runPs(killStrayScript(exe), 10_000)
  const p = spawn(exe, [], { cwd, windowsHide: true, detached: false, stdio: 'ignore' })
  child = p
  p.on('exit', () => { if (child === p) { child = null; onExit() } })
  p.on('error', () => { if (child === p) child = null })
  if (!p.pid) throw new Error('NO_DIALOG')
  const r = await runPs(driveScript(p.pid, letter))
  if (r !== 'OK') { stopPlugson(); throw new Error(r === 'NODISK' ? 'NO_DISK' : 'NO_DIALOG') }
  if (!(await serverUp(fetch, 25))) { stopPlugson(); throw new Error('NO_SERVER') }
}

export function stopPlugson(): void {
  const p = child
  child = null
  if (p && p.exitCode === null) p.kill() // TerminateProcess: Plugson guarda cada cambio al momento, no se pierde nada
}

export const plugsonRunning = () => child !== null
