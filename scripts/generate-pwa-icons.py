#!/usr/bin/env python3
"""Generate the PWA icon set for apps/web from the site palette.

Draws the Route Doctor mark — a payment route of three nodes where the middle
hop carries a medical cross — at 4x supersampling, then downscales.

Requires Pillow: pip install pillow

Usage: python3 scripts/generate-pwa-icons.py
Outputs to apps/web/public/icons/.
"""
from pathlib import Path
from PIL import Image, ImageDraw

NAVY = (13, 27, 42, 255)      # #0d1b2a site background
PANEL = (19, 38, 59, 255)     # #13263b panel
BLUE = (52, 152, 219, 255)    # #3498db accent
GREEN = (46, 204, 113, 255)   # #2ecc71 healthy
WHITE = (230, 237, 243, 255)  # #e6edf3 text

OUT = Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "icons"


def draw_mark(size: int, pad_ratio: float, transparent_bg: bool) -> Image.Image:
    """Render the mark at `size` with content inset by pad_ratio per side."""
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if transparent_bg:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 5, fill=NAVY, outline=PANEL, width=s // 64)
    else:
        d.rectangle([0, 0, s, s], fill=NAVY)

    pad = s * pad_ratio
    span = s - 2 * pad
    # Route path: bottom-left node -> centre node -> top-right node.
    p1 = (pad + span * 0.10, pad + span * 0.85)
    p2 = (pad + span * 0.50, pad + span * 0.45)
    p3 = (pad + span * 0.90, pad + span * 0.15)
    lw = max(2, int(s * 0.035))
    d.line([p1, p2], fill=BLUE, width=lw)
    d.line([p2, p3], fill=BLUE, width=lw)

    r_end = s * 0.075
    r_mid = s * 0.16
    for p in (p1, p3):
        d.ellipse([p[0] - r_end, p[1] - r_end, p[0] + r_end, p[1] + r_end], fill=BLUE)

    d.ellipse([p2[0] - r_mid, p2[1] - r_mid, p2[0] + r_mid, p2[1] + r_mid], fill=GREEN, outline=NAVY, width=lw // 2)
    # Medical cross on the healthy hop.
    cw = r_mid * 0.38
    cl = r_mid * 1.05
    d.rectangle([p2[0] - cw / 2, p2[1] - cl / 2, p2[0] + cw / 2, p2[1] + cl / 2], fill=WHITE)
    d.rectangle([p2[0] - cl / 2, p2[1] - cw / 2, p2[0] + cl / 2, p2[1] + cw / 2], fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Standard icons: rounded tile, modest padding.
    for size in (64, 192, 512):
        draw_mark(size, 0.16, transparent_bg=True).save(OUT / f"icon-{size}.png")
    # Maskable: full-bleed background, content inside the 80% safe zone.
    draw_mark(512, 0.24, transparent_bg=False).save(OUT / "icon-maskable-512.png")
    # Apple touch icon: full-bleed (iOS applies its own corner radius).
    draw_mark(180, 0.16, transparent_bg=False).save(OUT / "apple-touch-icon.png")
    for f in sorted(OUT.iterdir()):
        print(f"wrote {f.relative_to(OUT.parent.parent)} ({f.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
