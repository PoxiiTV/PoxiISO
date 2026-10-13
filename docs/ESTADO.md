# Estado de PoxiISO

Documento vivo: refleja cómo está el proyecto **ahora**. El historial está en git.

## Qué es
Fork de Ventoy v1.1.18 con instalador Electron en español (estilo familia Poxi, acento cian `#22D3EE`). El motor Ventoy **no se modifica** ni se recompila.

## Fases
| Fase | Estado |
|---|---|
| 1 Instalador (asistente 3 pasos, stub nsis-web ~1 MB + portable) | Hecha. Probada con tests y capturas simuladas. |
| 2 Tema de arranque (oscuro cian, español/inglés, iconos, scroll) | Hecha. Probada en QEMU UEFI (1080p y 4:3); iconos y scroll probados con GRUB de Ubuntu en QEMU, no con el GRUB de Ventoy. Sin probar en BIOS clásica ni USB físico. |
| 3 Gestor de ISOs (arrastrar, listar, borrar) | Hecha. Probada con tests en carpetas temporales. |
| 4 Descargas (catálogo, reanudación, SHA-256) | Hecha. Probada contra servidor local; sin descargar ISOs reales. |
| 5 Plugson en español + estilo + ayuda; README/CHANGELOG/web | Hecha. Cero chino en las 14 páginas (comprobado con datos simulados). |

## Probado con hardware real (USB ORICO de 32 GB)
Instalar, nombre e icono PoxiISO en el USB, ir a ISOs tras instalar, copiar una ISO, abrir Plugson desde la app con pestañas en español.

## Pendiente de probar a mano
1. Arrancar un PC con el USB: tema, iconos y que la ISO arranque (UEFI y BIOS clásica).
2. Actualizar con ISOs dentro (que se conserven y no se quede en el 100 %).
3. Descargas grandes reales (Windows 10 / LTSC desde Google Drive y alguna Linux con SHA-256).
4. Que la ventanita de Plugson no llegue a verse ni un instante.

