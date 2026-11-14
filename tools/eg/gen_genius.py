#!/usr/bin/env python3
"""EvilGenius: the owner's two pictures of the Evil Genius (art-eg/genius-ref.webp, the machine; genius-laugh-ref.webp,
its laughing face) -> sprites in art-eg/sprites.txt, at the firmware's 120 x 120 and in the C64's sixteen colours:
    GENIUS_BIG    the machine: the jar, the brain, the computer, its monitors and pylons (the idle screen; its jar
                  alone on the effects' SENDS and in the scenes)
    GENIUS_HA     the brain laughing (drawn over GENIUS_BIG's)
A picture's cell is averaged, then takes the nearest of the colours allowed it. Run, then tools/eg/gen_art.py.
    tools/eg/gen_genius.py [--preview OUT.png]"""
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "art-eg"
sys.path.insert(0, str(ART))
PAL = [(0x00, 0x00, 0x00), (0xff, 0xff, 0xff), (0x81, 0x33, 0x38), (0x75, 0xce, 0xc8), (0x8e, 0x3c, 0x97),
       (0x56, 0xac, 0x4d), (0x2e, 0x2c, 0x9b), (0xed, 0xf1, 0x71), (0x8e, 0x50, 0x29), (0x55, 0x38, 0x00),
       (0xc4, 0x6c, 0x71), (0x4a, 0x4a, 0x4a), (0x7b, 0x7b, 0x7b), (0xa9, 0xff, 0x9f), (0x70, 0x6d, 0xeb),
       (0xb2, 0xb2, 0xb2)]
CH = "kWRCPGBYONrdglbL"
USE = [0, 1, 2, 3, 4, 5, 7, 10, 11, 12, 13, 14, 15]      # (no blue, orange, brown: the picture has none)


def nearest(c):
    """A picture's colour as one of the C64's, by what it is in the picture (its hue first): the liquid's greens,
    the brain's pinks, the machine's lavender greys, the tubes' purple, the sparks' yellow, the glass's cyan."""
    import colorsys
    r, g, b = [v / 255. for v in c]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h *= 360.
    if v < 0.16:
        return 0
    if s < 0.16:                                        # the greys and white
        return 1 if v > 0.86 else 15 if v > 0.62 else 12 if v > 0.4 else 11
    if 40 <= h < 68:
        return 7 if v > 0.55 else 9                     # yellow
    if 68 <= h < 165:                                   # the greens: the lime bright, the liquid
        return 13 if (v > 0.72 and h < 110) else 5 if v > 0.22 else 0
    if 165 <= h < 205:
        return 3                                        # the glass
    if 205 <= h < 300:                                  # the machine's lavender, the tubes' purple
        if s > 0.5:
            return 4 if v > 0.3 else 0
        return 15 if v > 0.74 else 14 if v > 0.52 else 12 if v > 0.36 else 11
    if h >= 300 or h < 25:                              # the brain's pinks, the lamps
        if s < 0.3 and v > 0.8:
            return 1
        return 10 if v > 0.62 else 2 if v > 0.25 else 0
    return 8 if v > 0.4 else 9                          # (orange .. brown: skin, hair)


def cells(im, box, w, h):
    """The picture's box as w x h cells, each the colour most of its middle is."""
    x0, y0, x1, y1 = box
    px = im.load()
    out = []
    for cy in range(h):
        row = []
        for cx in range(w):
            ax, bx = x0 + (x1 - x0) * cx / w, x0 + (x1 - x0) * (cx + 1) / w
            ay, by = y0 + (y1 - y0) * cy / h, y0 + (y1 - y0) * (cy + 1) / h
            mx, my = (bx - ax) * 0.22, (by - ay) * 0.22
            votes = {}
            ys = [ay + my + (by - ay - 2 * my) * k / 3 for k in range(4)]
            xs = [ax + mx + (bx - ax - 2 * mx) * k / 3 for k in range(4)]
            for yy in ys:
                for xx in xs:
                    v = nearest(px[min(im.size[0] - 1, int(xx)), min(im.size[1] - 1, int(yy))])
                    votes[v] = votes.get(v, 0) + 1
            row.append(max(votes.items(), key=lambda kv: kv[1])[0])
        out.append(row)
    return out


def put(name, rows, note=None):
    p = ART / "sprites.txt"
    s = p.read_text()
    blk = "= %s\n%s\n" % (name, "\n".join("".join("." if v is None else CH[v] for v in r) for r in rows))
    m = re.search(r"^= %s\n(?:[^=#\n].*\n)+" % name, s, re.M)
    if m:
        s = s[:m.start()] + blk + s[m.end():]
    else:
        s = s.rstrip("\n") + "\n" + ("# %s\n" % note if note else "") + blk
    p.write_text(s)


def main():
    a = Image.open(ART / "genius-ref.webp").convert("RGB")
    b = Image.open(ART / "genius-laugh-ref.webp").convert("RGB")
    # the machine: the picture from its left edge to the shaft, its top to under the feet's sparks
    MW, MH = 100, 88
    big = cells(a, (36, 6, 1132, 972), MW, MH)
    big = [[None if v == 0 else v for v in r] for r in big]
    # the brain, in both pictures (stem and all): the laugh is the second picture's brain over the liquid, its foot
    # where the first's is
    sx, sy = MW / (1132 - 36), MH / (972 - 6)
    bx0, by1 = round((412 - 36) * sx), round((650 - 6) * sy)          # the first's brain: its left, its foot
    bw = round((832 - 412) * sx)
    L = (378, 256, 756, 566)                                          # the second's brain
    bh = round(bw * (L[3] - L[1]) / (L[2] - L[0]))
    lau = cells(b, L, bw, bh)
    lau = [[5 if v in (5, 13, 7, 3) else v for v in r] for r in lau]  # (round it: the liquid, plain)
    jx0, jy0 = bx0 - 1, by1 - bh
    ha = [[5] + r + [5] for r in lau]
    # the jar in the machine (its glass, outside edge), for the screens that show it alone
    J = (round((312 - 36) * sx), round((222 - 6) * sy), round((918 - 36) * sx) + 1, round((660 - 6) * sy) + 1)
    put("GENIUS_BIG", big, "the Evil Genius (tools/eg/gen_genius.py, from the owner's pictures): the machine, %d x %d, "
        "its jar at %d, %d, %d x %d; the brain laughing, drawn over it at %d, %d" %
        (MW, MH, J[0], J[1], J[2] - J[0], J[3] - J[1], jx0, jy0))
    put("GENIUS_HA", ha)
    jx1, jy1 = jx0 + len(ha[0]), jy0 + len(ha)
    print("gen_genius: GENIUS_BIG %dx%d; the jar %d,%d %dx%d; GENIUS_HA %dx%d at %d,%d" %
          (MW, MH, J[0], J[1], J[2] - J[0], J[3] - J[1], len(ha[0]), len(ha), jx0, jy0))
    if "--preview" in sys.argv:
        S = 6
        im = Image.new("RGB", ((MW * 2 + 8) * S, MH * S), (20, 20, 40))
        for k in range(2):
            for y, r in enumerate(big):
                for x, v in enumerate(r):
                    if k and jy0 <= y < jy1 and jx0 <= x < jx1:
                        v = ha[y - jy0][x - jx0]
                    c = PAL[v or 0]
                    for yy in range(S):
                        for xx in range(S):
                            im.putpixel(((k * (MW + 8) + x) * S + xx, y * S + yy), c)
        im.save(sys.argv[sys.argv.index("--preview") + 1])


if __name__ == "__main__":
    main()
