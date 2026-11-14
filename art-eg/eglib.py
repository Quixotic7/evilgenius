"""EvilGenius art library: the C64 palette, the two pixel fonts and the sprites from the art/*.txt files, and a
120 x 120 indexed canvas that saves at 2x (240 x 240, the FM-1's screen). The mockups (art/mockups.py) and the
firmware's generated headers (tools/gen_art.py) read the same files."""
from pathlib import Path

ART = Path(__file__).resolve().parent

# the C64's 16 colours (Colodore: a measured palette, brighter than Pepto's on an LCD)
PAL = [
    (0x00, 0x00, 0x00), (0xFF, 0xFF, 0xFF), (0x81, 0x33, 0x38), (0x75, 0xCE, 0xC8),
    (0x8E, 0x3C, 0x97), (0x56, 0xAC, 0x4D), (0x2E, 0x2C, 0x9B), (0xED, 0xF1, 0x71),
    (0x8E, 0x50, 0x29), (0x55, 0x38, 0x00), (0xC4, 0x6C, 0x71), (0x4A, 0x4A, 0x4A),
    (0x7B, 0x7B, 0x7B), (0xA9, 0xFF, 0x9F), (0x70, 0x6D, 0xEB), (0xB2, 0xB2, 0xB2),
]
K, W, R, C, P, G, B, Y, O, N, LR, DG, GR, LG, LB, LGR = range(16)
NAMES = ["black", "white", "red", "cyan", "purple", "green", "blue", "yellow", "orange", "brown", "lightred",
         "darkgrey", "grey", "lightgreen", "lightblue", "lightgrey"]
CH = {"k": K, "W": W, "R": R, "C": C, "P": P, "G": G, "B": B, "Y": Y, "O": O, "N": N, "r": LR, "d": DG,
      "g": GR, "l": LG, "b": LB, "L": LGR}
T = -1   # transparent


def _blocks(path):
    name, rows, out = None, [], {}
    for line in path.read_text().splitlines():
        if line.startswith("# ") or line.strip() in ("", "#"):
            continue   # a comment ("# " and a space; a glyph's rows have no spaces)
        if line.startswith("= "):
            if name is not None:
                out[name] = rows
            name, rows = line[2:].strip(), []
        else:
            rows.append(line.rstrip())
    if name is not None:
        out[name] = rows
    return out


def load_font(fname, cw, ch):
    glyphs = {}
    for name, rows in _blocks(ART / fname).items():
        w = max(len(r) for r in rows)
        glyphs[name] = [[1 if c == "#" else 0 for c in r.ljust(w, ".")] for r in rows]
    return {"cw": cw, "ch": ch, "g": glyphs}


BIG = load_font("font_big.txt", 8, 8)
SMALL = load_font("font_small.txt", 4, 6)


def load_sprites():
    out = {}
    for name, rows in _blocks(ART / "sprites.txt").items():
        w = max(len(r) for r in rows)
        out[name] = [[T if c == "." else CH[c] for c in r.ljust(w, ".")] for r in rows]
    return out


SPR = load_sprites()


class Canvas:
    W = H = 120

    def __init__(self, bg=K):
        self.px = [[bg] * self.W for _ in range(self.H)]

    def pset(self, x, y, c):
        if 0 <= x < self.W and 0 <= y < self.H and c != T:
            self.px[y][x] = c

    def rect(self, x, y, w, h, c):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.pset(i, j, c)

    def frame(self, x, y, w, h, c):
        self.rect(x, y, w, 1, c)
        self.rect(x, y + h - 1, w, 1, c)
        self.rect(x, y, 1, h, c)
        self.rect(x + w - 1, y, 1, h, c)

    def hline(self, x, y, w, c):
        self.rect(x, y, w, 1, c)

    def vline(self, x, y, h, c):
        self.rect(x, y, 1, h, c)

    def dots(self, x, y, w, c, step=2):
        for i in range(x, x + w, step):
            self.pset(i, y, c)

    def text(self, x, y, s, c, font=SMALL, shadow=None):
        for ch in s.upper():
            g = font["g"].get(ch)
            if g:
                for j, row in enumerate(g):
                    for i, v in enumerate(row):
                        if v:
                            if shadow is not None:
                                self.pset(x + i + 1, y + j + 1, shadow)
                            self.pset(x + i, y + j, c)
            x += font["cw"] if ch != " " or True else 0
        return x

    def text_w(self, s, font=SMALL):
        return len(s) * font["cw"] - 1

    def ctext(self, cx, y, s, c, font=SMALL, shadow=None):
        return self.text(cx - (self.text_w(s, font) + 1) // 2, y, s, c, font, shadow)

    def rtext(self, rx, y, s, c, font=SMALL):
        return self.text(rx - self.text_w(s, font), y, s, c, font)

    def sprite(self, x, y, name, flip=False, recolor=None):
        rows = SPR[name]
        for j, row in enumerate(rows):
            r = row[::-1] if flip else row
            for i, v in enumerate(r):
                if v != T and recolor:
                    v = recolor.get(v, v)
                self.pset(x + i, y + j, v)

    def save(self, path, scale=2):
        from PIL import Image
        img = Image.new("RGB", (self.W * scale, self.H * scale))
        p = img.load()
        for y in range(self.H):
            for x in range(self.W):
                col = PAL[self.px[y][x]]
                for b in range(scale):
                    for a in range(scale):
                        p[x * scale + a, y * scale + b] = col
        img.save(path)
        return img
