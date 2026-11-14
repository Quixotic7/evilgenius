#!/usr/bin/env python3
"""The promo: 30 s, 1080 x 1920 (Shorts / Reels), from the firmware's own screen and sound.

    make -C tools tour                      # the host app with its film command
    sh promo/build.sh                       # the lettering: promo/build/glyphs.raw
    (cd promo/build && ../../tools/tour ../take.txt .)     # idle.rgb, take.rgb, take.wav
    python3 promo/make.py                   # promo/evilgenius-short.mp4

The picture is the take's 240 x 240 frames at 4x; the lettering is the firmware's face, cut out of glyphs.raw."""
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(HERE, "build")
OUT = os.path.join(HERE, "evilgenius-short.mp4")
W, H, FPS, SECS = 1080, 1920, 30, 30.0
LCD, LX, LY = 960, 60, 452                 # the screen at 4x and where it sits
FR = 240 * 240 * 3

BLACK, WHITE, RED, CYAN, GREEN = (0, 0, 0), (255, 255, 255), (0x81, 0x33, 0x38), (0x75, 0xCE, 0xC8), (0x56, 0xAC, 0x4D)
BLUE, YELLOW, LRED, LGREEN, LBLUE = (0x2E, 0x2C, 0x9B), (0xED, 0xF1, 0x71), (0xC4, 0x6C, 0x71), (0xA9, 0xFF, 0x9F), (0x70, 0x6D, 0xEB)
GREY = (0x7B, 0x7B, 0x7B)

# (from s, line 1, line 2, line 2's colour): the take's marks (promo/take.txt)
CAPS = [
    (0.00, "THE FM-1", "JUST TURNED EVIL", LRED),
    (1.94, "EVERY VOICE", "IS A SID CHIP", YELLOW),
    (3.89, "SIX TRACKS", "EIGHT SID CHIPS", CYAN),
    (5.83, "3 OSCILLATORS", "RING SYNC FILTER", LGREEN),
    (7.89, "LOCK ANY STEP", "SWEEPS. ROLLS. DROPS.", YELLOW),
    (11.74, "AND IT TALKS", "SAM, IN 4 BITS", LGREEN),
    (15.41, "8 EFFECTS", "ONE TOWER", YELLOW),
    (23.07, "95 SOUNDS", "PAL ARPEGGIOS", CYAN),
    (25.55, "USB HOST", "BLUETOOTH MIDI", LGREEN),
    (28.00, "EVILGENIUS", "FREE. OPEN SOURCE.", LRED),
]
TITLE_END, CARD = 1.94, 28.00              # the idle title over the first bar; the end card


