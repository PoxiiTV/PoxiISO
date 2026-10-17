# Port a macOS

Estado del port de PoxiISO a macOS. Rama `mac`. Objetivo: usar PoxiISO desde un Mac para preparar USB que arrancan en PCs
(un Mac con Apple Silicon no arranca ISOs de PC; el USB es para otros equipos).

Ventoy no tiene instalador para macOS, así que el motor de instalación hay que reproducirlo (ver "Instalador").

## Hecho (H1, probado en Windows)

- El "volumen" de un USB se identifica en toda la app con una clave de texto opaca (`letters[]`, `isoSt.letter`…):
  en Windows la letra (`E`), en macOS el punto de montaje (`/Volumes/PoxiISO`).
- `src/main/usb.ts`: `volumeRoot(key, platform)` (clave → raíz de archivos, o `null` si no es válida; en macOS solo
  `/Volumes/<nombre>`), `volumeKey(root, platform)`, y `resolveVentoyRoot`, `fileSystemOf`, `waitForDataRoot` con parámetro
  `platform` (por defecto `process.platform`). Tests en `tests/usb.test.ts` para las dos plataformas.
- Renderer: `volName(key)` en `ui.ts` ("E:" en Windows, el nombre del volumen en macOS).
- `UsbDisk.number` es el número de disco: en macOS, `disk4` → `4`. `InstallOptions.phyDrive` sigue siendo ese número.

## Pendiente

### H2: instalador de macOS (`src/main/ventoy-mac.ts`)

Ahora `ventoy.ts` solo lanza `Ventoy2Disk.exe`. Hay que añadir un instalador propio con la misma interfaz que `runVentoy`
(progreso 0-100, errores `INSTALL_FAILED` / `TIMEOUT`) y elegirlo según `process.platform`.

Qué hace Ventoy al instalar (verificar contra las fuentes antes de dar nada por bueno):

- Particiones: datos (exFAT por defecto) desde 1 MiB hasta dejar al final 32 MiB para `VTOYEFI` (FAT, imagen
  `ventoy.disk.img`). MBR o GPT según la opción; en GPT, el MBR protector.
- `boot.img` en el sector 0 (primeros 446 bytes; en modo GPT se marca el byte de la posición 92) y `core.img` desde el sector 34.
- `ventoy.disk.img` se escribe tal cual en la partición `VTOYEFI`.
- Las imágenes (`boot.img`, `core.img.xz`, `ventoy.disk.img.xz`) están en el paquete Linux de Ventoy 1.1.18
  (`ventoy-1.1.18-linux.tar.gz`, carpeta `boot/` y `ventoy/`), y son iguales en todas las plataformas.
- Actualizar (`mode: 'update'`) solo reescribe `core.img` y la partición VTOYEFI, sin tocar los datos.

Diseño:

- Escritura sobre el dispositivo crudo (`/dev/rdiskN`) con permisos de administrador (`osascript` con
  `with administrator privileges`). Particionar con `diskutil` o escribir las tablas a mano; formatear con `newfs_exfat`.
- **Seguridad**: solo discos externos extraíbles; se valida en el proceso que escribe (no solo en la interfaz) que el
  dispositivo es uno de los USB listados y no un disco interno ni el de arranque.
- Probar siempre primero con un disco virtual: `hdiutil attach -nomount ram://…` o una imagen
  (`hdiutil create` + `hdiutil attach -imagekey diskimage-class=CRawDiskImage -nomount`), que se comporta como `/dev/diskN`.
  Nunca contra un disco real desde el código de desarrollo ni desde los tests (los tests usan imágenes en `os.tmpdir()`).
- Comprobar el resultado arrancándolo en QEMU (`qemu-system-x86_64 -drive file=…,format=raw` con UEFI y con BIOS).

### H3: lista de USB, etiqueta y empaquetado

- `listUsb()` en macOS: `diskutil list -plist external physical` + `diskutil info -plist <disco>` para cada disco y partición.
  Debe producir el mismo `UsbDisk` (`letters` = puntos de montaje de las particiones de datos, `hasVentoy` si existe
  una partición con la etiqueta `VTOYEFI`, `fileSystems`, `labels`). La partición VTOYEFI nunca se ofrece como destino.
- Etiqueta del volumen: `diskutil rename` (en `brand.ts`; en macOS no hay `autorun.inf` ni icono de unidad).
- Plugson (`plugson.ts`) depende de `VentoyPlugson.exe`: en macOS se oculta ese apartado de la interfaz en la primera versión.
- `scripts/fetch-engine.mjs` descarga el paquete de Windows; en macOS hay que bajar el de Linux (misma versión y SHA-256 fijado).
- `electron-builder.yml`: objetivo `dmg` (arm64 y x64), sin firmar. Vigilar el peso del `.dmg`.
- Exponer `process.platform` al renderer (preload) para ocultar lo que no aplica.

### H4: prueba con un USB real

Con un pendrive de prueba y un PC (o una VM) para arrancarlo. Pendiente de comprobar: Secure Boot, BIOS antigua (CSM),
Mac Intel y Apple Silicon, actualización de un USB creado en Windows y viceversa.

## Referencias

- Mactoy (Swift, MIT): https://github.com/cashcon57/mactoy
- ventoy-mac (GPL-3): https://github.com/fcjr/ventoy-mac
- Guía manual con `diskutil`/`dd`: https://glyph.sh/posts/setting-up-a-ventoy-multi-boot-usb-from-macos/
- Código de Ventoy (`Ventoy2Disk`, carpeta `Install` y `INSTALL/`): https://github.com/ventoy/Ventoy
