#!/usr/bin/env python3
"""Renders AppIcon.png and the LaunchLogo asset from the brand pinwheel.

The pinwheel is the logo as supplied, keyed off its original pale-blue ground
(see tools/pinwheel.png) so the blades keep their exact colours. Nothing here
redraws the mark — it only places it.

    python3 tools/make_icon.py
"""
import pathlib
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
ASSETS = ROOT / "CibaEnglish/Resources/Assets.xcassets"
MARK = Image.open(HERE / "pinwheel.png").convert("RGBA")

ICON_BG = (0xFF, 0xFD, 0xF7)   # warm white, sits with the app's 米白 background


def place(size: int, ratio: float, bg) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg)
    side = int(size * ratio)
    mark = MARK.resize((side, side), Image.LANCZOS)
    off = ((size - side) // 2, (size - side) // 2)
    canvas.alpha_composite(mark, off)
    return canvas


def main() -> None:
    icon = place(1024, 0.60, ICON_BG).convert("RGB")   # App Store icons carry no alpha
    icon_path = ASSETS / "AppIcon.appiconset/AppIcon.png"
    icon.save(icon_path)
    print("wrote", icon_path)

    launch = ASSETS / "LaunchLogo.imageset"
    launch.mkdir(parents=True, exist_ok=True)
    for scale in (1, 2, 3):
        img = MARK.resize((96 * scale, 96 * scale), Image.LANCZOS)
        img.save(launch / f"LaunchLogo@{scale}x.png")
    (launch / "Contents.json").write_text(
        '{\n  "images" : [\n'
        + ",\n".join(
            '    {\n      "filename" : "LaunchLogo@%dx.png",\n'
            '      "idiom" : "universal",\n      "scale" : "%dx"\n    }' % (s, s)
            for s in (1, 2, 3)
        )
        + '\n  ],\n  "info" : { "author" : "xcode", "version" : 1 }\n}\n'
    )
    print("wrote", launch)


if __name__ == "__main__":
    main()
