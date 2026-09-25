"""
Generates the torn left/right edges of the parchment scroll and writes them
into style.css between the scroll-edges markers.

  python tools/scroll_edges.py

Each edge style gets two SVG mask tiles per side, built from the same tear line:
  --tear-*  crisp outline: cuts the sheet to shape (the rim colour shows here)
  --rim-*   same outline pulled inward and blurred: the clean parchment on top,
            so the rim follows every tear
Styles are mapped to scroll variants (spell schools) in SCHOOLS below.
Tweak a style's numbers and re-run; change a seed to get a different tear.
"""
import math, random, re, urllib.parse
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "style.css"
W = 46                               # tile width in px (becomes --tear-w)
HEIGHTS = (613, 787)                 # left / right tile heights, different so the sides never repeat in step

BASE = dict(
    seeds=(12, 68),
    sway=0.7,                        # gentle side-to-side wobble
    tear_gap=(90, 280),              # px of clean edge between tears
    tear_tall=(8, 26),               # how tall a tear is
    tear_deep=(4, 15),               # depth of a real bite
    nick_deep=(2, 5),                # depth of a small nick
    nick_chance=0.4,
    tear_blur=0,                     # >0 softens the cut itself (wispy edges)
    rim_inset=(3.0, 7.0),            # how far the clean parchment sits inside the cut
    rim_blur=3.5,
)
STYLES = {
    # the everyday scroll: mostly flat, occasional bite, toasted rim
    "plain": BASE,
}
# scroll variant -> edge style (anything not listed uses plain)
SCHOOLS = {}


def tear_line(height, seed, p):
    """Points (x, y) of the edge, x measured inward from the outer side of the tile."""
    r = random.Random(seed)
    # whole cycles per tile so the sway tiles seamlessly
    waves = [(r.uniform(0.6, 1.4), r.choice([1, 2, 3]), r.uniform(0, 6.3)) for _ in range(3)]
    def base(y):
        return 3.2 + p["sway"] * sum(a * math.sin(2 * math.pi * k * y / height + ph) for a, k, ph in waves)

    tears, y = [], r.uniform(20, 100)
    while y < height - 60:
        tall = r.uniform(*p["tear_tall"])
        deep = r.uniform(*p["nick_deep"]) if r.random() < p["nick_chance"] else r.uniform(*p["tear_deep"])
        # a few jagged points, deepest somewhere off-centre
        mids = sorted((r.uniform(0.15, 0.85), r.uniform(0.35, 1.0)) for _ in range(r.randint(2, 4)))
        peak = max(q for _, q in mids)
        profile = [(0, 0)] + [(t, q / peak) for t, q in mids] + [(1, 0)]
        tears.append((y, tall, deep, profile))
        y += tall + r.uniform(*p["tear_gap"])

    def in_tear(y, pad=0):
        return any(ty - pad <= y <= ty + tall + pad for ty, tall, _, _ in tears)

    pts, y = [], 0.0
    while y <= height:
        x = max(0.5, base(y)) + r.uniform(-0.25, 0.25)
        for ty, tall, deep, profile in tears:
            if ty <= y <= ty + tall:
                t = (y - ty) / tall
                for (t0, p0), (t1, p1) in zip(profile, profile[1:]):
                    if t0 <= t <= t1:
                        x += deep * (p0 + (p1 - p0) * (t - t0) / (t1 - t0))
                        break
        pts.append([min(18, x), y])     # deepest tear 18px; W leaves room for rim + blur
        y += 2.0 if in_tear(y, 2) else 5.0   # finer steps keep a tear's corners sharp
    pts[-1] = [pts[0][0], height]
    return pts, r


def fmt(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def path(pts, solid_x):
    return (f"M{fmt(solid_x)},{fmt(pts[0][1])} " + " ".join(f"L{fmt(x)},{fmt(y)}" for x, y in pts)
            + f" L{fmt(solid_x)},{fmt(pts[-1][1])} Z")


def data_url(svg):
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe=" =:/',.-") + '")'


def mask_svg(pts, height, mirror, blur):
    """Path drawn three times stacked so a blur wraps across the tile seam."""
    far = -20 if mirror else W + 20
    if not blur:
        return f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{height}'><path d='{path(pts, 0 if mirror else W)}'/></svg>"
    return (f"<svg xmlns='http://www.w3.org/2000/svg' xmlns:x='http://www.w3.org/1999/xlink' width='{W}' height='{height}'>"
            f"<filter id='b' x='-50%' y='-10%' width='200%' height='120%'><feGaussianBlur stdDeviation='{blur}'/></filter>"
            f"<g filter='url(#b)'><path id='p' d='{path(pts, far)}'/>"
            f"<use x:href='#p' y='-{height}'/><use x:href='#p' y='{height}'/></g></svg>")


def side(height, seed, mirror, p):
    pts, r = tear_line(height, seed, p)
    flip = (lambda x: W - x) if mirror else (lambda x: x)
    tear = mask_svg([[flip(x), y] for x, y in pts], height, mirror, p["tear_blur"])
    # rim: pull the line inward by an uneven, smoothed amount
    inset, cur = [], r.uniform(*p["rim_inset"])
    for _ in pts:
        cur += (r.uniform(*p["rim_inset"]) - cur) * 0.08
        inset.append(cur)
    rim = mask_svg([[flip(x + d), y] for (x, y), d in zip(pts, inset)], height, mirror, p["rim_blur"])
    return data_url(tear), data_url(rim)


def rule(selector, p):
    tl, rl = side(HEIGHTS[0], p["seeds"][0], False, p)
    tr, rr = side(HEIGHTS[1], p["seeds"][1], True, p)
    return (f"{selector} {{\n  --tear-w: {W}px;\n  --tear-left: {tl};\n  --tear-right: {tr};\n"
            f"  --rim-left: {rl};\n  --rim-right: {rr};\n}}\n")


def main():
    out = ["/* scroll-edges:start (generated by tools/scroll_edges.py, don't edit by hand) */\n",
           rule("[data-scroll] .paper", STYLES["plain"])]
    for style in dict.fromkeys(SCHOOLS.values()):
        selector = ",\n".join(f'[data-scroll="{s}"] .paper' for s, st in SCHOOLS.items() if st == style)
        out.append(rule(selector, STYLES[style]))
    out.append("/* scroll-edges:end */\n")
    css = CSS.read_text(encoding="utf-8")
    new, n = re.subn(r"/\* scroll-edges:start.*?scroll-edges:end \*/\n", lambda _: "".join(out), css, flags=re.S)
    if n != 1:
        raise SystemExit("scroll-edges markers not found in style.css")
    CSS.write_text(new, encoding="utf-8")
    print(f"style.css updated ({len(''.join(out)) // 1024} KB of edges)")


if __name__ == "__main__":
    main()
