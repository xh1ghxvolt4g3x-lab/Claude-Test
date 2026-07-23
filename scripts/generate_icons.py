#!/usr/bin/env python3
"""Generate PWA icons for PitchGun from a source logo image.

Auto-trims the white background, squares the artwork, then renders the icon
sizes the manifest references (plus the iOS apple-touch-icon). Rounded, padded
"any" icons on white; a full-bleed maskable icon with safe-zone padding.

Usage: python scripts/generate_icons.py [path-to-source-image]
Defaults to assets/logo-source.jpeg (committed copy of the uploaded logo).
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(__file__)
OUT_DIR = os.path.join(HERE, "..", "icons")
DEFAULT_SRC = os.path.join(HERE, "..", "assets", "logo-source.jpeg")


def trim_white(img, thresh=18, margin_frac=0.02):
    """Crop away the near-white border, then pad to a centered square."""
    rgb = img.convert("RGB")
    bg = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, bg).convert("L")
    mask = diff.point(lambda p: 255 if p > thresh else 0)
    bbox = mask.getbbox()
    if not bbox:
        return rgb
    l, t, r, b = bbox
    m = int(margin_frac * max(rgb.size))
    l = max(0, l - m); t = max(0, t - m)
    r = min(rgb.width, r + m); b = min(rgb.height, b + m)
    crop = rgb.crop((l, t, r, b))
    w, h = crop.size
    s = max(w, h)
    sq = Image.new("RGB", (s, s), (255, 255, 255))
    sq.paste(crop, ((s - w) // 2, (s - h) // 2))
    return sq


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def render(square, size, pad_frac, rounded):
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    inner = max(1, int(size * (1 - 2 * pad_frac)))
    logo = square.resize((inner, inner), Image.LANCZOS)
    canvas.paste(logo, ((size - inner) // 2, (size - inner) // 2))
    if rounded:
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(canvas, (0, 0), rounded_mask(size, int(size * 0.22)))
        return out
    return canvas


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    square = trim_white(Image.open(src))
    os.makedirs(OUT_DIR, exist_ok=True)
    render(square, 192, 0.05, True).save(os.path.join(OUT_DIR, "icon-192.png"))
    render(square, 512, 0.05, True).save(os.path.join(OUT_DIR, "icon-512.png"))
    render(square, 180, 0.06, False).save(os.path.join(OUT_DIR, "apple-touch-icon.png"))
    # maskable: full-bleed white with the logo inside the ~80% safe zone
    render(square, 512, 0.14, False).save(os.path.join(OUT_DIR, "icon-512-maskable.png"))
    print("icons written to", os.path.abspath(OUT_DIR))


if __name__ == "__main__":
    main()
