"""Genera el icono de PoxiISO con la misma P pixelada que el resto de la familia Poxi.

Uso: python scripts/make-icon.py <icono de otra app Poxi (512x512, p. ej. PoxiLauncher/resources/icon.png)>
Recolorea la P en cian, cambia el fondo y sustituye el accesorio por un disco pixelado.
Salida: build/icon.png (512), build/icon.ico (16-256), web/img/icon.png (192), web/favicon.png (64).
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

# colores de la plantilla (PoxiLauncher) -> PoxiISO
TPL_BG, TPL_FRONT, TPL_EXT1, TPL_EXT2 = (15, 26, 11), (157, 255, 63), (79, 154, 28), (43, 90, 15)
TPL_ACC = ((255, 210, 95), (184, 137, 28))  # accesorio amarillo y su relieve: se borran
BG, FRONT, EXT1, EXT2 = (8, 22, 28), (34, 211, 238), (19, 116, 131), (11, 66, 76)
DISC, DISC1, DISC2, GLINT = (234, 247, 252), (128, 160, 176), (66, 86, 100), (34, 211, 238)

# disco 7x7 de 10 px: '#' cara, '+' brillo; el hueco central deja ver el fondo
DISC_MAP = [
    "..###..",
    ".#####.",
    "##+####",
    "###.###",
    "#######",
    ".#####.",
    "..###..",
]
DISC_AT, CELL = (336, 352), 10  # donde estaba el accesorio de la plantilla (abajo a la derecha de la P)


def nearest(p, cols):
    return min(cols, key=lambda c: sum((a - b) ** 2 for a, b in zip(c, p)))


def main(tpl_path: str):
    tpl = Image.open(tpl_path).convert("RGBA").resize((512, 512), Image.NEAREST)
    keys = [TPL_BG, TPL_FRONT, TPL_EXT1, TPL_EXT2, *TPL_ACC]
    to = {TPL_BG: BG, TPL_FRONT: FRONT, TPL_EXT1: EXT1, TPL_EXT2: EXT2, TPL_ACC[0]: BG, TPL_ACC[1]: BG}
    out = Image.new("RGBA", tpl.size)
    px, src = out.load(), tpl.load()
    for y in range(512):
        for x in range(512):
            r, g, b, a = src[x, y]
            if a == 0: continue
            k = nearest((r, g, b), keys)
            # el relieve del accesorio comparte color con el de la P: solo se borra en la zona del accesorio
            if x >= DISC_AT[0] - 8 and y >= DISC_AT[1] - 8 and k in (TPL_EXT1, TPL_EXT2): k = TPL_BG
            px[x, y] = to[k] + (a,)
    for dx, col in ((16, DISC2), (8, DISC1), (0, None)):
        for j, row in enumerate(DISC_MAP):
            for i, ch in enumerate(row):
                if ch == ".": continue
                c = col or (GLINT if ch == "+" else DISC)
                x0, y0 = DISC_AT[0] + i * CELL + dx, DISC_AT[1] + j * CELL + dx
                for y in range(y0, y0 + CELL):
                    for x in range(x0, x0 + CELL): px[x, y] = c + (255,)
    out.save(ROOT / "build" / "icon.png")
    out.save(ROOT / "build" / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    out.resize((192, 192), Image.LANCZOS).save(ROOT / "web" / "img" / "icon.png")
    out.resize((64, 64), Image.LANCZOS).save(ROOT / "web" / "favicon.png")
    print("icono generado")


if __name__ == "__main__":
    main(sys.argv[1])
