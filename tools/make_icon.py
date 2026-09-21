#!/usr/bin/env python3
"""Builds the app icon assets from the designed artwork.

Source of truth: src/assets/icon-designs/icon-source.png
(a 1080x1080 full-bleed render: clapperboard + play button + open book).

Outputs into src/assets/:
    icon.png           1024x1024, no alpha (iOS / store icon)
    adaptive-icon.png  1024x1024 RGBA foreground, artwork inset to Android's
                       66% safe zone, transparent around it (the surrounding
                       colour comes from app.json backgroundColor)
    favicon.png        64x64 for the web build

    python3 tools/make_icon.py
"""
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src" / "assets"
SOURCE = ASSETS / "icon-designs" / "icon-source.png"

ICON_SIZE = 1024
FOREGROUND_RATIO = 0.66   # Android adaptive icon: art must sit inside 66%


def load_source() -> Image.Image:
    img = Image.open(SOURCE).convert("RGB")
    side = min(img.size)
    if img.width != img.height:                      # keep the artwork square
        off = ((img.width - side) // 2, (img.height - side) // 2)
        img = img.crop((off[0], off[1], off[0] + side, off[1] + side))
    return img


def main() -> None:
    src = load_source()

    icon = src.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    icon.save(ASSETS / "icon.png")
    print("wrote", ASSETS / "icon.png")

    side = int(ICON_SIZE * FOREGROUND_RATIO)
    fg = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    art = src.resize((side, side), Image.LANCZOS).convert("RGBA")
    offset = (ICON_SIZE - side) // 2
    fg.alpha_composite(art, (offset, offset))
    fg.save(ASSETS / "adaptive-icon.png")
    print("wrote", ASSETS / "adaptive-icon.png")

    src.resize((64, 64), Image.LANCZOS).save(ASSETS / "favicon.png")
    print("wrote", ASSETS / "favicon.png")


if __name__ == "__main__":
    main()
