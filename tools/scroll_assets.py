"""
Turns the raw generated artwork for a themed scroll into web-ready pieces.

  python tools/scroll_assets.py

Reads img/raw/<school>/ and writes img/<school>/:
  roll-top.webp, roll-bottom.webp  just the rolled paper and its end caps
  middle.webp                      the sheet, blended so it repeats top to bottom
  sigil.webp                       decal drawn on the paper behind the game
  sigil-hole.webp                  (optional) mask of a hole burnt through the sigil,
                                   used to cut the same hole in the sheet underneath
The crop boxes below were measured from the raw images; if you replace a raw
image, re-measure them (the alpha channel shows where the artwork is). The
border-image slice numbers in style.css are in output pixels: raw slice x scale.

Roller crop boxes frame just the roller. Any glow or smoke beyond its outer
edge (above the top roller, below the bottom one) is kept as well, faded out
towards the image edge, and the "ext" this prints goes into style.css as
--roll-top-ext / --roll-bottom-ext so it's drawn outside the roller's box.
"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

SCHOOLS = {
    "evocation": {
        "roll-top":    ("ChatGPT Image Sep 27, 2026, 06_34_31 PM.png", (0, 70, 2172, 338)),
        "roll-bottom": ("c6b118b9-63c0-407e-989b-9e163a84210f.png", (0, 396, 2172, 644)),
        "middle":      ("284ae64e-96ec-46e9-b84e-22f87325b943.png", (0, 78, 1672, 882)),
        "sigil":       ("cd2a177e-2303-4776-8397-5097f804e20d.png", None),
        "middle_blend": 140,   # px of overlap used to hide the repeat seam
        "sigil_hole_seed": (520, 600),   # a raw-image pixel inside the sigil's transparent hole
        # output heights/widths: about twice their on-screen size, so they stay
        # crisp on high-density screens without shipping the full raw files
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 930), "sigil": ("w", 500)},
    },
    "illusion": {
        "roll-top":    ("ChatGPT Image Sep 30, 2026, 06_37_08 PM.png", (0, 60, 2172, 330)),
        "roll-bottom": ("ChatGPT Image Sep 30, 2026, 06_37_11 PM.png", (0, 350, 2172, 620)),
        "middle":      ("ChatGPT Image Sep 30, 2026, 06_37_17 PM.png", (0, 84, 1672, 866)),
        "sigil":       ("ChatGPT Image Sep 30, 2026, 06_37_21 PM.png", None),
        "middle_blend": 140,
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 684), "sigil": ("w", 500)},
    },
    "abjuration": {
        "roll-top":    ("ChatGPT Image Oct 3, 2026, 12_55_35 PM.png", (0, 46, 1536, 232)),
        "roll-bottom": ("ChatGPT Image Oct 3, 2026, 12_55_30 PM.png", (0, 766, 1536, 962)),
        # cropped between the big rune circles at the top and bottom, which ghost when blended
        "middle":      ("ChatGPT Image Oct 3, 2026, 12_55_25 PM.png", (0, 170, 1672, 770)),
        "sigil":       ("ChatGPT Image Oct 3, 2026, 12_55_19 PM.png", None),
        "middle_blend": 140,
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 836), "sigil": ("w", 500)},
    },
    "divination": {
        "roll-top":    ("ChatGPT Image Oct 3, 2026, 01_36_42 PM.png", (0, 78, 1536, 278)),
        "roll-bottom": ("ChatGPT Image Oct 3, 2026, 01_36_36 PM.png", (0, 760, 1536, 950)),
        # no separate sheet image: cut from the stretch of sheet hanging below the top roll
        "middle":      ("ChatGPT Image Oct 3, 2026, 01_36_42 PM.png", (40, 370, 1496, 830)),
        "sigil":       ("ChatGPT Image Oct 3, 2026, 01_36_31 PM.png", None),
        "middle_blend": 120,
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 728), "sigil": ("w", 500)},
    },
    "enchantment": {
        "roll-top":    ("ChatGPT Image Oct 3, 2026, 01_58_22 PM.png", (0, 55, 1536, 250)),
        "roll-bottom": ("ChatGPT Image Oct 3, 2026, 01_58_18 PM.png", (0, 722, 1536, 935)),
        # no separate sheet image: cut from the sheet above the bottom roll, where the smoke waves repeat evenly
        "middle":      ("ChatGPT Image Oct 3, 2026, 01_58_18 PM.png", (40, 120, 1496, 700)),
        "sigil":       ("ChatGPT Image Oct 3, 2026, 01_58_14 PM.png", None),
        "middle_blend": 120,
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 728), "sigil": ("w", 500)},
    },
    # The sheets below are cut to a whole number of repeats of their border
    # motif (plus the blend), so the pattern lines up across the seam.
    "conjuration": {
        "roll-top":    ("ChatGPT Image Oct 3, 2026, 02_07_41 PM.png", (0, 70, 1536, 250)),
        "roll-bottom": ("ChatGPT Image Oct 3, 2026, 02_07_36 PM.png", (0, 720, 1536, 900)),
        "middle":      ("ChatGPT Image Oct 3, 2026, 02_07_36 PM.png", (40, 150, 1496, 560)),
        "sigil":       ("ChatGPT Image Oct 3, 2026, 02_07_31 PM.png", None),
        "middle_blend": 120,
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 728), "sigil": ("w", 500)},
    },
    "necromancy": {
        "roll-top":    ("ChatGPT Image Oct 3, 2026, 02_28_12 PM.png", (0, 45, 1536, 215)),
        "roll-bottom": ("ChatGPT Image Oct 3, 2026, 02_28_05 PM.png", (0, 755, 1536, 935)),
        "middle":      ("ChatGPT Image Oct 3, 2026, 02_28_12 PM.png", (40, 380, 1496, 815)),
        "sigil":       ("ChatGPT Image Oct 3, 2026, 02_28_00 PM.png", None),
        "middle_blend": 120,
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 728), "sigil": ("w", 500)},
    },
    "transmutation": {
        "roll-top":    ("ChatGPT Image Oct 3, 2026, 02_58_44 PM.png", (0, 20, 1536, 240)),
        "roll-bottom": ("ChatGPT Image Oct 3, 2026, 02_58_49 PM.png", (0, 745, 1536, 950)),
        "middle":      ("ChatGPT Image Oct 3, 2026, 02_58_44 PM.png", (40, 330, 1496, 820)),
        "sigil":       ("ChatGPT Image Oct 3, 2026, 03_00_04 PM.png", None),
        "middle_blend": 120,
        "sizes": {"roll-top": ("h", 120), "roll-bottom": ("h", 120), "middle": ("w", 728), "sigil": ("w", 500)},
    },
}


def seamless_vertical(im, band):
    """Cross-fade the bottom `band` rows into the top ones so the image tiles vertically."""
    a = np.asarray(im).astype(np.float32) / 255.0
    rgb, alpha = a[..., :3] * a[..., 3:], a[..., 3:]          # premultiply so edges don't halo
    h = a.shape[0]
    top, bottom = slice(0, band), slice(h - band, h)
    t = np.linspace(0, 1, band, dtype=np.float32)[:, None, None]   # 0 = all bottom, 1 = all top
    rgb[top] = rgb[bottom] * (1 - t) + rgb[top] * t
    alpha[top] = alpha[bottom] * (1 - t) + alpha[top] * t
    rgb, alpha = rgb[: h - band], alpha[: h - band]
    out = np.concatenate([np.where(alpha > 0, rgb / np.maximum(alpha, 1e-6), 0), alpha], axis=-1)
    return Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")


def hole_mask(im, seed):
    """Opaque where the see-through hole is: the transparent region connected to `seed`."""
    clear = np.asarray(im)[..., 3] < 128
    mask = np.zeros_like(clear)
    stack = [seed[::-1]]
    while stack:
        y, x = stack.pop()
        if 0 <= y < clear.shape[0] and 0 <= x < clear.shape[1] and clear[y, x] and not mask[y, x]:
            mask[y, x] = True
            stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    if mask.sum() > clear.size * 0.05:
        raise SystemExit("sigil hole leaks into the background; check sigil_hole_seed")
    alpha = (mask * 255).astype(np.uint8)
    return Image.merge("RGBA", [Image.new("L", im.size, 0)] * 3 + [Image.fromarray(alpha)])


def extend_roller(im, box, outward):
    """Grow a roller crop outward ("up" or "down") to where the artwork ends, fading
    the outer part of the extra strip so it never ends in a hard line.
    Returns the crop and how many raw rows were added."""
    x0, y0, x1, y1 = box
    rows = np.where((np.asarray(im)[..., 3] > 8).any(axis=1))[0]
    if outward == "up":
        y0, ext = min(y0, rows.min()), y0 - min(y0, rows.min())
    else:
        y1, ext = max(y1, rows.max() + 1), max(y1, rows.max() + 1) - y1
    out = im.crop((x0, y0, x1, y1))
    if ext:
        a = np.asarray(out).copy()
        ramp = np.ones(a.shape[0], np.float32)
        fade = max(1, round(ext * 0.6))
        edge = np.linspace(0, 1, fade, dtype=np.float32)
        if outward == "up":
            ramp[:fade] = edge
        else:
            ramp[-fade:] = edge[::-1]
        a[..., 3] = (a[..., 3] * ramp[:, None]).round().astype(np.uint8)
        out = Image.fromarray(a, "RGBA")
    return out, ext


def main():
    for school, cfg in SCHOOLS.items():
        src, dst = ROOT / "img" / "raw" / school, ROOT / "img" / school
        dst.mkdir(parents=True, exist_ok=True)
        for name in ("roll-top", "roll-bottom", "middle", "sigil"):
            file, box = cfg[name]
            im = Image.open(src / file).convert("RGBA")
            ext = 0
            if name in ("roll-top", "roll-bottom"):
                core_h = box[3] - box[1]
                im, ext = extend_roller(im, box, "up" if name == "roll-top" else "down")
            elif box:
                im = im.crop(box)
            if name == "middle":
                im = seamless_vertical(im, cfg["middle_blend"])
            extra = {"sigil-hole": hole_mask(im, cfg["sigil_hole_seed"])} if name == "sigil" and "sigil_hole_seed" in cfg else {}
            axis, px = cfg["sizes"][name]
            # rollers are scaled by the roller itself, so the slices don't move when the extension changes
            scale = px / (core_h if ext else im.height if axis == "h" else im.width)
            size = (round(im.width * scale), round(im.height * scale))
            for out_name, out_im in {name: im, **extra}.items():
                out_im = out_im.resize(size, Image.LANCZOS)
                out = dst / f"{out_name}.webp"
                out_im.save(out, "WEBP", quality=86, method=6)
                note = f"  ext {round(ext * scale)}" if ext else ""
                print(f"{out.relative_to(ROOT)}  {size[0]}x{size[1]}  scale {scale:.3f}  {out.stat().st_size // 1024} KB{note}")


if __name__ == "__main__":
    main()
