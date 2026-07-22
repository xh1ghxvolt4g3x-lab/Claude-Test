#!/usr/bin/env python3
"""Generate PWA icons for the PitchGun softball pitch-speed app.

Draws a softball (optic-yellow ball with red seams) over a rounded navy/teal
background, plus a small speed streak. Renders at high resolution and downsamples
for crisp anti-aliased edges. Produces the icon sizes referenced by the manifest
and the iOS home-screen apple-touch-icon.
"""
import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
SS = 4  # supersampling factor for anti-aliasing

NAVY = (11, 22, 40)
TEAL = (18, 143, 128)
BALL = (223, 240, 70)      # optic yellow-green
BALL_SHADOW = (176, 196, 40)
SEAM = (214, 61, 43)       # softball red seam


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_seam(draw, cx, cy, r, start_deg, end_deg, bulge, width):
    """Draw one curved softball seam as a series of short segments."""
    pts = []
    steps = 60
    for i in range(steps + 1):
        t = i / steps
        ang = math.radians(start_deg + (end_deg - start_deg) * t)
        # arc offset from the ball center, pushed toward one side (bulge)
        rr = r * (0.62 + bulge * math.sin(math.pi * t))
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    draw.line(pts, fill=SEAM, width=width, joint="curve")
    # stitch marks perpendicular to the seam
    for i in range(4, steps - 3, 5):
        x, y = pts[i]
        px, py = pts[i - 1]
        dx, dy = x - px, y - py
        n = math.hypot(dx, dy) or 1
        ox, oy = -dy / n, dx / n
        s = width * 1.3
        draw.line([(x - ox * s, y - oy * s), (x + ox * s, y + oy * s)],
                  fill=SEAM, width=max(2, width // 2))


def render(size):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # vertical gradient background
    bg = Image.new("RGB", (1, S))
    for y in range(S):
        bg.putpixel((0, y), lerp(NAVY, TEAL, y / S))
    bg = bg.resize((S, S))
    img.paste(bg, (0, 0))

    # speed streak behind the ball
    for k in range(6):
        alpha = int(70 - k * 10)
        off = int(S * 0.05 * k)
        y = int(S * 0.5)
        draw.line([(S * 0.10 - off, y + off * 0.3),
                   (S * 0.52 - off, y + off * 0.3)],
                  fill=(255, 255, 255, max(alpha, 0)), width=int(S * 0.012))

    # softball
    cx, cy, r = S * 0.56, S * 0.5, S * 0.30
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BALL)
    # subtle shading crescent
    draw.ellipse([cx - r * 0.95, cy - r * 0.6, cx + r * 1.05, cy + r * 1.1],
                 fill=None, outline=None)
    sw = int(S * 0.016)
    draw_seam(draw, cx, cy, r, -58, 58, 0.18, sw)
    draw_seam(draw, cx, cy, r, 122, 238, 0.18, sw)

    # apply rounded corners
    img = img.resize((size, size), Image.LANCZOS)
    mask = rounded_mask(size, radius=int(size * 0.22))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def render_maskable(size):
    """Full-bleed version with safe-zone padding for Android maskable icons."""
    S = size * SS
    img = Image.new("RGB", (S, S), NAVY)
    for y in range(S):
        ImageDraw.Draw(img).line([(0, y), (S, y)], fill=lerp(NAVY, TEAL, y / S))
    draw = ImageDraw.Draw(img)
    cx, cy, r = S * 0.5, S * 0.5, S * 0.24
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BALL)
    sw = int(S * 0.016)
    draw_seam(draw, cx, cy, r, -58, 58, 0.18, sw)
    draw_seam(draw, cx, cy, r, 122, 238, 0.18, sw)
    return img.resize((size, size), Image.LANCZOS).convert("RGBA")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    render(192).save(os.path.join(OUT_DIR, "icon-192.png"))
    render(512).save(os.path.join(OUT_DIR, "icon-512.png"))
    render(180).save(os.path.join(OUT_DIR, "apple-touch-icon.png"))
    render_maskable(512).save(os.path.join(OUT_DIR, "icon-512-maskable.png"))
    print("icons written to", os.path.abspath(OUT_DIR))


if __name__ == "__main__":
    main()
