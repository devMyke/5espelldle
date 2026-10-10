"""Builds the link-preview image (og-image.png) from the Tavern app art.

The favicons are not made here: they are copied from the Tavern project.
Needs Pillow, the Tavern art (tavern/assets/TavernApp.png) and a Cinzel TTF
(the site's title font):

    python tools/build_og_image.py path/to/TavernApp.png path/to/Cinzel.ttf
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent

NIGHT = (19, 26, 46)       # --night
PARCHMENT = (237, 227, 204)  # --parchment
MUTED = (154, 163, 184)    # --muted
GOLD = (217, 169, 63)      # --gold


def font(path, size, weight):
    f = ImageFont.truetype(str(path), size)
    f.set_variation_by_axes([weight])
    return f


def cut_out(art):
    """Removes the black backdrop by flood-filling it from the corners, so
    dark outlines inside the art stay opaque."""
    art = art.convert("RGB")
    lum = art.convert("L").point(lambda v: 255 if v > 24 else 0)
    w, h = lum.size
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if lum.getpixel(corner) == 0:
            ImageDraw.floodfill(lum, corner, 128)
    alpha = lum.point(lambda v: 0 if v == 128 else 255)
    # Grow by a pixel and soften, so the dark outline isn't clipped.
    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = art.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(alpha.getbbox())


def og_image(art, cinzel):
    w, h = 1200, 630
    im = Image.new("RGBA", (w, h), NIGHT + (255,))

    # Soft gold glow behind the art.
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((50, 85, 510, 545), fill=GOLD + (60,))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(60)))

    size = 470
    art = art.resize((size, round(art.height * size / art.width)), Image.LANCZOS)
    im.alpha_composite(art, (45, (h - art.height) // 2))

    d = ImageDraw.Draw(im)
    x = 560
    d.text((x, 170), "5eSpellDLE", font=font(cinzel, 88, 800), fill=GOLD)
    d.text((x, 300), "Guess the daily", font=font(cinzel, 50, 600), fill=PARCHMENT)
    d.text((x, 362), "D&D 5e spell", font=font(cinzel, 50, 600), fill=PARCHMENT)
    d.line((x, 450, x + 560, 450), fill=GOLD + (120,), width=2)
    body = ImageFont.truetype("segoeui.ttf", 30) if sys.platform == "win32" \
        else font(cinzel, 26, 400)
    d.text((x, 470), "Easy · Medium · Hard · Grand Magus · BG3",
           font=body, fill=MUTED)
    return im.convert("RGB")


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    art = cut_out(Image.open(sys.argv[1]))
    og_image(art, Path(sys.argv[2])).save(ROOT / "og-image.png", optimize=True)
    print("Wrote og-image.png")


if __name__ == "__main__":
    main()