## Cosas a saber
- **Nunca** hacer pruebas contra discos o USBs desde el código de desarrollo: los tests usan solo `os.tmpdir()`.
- `npm run engine` descarga Ventoy y genera Plugson (necesita Python): `plugson.es.tar.xz` (traducido), `plugson.en.tar.xz` (original en inglés con estilo y ayuda de `plugson/en.json`) y `plugson.tar.xz` (copia del español). El exe solo lee `plugson.tar.xz`: al pulsar el botón, la app copia encima el del idioma elegido (`selectPlugson`). `plugson.orig.tar.xz` es el original y no se empaqueta.
- `plugson/build.py` **falla** si Plugson trae un texto en inglés sin traducir o una clave obsoleta (al actualizar Ventoy).
- `plugson.tar.xz` tiene que ir en **xz con CRC32** y tar ustar de ≤ 8 MB: el descompresor de `VentoyPlugson.exe` (xz-embedded sin CRC64) no lee el CRC64 por defecto de Python y el exe sale con *Internal error, the program will exit!*. `build.py` lo comprueba al generar (`check_like_plugson`).
- Vista previa del arranque (`src/renderer/preview.ts`): lienzo de 1920×1080 con las imágenes de `boot-theme/poxi` (se copian a `dist/renderer/boot` en `copy-assets.mjs`) y las medidas de `theme.txt`, cuadradas contra la captura real de QEMU. Si se toca `theme.txt`, hay que tocar también `PV` en ese archivo. Los iconos salen de `iconClass` (`theme.ts`), que copia `ventoy_plugin_get_menu_class`, con el `menu_class` del propio USB si lo tiene.
- Plugson (`src/main/plugson.ts`): `VentoyPlugson.exe` se lanza oculto y un PowerShell (`driveScript`) maneja su ventanita en inglés/chino: la oculta, elige el USB por letra en la lista (ID 1002) y pulsa *Start* (ID 1006). IDs sacados de `resource.h` y comprobados en los recursos del exe 1.1.18; probado contra una ventana falsa, no con el exe real. Si se actualiza Ventoy, revisar esos IDs. Plugson abre el navegador por su cuenta (no se puede evitar sin tocar su código). En Plugson, las pestañas `control_legacy`… se muestran como «Solo BIOS»… con aviso cuando no tienen datos (ahí se ven los valores por defecto de Ventoy, p. ej. `en_US`).
- Tras instalar o actualizar, `brandDrive` deja la unidad como **PoxiISO**: etiqueta con `Set-Volume`, `autorun.inf` con icono (`ventoy\poxiiso.ico`) y la carpeta `ventoy` y `autorun.inf` ocultas (+h +s). La carpeta no se puede renombrar porque el motor busca `/ventoy/ventoy.json` por nombre. Windows guarda en caché el icono de la unidad: puede no verse hasta volver a conectar el USB.
- Catálogo de descargas: `data/isos.json`. La app intenta leer `raw.githubusercontent.com/poxiitv/PoxiISO/main/data/isos.json` y, si no existe o falla, usa el incluido. Mint está fijado a `22.3` y Fedora a `44` (al salir una versión nueva hay que cambiar sus URLs).
- Windows 10 y LTSC no publican firma, así que no se pueden verificar.
- Catálogo: 66 entradas en 6 categorías (`windows`, `linux`, `gaming`, `tools`, `server`, `other`). `featured: true` (Ubuntu, Debian, Kali) sale arriba junto a Windows; el resto, en *Más sistemas* con buscador. Se comprueba de una vez con `validateCatalog` + `resolveEntry` contra los servidores reales (solo bajan las sumas, nunca las ISOs).
- **Versión fija, revisar al salir versiones nuevas:** Mint MATE/Xfce, Zorin, Pop!_OS (×2), Fedora KDE/Server, openSUSE Leap, Manjaro (×3), EndeavourOS, MX, Linux Lite, Deepin, Solus, antiX, Q4OS, Parrot, CachyOS, **Nobara (sus ISOs con fecha se sustituyen a menudo)**, ChimeraOS, Rescuezilla, GParted, Clonezilla, SystemRescue, Super Grub2, ShredOS, TrueNAS, openmediavault, FreeBSD, Haiku, Bliss OS, Android-x86. Hiren's y Boot-Repair-Disk tienen URL sin versión pero hash fijo: si el proyecto reconstruye la ISO, la verificación falla y hay que poner el hash nuevo.
- Sin SHA-256 oficial (se descargan sin verificar): Windows 10 y LTSC, openSUSE Leap y EndeavourOS (solo sha512), Q4OS (md5), Peppermint y Garuda (`latest.iso`).
- `parseSums` se queda con la **primera** línea de cada nombre (GParted y Clonezilla traen detrás un bloque BLAKE3 de 64 hex) y quita `./`. `pickLatest` compara sin la extensión para que `-r2` gane a la ISO base.
- El servidor de Hiren's devuelve 403 a un User-Agent de navegador: las descargas usan el `fetch` de Node (sin UA de navegador).
- Idioma: la app usa `i18n/es.json` o `en.json` (se elige en Ajustes y se guarda en el navegador interno). El catálogo trae `en: { name, desc }` por entrada.
- Menú de arranque: los iconos salen de `menu_class` en `boot-theme/ventoy.json` (Ventoy busca el texto dentro del nombre del archivo, **distingue mayúsculas**, gana la primera coincidencia) y de `boot-theme/poxi/icons/<clase>.png`. `make-images.py` genera fondo, paneles, scroll e iconos.
- GRUB descoloca el elemento seleccionado si su fondo y el de los demás tienen bordes distintos: por eso existe `item_*.png` (transparente, mismas medidas que `select_*.png`).
- Seguridad al instalar: el proceso principal vuelve a listar los USB justo antes y rechaza cualquier disco que no esté en esa lista (`validateInstall`); además Ventoy rechaza por su cuenta los discos no USB al instalar. La partición VTOYEFI nunca se ofrece como destino.
- FAT32: las ISOs de más de 4 GB se omiten con aviso (`TOO_BIG`) en vez de fallar a mitad.
- El portable pide administrador al abrirse (`portable.requestExecutionLevel: admin`): sin eso el lanzador no puede abrir la app, que exige admin.
- Web del proyecto: `web/index.html` (estática, en español).

## Ideas futuras
Firma de código.
