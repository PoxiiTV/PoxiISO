#!/bin/bash
# Genera las fuentes .pf2 del tema a partir de Inter (OFL). Se ejecuta en WSL/Linux:
#   wsl bash boot-theme/tools/make-fonts.sh <raiz-del-repo-en-/mnt/...> <carpeta-temporal-ttf>
# Requiere: grub2-common (grub-mkfont), python3-fonttools, python3-brotli
set -e
ROOT="$1"; TTF="$2"; mkdir -p "$TTF" "$ROOT/boot-theme/poxi/fonts"
python3 - "$ROOT" "$TTF" <<'PY'
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
root, ttf = sys.argv[1], sys.argv[2]
src = f"{root}/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"
for name, w in (("Regular", 400), ("SemiBold", 600), ("Bold", 700)):
    f = instancer.instantiateVariableFont(TTFont(src), {"wght": w})
    f.flavor = None
    # GRUB identifica la fuente por familia+estilo+tamaño: cada peso necesita familia propia
    for r in list(f["name"].names):
        if r.nameID in (16, 17, 25): f["name"].removeNames(nameID=r.nameID)
    f["name"].setName(f"Inter {name}", 1, 3, 1, 0x409)
    f["name"].setName("Regular", 2, 3, 1, 0x409)
    f["name"].setName(f"Inter {name} Regular", 4, 3, 1, 0x409)
    for pid, eid, lid in ((1, 0, 0),):
        f["name"].setName(f"Inter {name}", 1, pid, eid, lid); f["name"].setName("Regular", 2, pid, eid, lid)
    f.save(f"{ttf}/Inter-{name}.ttf")
PY
mk() { grub-mkfont -s "$3" -o "$ROOT/boot-theme/poxi/fonts/Inter-$1-$3.pf2" "$TTF/Inter-$2.ttf"; }
mk Regular Regular 16
mk Regular Regular 22
mk SemiBold SemiBold 22
mk Bold Bold 44
ls -l "$ROOT/boot-theme/poxi/fonts"
for f in "$ROOT"/boot-theme/poxi/fonts/*.pf2; do echo "$f: $(strings -n 6 "$f" | head -2 | tr '\n' '|')"; done
