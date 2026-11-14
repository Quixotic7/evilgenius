#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# EvilGenius: RemoteFM1's skin backgrounds (remotefm1/skin-portrait.jpg 1152 x 2048, skin-landscape.jpg 2048 x 1280),
# original chunky-pixel art in the C64's colours: the villain's tower at night (raster bands top and bottom, girders,
# lift shafts with their cars, stars), drawn at 1/8 and scaled up whole pixels. Deterministic.
#   DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib python3 tools/eg/gen_skin.py
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
K, W, BLUE, LBLUE, DG, G, LG, Y, O, CY = ((0, 0, 0), (255, 255, 255), (0x2e, 0x2c, 0x9b), (0x70, 0x6d, 0xeb),
                                          (0x4a, 0x4a, 0x4a), (0x7b, 0x7b, 0x7b), (0xb2, 0xb2, 0xb2),
                                          (0xed, 0xf1, 0x71), (0x8e, 0x50, 0x29), (0x75, 0xce, 0xc8))
SCALE = 8


def scene(w, h, seed):
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h), K)
    px = im.load()

    def rect(x, y, ww, hh, c):
        for j in range(max(0, y), min(h, y + hh)):
            for i in range(max(0, x), min(w, x + ww)):
                px[i, j] = c

    # raster bands: the top and the foot, a C64 demo's bars (stepped, no gradient)
    for k, c in enumerate([BLUE, K, BLUE, BLUE, K, LBLUE, BLUE]):
        rect(0, h - 3 * (k + 1), w, 2, c)
    for k, c in enumerate([BLUE, K, BLUE, LBLUE]):
        rect(0, 1 + 3 * k, w, 1, c)
    # stars
    for _ in range(w * h // 60):
        x, y = rnd.randrange(w), rnd.randrange(14, h - 24)
        px[x, y] = rnd.choice([W, LG, G, DG, DG])
    # lift shafts: dotted rails, a car each
    shafts = [6, w - 14] + ([w // 2 - 4] if w > h else [])
    for sx in shafts:
        for y in range(14, h - 24):
            if y % 2 == 0:
                px[sx, y] = DG
                px[sx + 8, y] = DG
            else:
                px[sx, y] = G if y % 4 == 1 else DG
                px[sx + 8, y] = G if y % 4 == 1 else DG
        cy = rnd.randrange(30, h - 40)
        rect(sx + 1, cy, 7, 1, Y)
        rect(sx + 1, cy + 1, 7, 1, O)
    # girders: floors at a few heights, a checker of blue on light blue, gaps at the shafts
    for gy in range(40, h - 30, 36 if h > w else 30):
        for x in range(0, w):
            if any(sx - 1 <= x <= sx + 9 for sx in shafts):
                continue
            px[x, gy] = LBLUE if x % 2 else BLUE
            px[x, gy + 1] = BLUE
            if (x // 2) % 2 == 0:
                px[x, gy + 2] = DG
    # a terminal or two on the floors (the villain's furniture)
    for _ in range(3):
        tx, ty = rnd.randrange(16, w - 30), rnd.choice(list(range(40, h - 30, 36 if h > w else 30)))
        rect(tx, ty - 6, 9, 6, LG)
        rect(tx + 1, ty - 5, 7, 4, K)
        for i in range(2, 7, 2):
            px[tx + i, ty - 4] = CY
        rect(tx + 2, ty - 1, 5, 1, G)
    return im.resize((w * SCALE, h * SCALE), Image.NEAREST)


def main():
    out = ROOT / "remotefm1"
    out.mkdir(exist_ok=True)
    scene(1152 // SCALE, 2048 // SCALE, 64).save(out / "skin-portrait.jpg", quality=92)
    scene(2048 // SCALE, 1280 // SCALE, 6581).save(out / "skin-landscape.jpg", quality=92)
    print("skin:", out / "skin-portrait.jpg", out / "skin-landscape.jpg")


if __name__ == "__main__":
    main()