def glyphs():
    raw = open(os.path.join(B, "glyphs.raw"), "rb").read()
    g = {}
    for c in list(range(32, 96)) + [0xB7]:
        k = 64 if c == 0xB7 else c - 32
        cx, cy = (k % 12) * 10, (k // 12) * 10
        rows = []
        for y in range(8):
            row = 0
            for x in range(8):
                o = ((cy + y) * 2 * 240 + (cx + x) * 2) * 2
                if raw[o] | raw[o + 1]:
                    row |= 1 << x
            rows.append(row)
        g[chr(c)] = rows
    return g


G = glyphs()


def text(im, x, y, s, col, sc, shadow=BLUE):
    px = im.load()
    for dx, dy, c in ((sc // 2 if shadow else 0, sc // 2 if shadow else 0, shadow), (0, 0, col)):
        if c is None:
            continue
        for i, ch in enumerate(s):
            rows = G.get(ch, G["?"])
            for gy in range(8):
                for gx in range(8):
                    if rows[gy] >> gx & 1:
                        x0, y0 = x + dx + (i * 8 + gx) * sc, y + dy + gy * sc
                        for yy in range(y0, y0 + sc):
                            for xx in range(x0, x0 + sc):
                                px[xx, yy] = c


def ctext(im, y, s, col, sc, n=None):
    """Centred on the whole string; n letters of it drawn (the typewriter)."""
    x = (W - len(s) * 8 * sc) // 2 + sc // 2
    text(im, x, y, s if n is None else s[:n], col, sc)


def fit(s, most=10):
    return min(most, 984 // (8 * len(s)))


def base():
    im = Image.new("RGB", (W, H), BLACK)
    px = im.load()
    for y in range(H):                      # the border: the C64's raster bars, faint, top and bottom
        band = (y // 24) % 2
        if y < 96 or y >= H - 96:
            c = BLUE if band else (0x1A, 0x19, 0x5C)
            for x in range(W):
                px[x, y] = c
    for t, c in ((20, BLUE), (12, LBLUE)):  # the screen's frame
        for y in range(LY - t, LY + LCD + t):
            for x in range(LX - t, LX + LCD + t):
                px[x, y] = c
    ctext(im, 1500, "EVILGENIUS", WHITE, 6)
    ctext(im, 1568, "FIRMWARE FOR THE M-VAVE FM-1", LBLUE, 4)
    return im


def card_foot(im):
    """The end card's foot: where to get it (over the wordmark)."""
    px = im.load()
    for y in range(1480, 1640):
        for x in range(W):
            px[x, y] = BLACK
    ctext(im, 1492, "QUIXOTIC7.GITHUB.IO", YELLOW, 6)
    ctext(im, 1560, "/EVILGENIUS", YELLOW, 6)


def main():
    idle = open(os.path.join(B, "idle.rgb"), "rb").read()
    take = open(os.path.join(B, "take.rgb"), "rb").read()
    bg = base()
    layers = {}

    def layer(k, n1, n2):
        key = (k, n1, n2)
        if key not in layers:
            _, a, b, col = CAPS[k]
            im = bg.copy()
            if CAPS[k][0] >= CARD:
                card_foot(im)
            sa, sb = fit(a), fit(b, 8)
            ctext(im, 150, a, WHITE, sa, n1)
            ctext(im, 150 + 8 * sa + 28, b, col, sb, n2)
            layers[key] = im
            if len(layers) > 80:
                layers.pop(next(iter(layers)))
        return layers[key]

    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H), "-r", str(FPS),
         "-i", "-", "-i", os.path.join(B, "take.wav"), "-t", str(SECS),
         "-af", "volume=5.5dB,alimiter=limit=0.84:level=0,afade=t=out:st=%.2f:d=0.9" % (SECS - 0.9),
         "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", "-tune", "animation",
         "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", OUT],
        stdin=subprocess.PIPE)
    nf = int(SECS * FPS)
    for f in range(nf):
        t = f / FPS
        k = max(i for i, c in enumerate(CAPS) if c[0] <= t + 1e-6)
        dt = t - CAPS[k][0]
        a, b = CAPS[k][1], CAPS[k][2]
        n1 = min(len(a), int(dt * 60) + 1)                      # typed in: 60 letters a second
        n2 = max(0, min(len(b), int((dt - 0.25) * 60)))
        im = layer(k, n1, n2).copy()
        if t < TITLE_END:
            src, i = idle, f
        elif t >= CARD:
            src, i = idle, min(85, 25 + int((t - CARD) * FPS))  # the title again, held when it is whole
        else:
            src, i = take, f
        scr = Image.frombytes("RGB", (240, 240), src[i * FR:(i + 1) * FR]).resize((LCD, LCD), Image.NEAREST)
        if t >= SECS - 0.4:                                     # out to black
            scr = Image.blend(scr, Image.new("RGB", scr.size, BLACK), min(1.0, (t - (SECS - 0.4)) / 0.4))
        im.paste(scr, (LX, LY))
        ff.stdin.write(im.tobytes())
    ff.stdin.close()
    if ff.wait():
        sys.exit("ffmpeg failed")
    print(OUT)


if __name__ == "__main__":
    main()
