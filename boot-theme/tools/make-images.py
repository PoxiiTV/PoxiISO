"""Genera las imágenes del tema de arranque PoxiISO (fondo, paneles 9-slice, selección, scrollbar, iconos).

Uso: python boot-theme/tools/make-images.py <carpeta con Inter-Bold.ttf> [icono.png]
Salida: boot-theme/poxi/*.png
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "boot-theme" / "poxi"
TTF = Path(sys.argv[1])
ICON = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "build" / "icon.png"

CYAN, BLUE = (34, 211, 238), (59, 130, 246)
SS = 4  # supermuestreo para bordes suaves


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background(w=1920, h=1080):
    # degradado vertical + resplandores cian (abajo derecha) y azul (arriba izquierda), como las apps Poxi
    img = Image.new("RGB", (w, h))
    px = ImageDraw.Draw(img)
    for y in range(h):
        px.line([(0, y), (w, y)], fill=lerp((9, 12, 21), (13, 18, 32), y / h))
    glow = Image.new("RGB", (w, h), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([w * 0.55, h * 0.55, w * 1.25, h * 1.35], fill=(8, 62, 78))
    g.ellipse([-w * 0.25, -h * 0.35, w * 0.35, h * 0.30], fill=(16, 32, 74))
    glow = glow.filter(ImageFilter.GaussianBlur(170))
    from PIL import ImageChops
    img = ImageChops.add(img, glow)
    # rejilla de puntos muy tenue
    dots = ImageDraw.Draw(img, "RGBA")
    for y in range(40, h, 48):
        for x in range(40, w, 48):
            dots.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(255, 255, 255, 14))
    # cabecera: icono + wordmark
    icon = Image.open(ICON).convert("RGBA").resize((104, 104), Image.LANCZOS)
    f = ImageFont.truetype(str(TTF / "Inter-Bold.ttf"), 76)
    poxi_w = dots.textlength("Poxi", font=f)
    iso_w = dots.textlength("ISO", font=f)
    total = 104 + 26 + poxi_w + iso_w
    x0 = (w - total) / 2
    y0 = h * 0.075
    img.paste(icon, (round(x0), round(y0)), icon)
    tx = x0 + 104 + 26
    ty = y0 + 52 - f.getbbox("Poxi")[3] / 2 - f.getbbox("Poxi")[1] / 2
    d = ImageDraw.Draw(img)
    d.text((tx, ty), "Poxi", font=f, fill=(234, 241, 248))
    d.text((tx + poxi_w, ty), "ISO", font=f, fill=CYAN)
    img.save(OUT / "bg.png")


def nine_slice(prefix, radius, canvas_w, painter):
    """Dibuja un rectángulo redondeado grande y lo corta en los 9 trozos que pide GRUB (prefix_{nw,n,ne,w,c,e,sw,s,se}.png)."""
    r, mid = radius, 4
    W, H = 2 * r + canvas_w, 2 * r + mid
    big = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    painter(big, W * SS, H * SS, r * SS)
    img = big.resize((W, H), Image.LANCZOS)
    xs = [(0, r), (r, r + canvas_w), (r + canvas_w, W)]
    ys = [(0, r), (r, r + mid), (r + mid, H)]
    names = [["nw", "n", "ne"], ["w", "c", "e"], ["sw", "s", "se"]]
    for ri, (y0, y1) in enumerate(ys):
        for ci, (x0, x1) in enumerate(xs):
            img.crop((x0, y0, x1, y1)).save(OUT / f"{prefix}_{names[ri][ci]}.png")


def glass(img, w, h, r):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], r, fill=(255, 255, 255, 30))  # borde
    d.rounded_rectangle([SS, SS, w - 1 - SS, h - 1 - SS], r - SS, fill=(13, 19, 33, 214))  # cristal oscuro


def select(img, w, h, r):
    grad = Image.new("RGBA", (w, h))
    gd = ImageDraw.Draw(grad)
    for x in range(w):
        gd.line([(x, 0), (x, h)], fill=lerp(CYAN, BLUE, x / max(w - 1, 1)) + (255,))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    img.paste(grad, (0, 0), mask)


def scroll_frame(img, w, h, r):
    ImageDraw.Draw(img).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=(255, 255, 255, 18))


def scroll_thumb(img, w, h, r):
    ImageDraw.Draw(img).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=CYAN + (200,))


# Iconos del menú (icons/<clase>.png). Letra sobre baldosa con el color de cada sistema; sin logotipos de marca.
# Las clases las asigna "menu_class" de ventoy.json; vtoy* son las clases por defecto de Ventoy.
ICONS = {
    "windows": ("W", (0, 120, 212), (0, 162, 237)),
    "ubuntu": ("U", (233, 84, 32), (200, 60, 20)),
    "debian": ("D", (200, 20, 70), (150, 0, 48)),
    "mint": ("M", (135, 207, 62), (90, 160, 40)),
    "fedora": ("F", (81, 162, 218), (41, 65, 114)),
    "kali": ("K", (54, 123, 240), (30, 64, 175)),
    "arch": ("A", (23, 147, 209), (12, 100, 160)),
}
DEFAULT_CLASSES = ("vtoyiso", "vtoywim", "vtoyefi", "vtoyimg", "vtoyvhd", "vtoyvtoy")  # carpetas (vtoydir) sin icono


def tile(size, c1, c2):
    big = size * SS
    grad = Image.new("RGBA", (big, big))
    gd = ImageDraw.Draw(grad)
    for y in range(big):
        gd.line([(0, y), (big, y)], fill=lerp(c1, c2, y / (big - 1)) + (255,))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], round(big * 0.28), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def icons(size=32):
    d = OUT / "icons"
    d.mkdir(exist_ok=True)
    f = ImageFont.truetype(str(TTF / "Inter-Bold.ttf"), round(size * SS * 0.58))
    for name, (letter, c1, c2) in ICONS.items():
        img = tile(size, c1, c2)
        ImageDraw.Draw(img).text((size * SS / 2, size * SS / 2), letter, font=f, fill=(255, 255, 255), anchor="mm")
        img.resize((size, size), Image.LANCZOS).save(d / f"{name}.png")
    # genérico: disco sobre el degradado Poxi
    img = tile(size, CYAN, BLUE)
    g = ImageDraw.Draw(img)
    c, w = size * SS / 2, round(size * SS * 0.07)
    g.ellipse([c - size * SS * 0.31, c - size * SS * 0.31, c + size * SS * 0.31, c + size * SS * 0.31], outline=(3, 26, 36), width=w)
    g.ellipse([c - size * SS * 0.08, c - size * SS * 0.08, c + size * SS * 0.08, c + size * SS * 0.08], outline=(3, 26, 36), width=w)
    img = img.resize((size, size), Image.LANCZOS)
    for name in DEFAULT_CLASSES:
        img.save(d / f"{name}.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    background()
    nine_slice("menu", 22, 8, glass)
    nine_slice("select", 10, 64, select)
    # Fondo transparente para los elementos no seleccionados, con los mismos bordes que "select":
    # GRUB coloca el texto de cada elemento según el borde superior de su fondo; si no coinciden, el seleccionado salta.
    nine_slice("item", 10, 64, lambda img, w, h, r: None)
    # GRUB solo dibuja la barra si scrollbar_width cabe en los bordes (izq.+der.) del marco: 3+3 aquí
    nine_slice("scroll_frame", 3, 2, scroll_frame)
    nine_slice("scroll_thumb", 3, 2, scroll_thumb)
    icons()
    print("imágenes generadas en", OUT)
