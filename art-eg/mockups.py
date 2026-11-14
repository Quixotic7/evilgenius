#!/usr/bin/env python3
"""EvilGenius mockups: every screen drawn at 120 x 120 in the C64's 16 colours, saved at 2x (240 x 240) as
art/mock/NN-name.png. The firmware (ui.c) draws the same layouts; this file is their reference.

The grammar is FIZZ's: SELECT turns pages, PRESETS browses, ALGORITHM is the page's special value (top right),
KNOB 1..4 the page's four values (the foot), colour = knob, red = alarm / recording only, one drawing per page,
a value the drawing can't show takes the screen for a second, pop-ups: OCT- back, OCT+ confirm."""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eglib import BIG, SMALL, Canvas, K, W, R, C, P, G, B, Y, O, N, LR, DG, GR, LG, LB, LGR  # noqa: E402

OUT = Path(__file__).resolve().parent / "mock"

# colour = knob (FIZZ's rule, in the C64's colours)
K1, K2, K3, K4 = LB, LG, W, LR
KSEL, KALG = Y, C
KNOB_COL = [K1, K2, K3, K4]
LABEL, RULE, DIM, SOFT = GR, DG, DG, LGR

shots = []


def shot(name, title, note):
    def deco(fn):
        shots.append((name, title, note, fn))
        return fn
    return deco


# ----------------------------------------------------------------------------------------- the kit ---
def big2(cv, x, y, s, c, shadow=None):
    """the BIG font at 2x: the takeover's and confirmation's value"""
    for ch in s.upper():
        g = BIG["g"].get(ch)
        if g:
            for j, row in enumerate(g):
                for i, v in enumerate(row):
                    if v:
                        if shadow is not None:
                            cv.rect(x + 2 * i + 2, y + 2 * j + 2, 2, 2, shadow)
                        cv.rect(x + 2 * i, y + 2 * j, 2, 2, c)
        x += 16
    return x


def big2_w(s):
    return len(s) * 16 - 2


def head(cv, name, dots=None, alg=None, alg_col=KALG, col=W):
    """the head: the page's name (BIG), its group's page dots, ALGORITHM's value in a box at the right"""
    x = cv.text(2, 1, name, col, BIG)
    if dots:
        n, cur = dots
        for i in range(n):
            if i == cur:
                cv.rect(x + 1 + i * 4, 4, 2, 2, KSEL)
            else:
                cv.pset(x + 1 + i * 4, 5, DG)
    if alg:
        w = cv.text_w(alg) + 5
        cv.frame(118 - w, 1, w + 1, 9, alg_col)
        cv.text(121 - w, 3, alg, alg_col)
    cv.dots(0, 11, 120, RULE)


def foot(cv, cols, lit=None):
    """the four knob columns: label (grey) over value (the knob's colour); the knob turned last underlined"""
    cv.dots(0, 94, 120, RULE)
    for i, (lab, val) in enumerate(cols):
        cx = i * 30 + 15
        if lab is None:
            cv.ctext(cx, 106, "-", DG, BIG)
            continue
        cv.ctext(cx, 97, lab, SOFT if lit == i else LABEL)
        if lit == i:
            cv.rect(cx - 10, 104, 20, 1, KNOB_COL[i])
        f = BIG if len(val) <= 3 else SMALL
        cv.ctext(cx, 107 if f is BIG else 109, val, KNOB_COL[i], f)


def girder(cv, x, y, w, lit=False):
    for i in range(x, x + w, 8):
        cv.sprite(i, y, "FLOOR_LIT" if lit else "FLOOR")


def keybed(cv, y, held=(), lit_col=Y, labels=None, h=18):
    """the 27 keys where they sit on the panel: 16 white below, 11 black above"""
    WK = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26]
    BK = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25]
    AT = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14]
    for i, k in enumerate(WK):
        x = 4 + i * 7
        on = k in held
        cv.rect(x, y + h // 2, 6, h // 2, lit_col if on else DG)
        if labels:
            cv.text(x + 1, y + h // 2 + 2, labels[k], K if on else LGR)
    for i, k in enumerate(BK):
        x = 4 + AT[i] * 7 + 4
        on = k in held
        cv.rect(x, y, 6, h // 2 - 1, lit_col if on else GR)
        if labels:
            cv.text(x + 1, y + 1, labels[k], K if on else W)


def scope(cv, x, y, w, h, fn, c, frame=True):
    """a waveform, y = fn(phase 0..1) in -1..1, drawn as chunky steps"""
    if frame:
        cv.frame(x, y, w, h, DG)
    prev = None
    for i in range(w - 4):
        v = fn(i / (w - 4))
        py = y + h // 2 - int(round(v * (h // 2 - 3)))
        if prev is not None and abs(py - prev) > 1:
            cv.vline(x + 2 + i, min(py, prev), abs(py - prev) + 1, c)
        cv.pset(x + 2 + i, py, c)
        prev = py


def adsr(cv, x, y, w, h, a, d, s, r, c, fill=None):
    """the envelope as a chunky polyline; a, d, r in 0..15 (SID nibbles), s 0..15"""
    seg = (w - 12) / 3
    xa = x + 2 + a / 15 * seg
    xd = xa + d / 15 * seg
    xs = x + w - 2 - r / 15 * seg - 6
    xr = x + w - 2
    top, bot = y + 2, y + h - 2
    sy = bot - s / 15 * (h - 4)
    pts = [(x + 2, bot), (xa, top), (xd, sy), (xs, sy), (xr, bot)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for k in range(n + 1):
            t = k / max(n, 1)
            cv.rect(int(x0 + (x1 - x0) * t), int(y0 + (y1 - y0) * t), 2, 2, c)
    for px_, py_ in pts[1:4]:
        cv.rect(int(px_) - 1, int(py_) - 1, 4, 4, W)


def popup_frame(cv, col):
    cv.frame(0, 0, 120, 120, col)
    cv.frame(1, 1, 118, 118, col)


def back_ok(cv, back="BACK", ok="OK"):
    """a pop-up's foot: OCT- back, OCT+ confirm"""
    cv.dots(2, 108, 116, RULE)
    cv.rect(3, 110, cv.text_w(back) + 13, 8, DG)
    cv.text(5, 111, "<", W)
    cv.text(11, 111, back, W)
    w = cv.text_w(ok) + 13
    cv.rect(117 - w, 110, w, 8, LG)
    cv.text(119 - w, 111, ok, K)
    cv.text(117 - 8, 111, ">", K)


# ---------------------------------------------------------------------------------------- screens ---
@shot("boot", "Boot / idle", "Power-on and after two minutes untouched: the villain at his console, the name "
      "in the BIG font at 2x, the lift sliding. Any key wakes it.")
def s_boot(cv):
    for i in range(40):
        random.seed(i)
        cv.pset(random.randrange(120), random.randrange(70), random.choice([DG, GR, W]))
    cv.sprite(52, 14, "GENIUS")
    cv.rect(40, 31, 40, 2, DG)
    cv.sprite(46, 33, "TERMINAL")
    big2(cv, 4, 54, "EVIL", R, shadow=K)
    big2(cv, 4, 54, "EVIL", LR)
    big2(cv, 4 + 16 * 4 + 8, 54, "", W)
    big2(cv, 4, 72, "GENIUS", W, shadow=DG)
    cv.vline(110, 50, 44, DG)
    cv.vline(113, 50, 44, DG)
    cv.sprite(108, 62, "LIFT")
    girder(cv, 0, 94, 120)
    cv.ctext(60, 104, "SID + VOX SYNTHESIS", GR)
    cv.ctext(60, 112, "V0.1", DG)


def home_scene(cv, voices, agent_x, flip=False, frame="AGENT_RUN1", talk=False):
    """HOME's room: the agent on the top girder, a robot per voice below; a sounding voice's robot zaps"""
    # the room: two floors and a lift shaft at the right
    girder(cv, 0, 46, 96)
    girder(cv, 0, 80, 96)
    for y in range(13, 92, 4):
        cv.sprite(100, y, "RAIL")
        cv.sprite(112, y, "RAIL")
    cv.sprite(104, 58, "LIFT")
    cv.sprite(agent_x, 30, frame, flip=flip)
    for i, (on, x) in enumerate(voices):
        cv.sprite(x, 68, "ROBOT2" if on else "ROBOT1", flip=x > 50)
        if on:   # the zapper: a beam, the voice's level its length
            bx = x + 11 if x <= 50 else x - 1
            for k in range(0, 14, 2):
                cv.rect(bx + (k if x <= 50 else -k - 2), 73, 2, 1, [Y, W, C][(k // 2) % 3])
    cv.sprite(4, 14, "GENIUS_TALK" if talk else "GENIUS")


@shot("home-sid", "HOME, SID", "The room. The agent runs with the notes (its speed is the tempo, its direction "
      "the last note's step), a patrol robot per voice zaps while its voice sounds. Head: the preset; ALGORITHM's "
      "box: the engine. Foot: the preset's four macros.")
def s_home_sid(cv):
    head(cv, "01 SAW LEAD", alg="SID")
    home_scene(cv, [(True, 6), (True, 40), (False, 72)], 56, frame="AGENT_RUN1")
    cv.text(24, 16, "C4 E4", W)
    cv.text(24, 23, "2/6 VOICES", GR)
    foot(cv, [("CUT", "88"), ("RES", "9"), ("ATK", "0"), ("REL", "6")])


@shot("home-vox", "HOME, VOX", "The same room with the speech engine: the villain's mouth moves while a word "
      "sounds, the word being said is written in the terminal's green above the agent.")
def s_home_vox(cv):
    head(cv, "17 INTRUDER", alg="VOX")
    home_scene(cv, [(True, 6), (False, 40), (False, 72)], 30, flip=True, frame="AGENT_RUN3", talk=True)
    cv.rect(24, 15, 60, 11, K)
    cv.frame(24, 15, 60, 11, G)
    cv.text(27, 18, "INTRUDER", LG, SMALL)
    cv.text(66, 18, "G3", W)
    foot(cv, [("WORD", "INTRUDER"), ("ROOT", "C4"), ("BITS", "4"), ("BED", "60")])


@shot("sid-wave", "SID 1 WAVE", "EDIT, page 1 of the SID engine. The drawing is the wave the chip makes: "
      "ALGORITHM picks the wave program (one shape, the C64 chord arps, drums), KNOB 1 the waveform bits, "
      "KNOB 2 the pulse width, KNOB 3 the PWM sweep, KNOB 4 the coarse tune.")
def s_sid_wave(cv):
    head(cv, "WAVE", dots=(6, 0), alg="PROG SAW")
    pw = 0.35
    scope(cv, 4, 16, 112, 40, lambda t: 1 if (t * 3 % 1) < pw else -1, K1)
    scope(cv, 4, 58, 112, 32, lambda t: (t * 3 % 1) * 2 - 1, DG, frame=False)
    cv.text(6, 59, "PW 35%", K2)
    cv.text(84, 59, "+PWM", K3)
    foot(cv, [("WAVE", "PUL"), ("PW", "35"), ("PWM", "+12"), ("TUNE", "0")], lit=1)


@shot("sid-env", "SID 2 ENV", "The SID's own ADSR, 0..15 each as the chip has it. The white squares are the "
      "corners each knob moves.")
def s_sid_env(cv):
    head(cv, "ENVELOPE", dots=(6, 1), alg="HR 2")
    cv.frame(4, 16, 112, 72, DG)
    adsr(cv, 6, 20, 108, 64, 2, 9, 10, 6, K2)
    cv.text(8, 80, "GATE", DG)
    foot(cv, [("ATK", "2"), ("DEC", "9"), ("SUS", "10"), ("REL", "6")], lit=2)


@shot("sid-filter", "SID 3 FILTER", "The chip's one filter per chip (shared by its voices, as on the C64). "
      "ALGORITHM: LP / BP / HP / NOTCH / OFF. KNOB 3 sweeps the cutoff per frame, KNOB 4 picks the 6581's warm "
      "S-curve or the 8580's clean one.")
def s_sid_filter(cv):
    head(cv, "FILTER", dots=(6, 2), alg="LP")
    cv.frame(4, 16, 112, 72, DG)
    fc, q = 0.55, 0.6
    prev = None
    for i in range(108):
        f = i / 108
        g = 1 / math.sqrt((1 - (f / fc) ** 2) ** 2 + (f / fc / (0.5 + 3 * q)) ** 2 + 1e-4) if f < 1 else 0
        y = 70 - int(min(g, 2.6) * 18)
        y = max(18, min(86, y))
        if prev is not None:
            cv.vline(6 + i, min(y, prev), abs(y - prev) + 1, K1)
        prev = y
    cv.vline(6 + int(fc * 108), 18, 68, DG)
    cv.text(8, 80, "6581", K4)
    foot(cv, [("CUT", "1100"), ("RES", "9"), ("SWP", "-4"), ("CHIP", "6581")], lit=0)


@shot("sid-mod", "SID 4 MOD", "Sync and ring: the note takes two of a chip's voices, the second a silent source "
      "at its own interval (KNOB 2) and sweep (KNOB 3). The top wave is the source, the bottom what you hear.")
def s_sid_mod(cv):
    head(cv, "SYNC RING", dots=(6, 3), alg="SYNC")
    scope(cv, 4, 16, 112, 30, lambda t: (t * 2 % 1) * 2 - 1, DG)
    scope(cv, 4, 50, 112, 38, lambda t: ((t * 2 % 1) * 3.4 % 1) * 2 - 1, K1)
    for i in range(1, 2):
        cv.vline(4 + i * 56, 16, 72, R)
    foot(cv, [("MODE", "SYN"), ("INT", "+19"), ("SWP", "+3"), ("HR", "2")], lit=1)


@shot("sid-vib", "SID 5 VIBRATO", "The driver's triangle vibrato: delay (frames), speed, depth. The mod wheel "
      "adds depth. KNOB 4: the glide between notes.")
def s_sid_vib(cv):
    head(cv, "VIBRATO", dots=(6, 4))
    cv.frame(4, 16, 112, 72, DG)
    d = 30
    cv.hline(6, 52, d, K1)
    for i in range(d, 108):
        v = math.asin(math.sin((i - d) / 7)) * 2 / math.pi
        cv.rect(6 + i, 52 - int(v * 14), 1, 2, K2)
    cv.vline(6 + d, 20, 64, DG)
    cv.text(8, 22, "DELAY", K1)
    foot(cv, [("DLY", "30"), ("SPD", "36"), ("DEP", "80"), ("GLD", "0")], lit=2)


@shot("sid-voice", "SID 6 VOICES", "How the chips are played: one chip (3 voices) or two (6), mono with "
      "legato, the driver's frame rate (50 Hz PAL, 2x, 4x multispeed) and the chip's master volume. Each box "
      "is a voice; a lit one sounds.")
def s_sid_voice(cv):
    head(cv, "VOICES", dots=(6, 5), alg="POLY")
    for chip in range(2):
        x0 = 6 + chip * 56
        cv.frame(x0, 18, 52, 66, GR if chip == 0 else DG)
        cv.text(x0 + 3, 21, "SID %d" % (chip + 1), W if chip == 0 else DG)
        for v in range(3):
            on = chip == 0 and v < 2
            cv.rect(x0 + 4, 30 + v * 17, 44, 13, K2 if on else K)
            cv.frame(x0 + 4, 30 + v * 17, 44, 13, K2 if on else DG)
            cv.text(x0 + 7, 34 + v * 17, ["C4", "E4", "--"][v] if chip == 0 else "--", K if on else DG)
    foot(cv, [("CHIP", "1"), ("MOD", "6581"), ("RATE", "1X"), ("VOL", "15")])


def digi_wave(t):
    """a spoken word's 4-bit digi: bursts of a buzzy voiced wave, a hiss between"""
    seg = int(t * 9) % 9
    if seg in (2, 6):
        return (random.random() * 2 - 1) * 0.35
    env = math.sin((t * 9 % 1) * math.pi)
    v = math.sin(t * 2 * math.pi * 40) * 0.6 + math.sin(t * 2 * math.pi * 117) * 0.4
    return round(v * env * 7) / 7


@shot("vox-word", "VOX 1 WORD", "The speech engine does what 1984's games did: 4-bit samples written to the "
      "SID's master volume register ($D418) thousands of times a second, through the emulated chip. The terminal "
      "shows the word and its 16-level wave; the white line is where it's playing. ALGORITHM: WORD (every key "
      "says the word at its pitch, faster and higher up the keys) or SPELL (each key says its own word).")
def s_vox_word(cv):
    head(cv, "WORD", dots=(4, 0), alg="WORD")
    cv.rect(4, 15, 112, 76, K)
    cv.frame(4, 15, 112, 76, G)
    cv.ctext(60, 19, "INTRUDER", LG, BIG)
    random.seed(3)
    prev = None
    for i in range(104):
        v = digi_wave(i / 104)
        y = 62 - int(v * 22)
        if prev is not None:
            cv.vline(8 + i, min(y, prev), abs(y - prev) + 1, LG if abs(v) > 0.4 or i % 3 else G)
        prev = y
    cv.vline(8 + 38, 32, 56, W)
    cv.text(8, 84, "0.62S", G)
    cv.rtext(112, 84, "17/40", G)
    foot(cv, [("WORD", "INTRUDER"), ("ROOT", "C4"), ("LOOP", "OFF"), ("BANK", "SPY")], lit=0)


@shot("vox-digi", "VOX 2 DIGI", "The register itself: the four volume bits lit as the sample writes them. "
      "KNOB 1 the bits kept (4 is the real thing, 1 a buzz), KNOB 2 the rate the word was sampled at (the "
      "games' 4-8 kHz), KNOB 3 the chip: digis are loud on the 6581 and almost silent on the 8580 (as on the "
      "real chips), KNOB 4 a boost for the 8580's.")
def s_vox_digi(cv):
    head(cv, "DIGI", dots=(4, 1), alg="$D418")
    cv.text(6, 16, "VOL", GR)
    bits = [1, 0, 1, 1]
    for i, b in enumerate(bits):
        x = 30 + i * 22
        cv.frame(x, 15, 18, 10, K1 if b else DG)
        if b:
            cv.rect(x + 2, 17, 14, 6, K1)
        cv.ctext(x + 9, 26, str(3 - i), DG)
    cv.frame(4, 34, 112, 56, DG)
    random.seed(7)
    lvl = 0
    for i in range(0, 108, 4):
        lvl = max(0, min(15, lvl + random.choice([-3, -2, -1, 1, 2, 3])))
        cv.rect(6 + i, 86 - lvl * 3, 4, 2, K1)
    cv.text(8, 37, "8 KHZ", K2)
    foot(cv, [("BITS", "4"), ("RATE", "8K"), ("CHIP", "6581"), ("BST", "0")], lit=0)


@shot("vox-shape", "VOX 3 SHAPE", "Where in the word to start and stop (KNOB 1, 2), looped or not (KNOB 3: "
      "OFF / FWD / BOUNCE: a stutter, a drone of a vowel), and the release after the key (KNOB 4).")
def s_vox_shape(cv):
    head(cv, "SHAPE", dots=(4, 2), alg="FWD")
    cv.frame(4, 16, 112, 72, DG)
    random.seed(3)
    prev = None
    for i in range(104):
        v = digi_wave(i / 104)
        y = 52 - int(v * 24)
        inside = 26 <= i < 70
        if prev is not None:
            cv.vline(8 + i, min(y, prev), abs(y - prev) + 1, K3 if inside else DG)
        prev = y
    cv.vline(8 + 26, 18, 68, K1)
    cv.vline(8 + 70, 18, 68, K2)
    cv.text(8 + 28, 80, "LOOP", K3)
    cv.rect(8 + 26, 84, 44, 1, K3)
    foot(cv, [("STRT", "25"), ("END", "67"), ("LOOP", "FWD"), ("REL", "4")], lit=2)


@shot("vox-bed", "VOX 4 BED", "The chip's three voices still play under the speech, as a game's music did: "
      "KNOB 1 picks a SID patch for them (or OFF), KNOB 2 their level, KNOB 3 their octave, KNOB 4 ducks them "
      "while a word sounds.")
def s_vox_bed(cv):
    head(cv, "BED", dots=(4, 3), alg="LAYER")
    cv.sprite(6, 18, "ICON_VOX")
    cv.text(18, 20, "SPEECH", LG)
    cv.rect(18, 28, 90, 3, LG)
    cv.sprite(6, 40, "ICON_SID")
    cv.text(18, 42, "RESO PAD", K1)
    cv.rect(18, 50, 56, 3, K2)
    cv.rect(74, 50, 34, 3, DG)
    cv.text(18, 58, "DUCK", K4)
    for i in range(22):
        cv.rect(18 + i * 4, 66 + (6 if 4 < i < 14 else 0), 3, 2, K4)
    foot(cv, [("BED", "RESO"), ("LVL", "60"), ("OCT", "-1"), ("DUCK", "50")], lit=3)


@shot("arp", "ARP", "ARP (button) for both engines: the held keys stepped at the C64 driver's frame rate or "
      "the tempo. The ladder is the pattern; the lit rung is now.")
def s_arp(cv):
    head(cv, "ARP", alg="ON")
    cv.frame(4, 16, 112, 72, DG)
    pat = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1]
    for i, p in enumerate(pat):
        x = 8 + i * 8
        y = 76 - p * 16
        cv.sprite(x, y, "LIFT") if i != 5 else None
        if i == 5:
            cv.rect(x, y, 8, 3, Y)
            cv.sprite(x - 1, y - 16, "AGENT_STAND")
    foot(cv, [("MODE", "UPDN"), ("RATE", "1/16"), ("OCT", "2"), ("GATE", "60")], lit=1)


TOWER = [("CRUSH", True), ("ROBOT", False), ("WARP", False), ("GLITCH", False),
         ("CHORUS", True), ("ECHO", True), ("ROOM", True), ("TV", False)]


@shot("fx-tower", "FX TOWER", "FX (button): the chain as a tower of eight rooms, the signal going down the lift. "
      "A lit room is on. The black keys B1..B8 open a room's page; SHIFT + a black key turns it on or off. "
      "KNOB 1..4: the chain's dry/wet, tempo, input drive, output.")
def s_fx_tower(cv):
    head(cv, "FX TOWER", alg="120 BPM")
    for i, (name, on) in enumerate(TOWER):
        col, row = i % 2, i // 2
        x, y = 6 + col * 62, 15 + row * 19
        cv.frame(x, y, 46, 16, LB if on else DG)
        if on:
            cv.rect(x + 1, y + 1, 44, 14, B)
        cv.text(x + 3, y + 3, "B%d" % (i + 1), W if on else DG)
        cv.text(x + 3, y + 9, name, W if on else GR)
    for y in range(15, 91, 4):
        cv.sprite(56, y, "RAIL")
    cv.sprite(54, 42, "LIFT")
    foot(cv, [("MIX", "100"), ("BPM", "120"), ("DRV", "0"), ("OUT", "0")])


def fx_page(cv, i, alg="ON"):
    name, on = TOWER[i]
    head(cv, name, dots=(8, i), alg=alg if on else "OFF", alg_col=KALG if on else DG)


@shot("fx-crush", "FX 1 CRUSH", "The lo-fi DAC: bits and sample rate down to the 4-bit volume-register 'digis' "
      "of the C64. The staircase is the crushed wave.")
def s_fx_crush(cv):
    fx_page(cv, 0)
    cv.frame(4, 16, 112, 72, DG)
    for i in range(108):
        v = math.sin(i / 108 * 2 * math.pi * 1.5)
        cv.pset(6 + i, 52 - int(v * 30), DG)
    step, q = 9, 5
    for i in range(0, 108, step):
        v = math.sin(i / 108 * 2 * math.pi * 1.5)
        y = 52 - int(round(v * q) / q * 30)
        cv.rect(6 + i, y, step, 2, K1)
    foot(cv, [("BITS", "5"), ("RATE", "8K"), ("JIT", "0"), ("MIX", "100")], lit=0)


@shot("fx-robot", "FX 2 ROBOT", "Ring modulator: a carrier fixed or following the key (KNOB 2), wobbled by its "
      "LFO. The robot's antenna sparks at the carrier's rate.")
def s_fx_robot(cv):
    fx_page(cv, 1)
    cv.sprite(18, 40, "ROBOT2")
    cv.sprite(18, 40 - 1, "ROBOT2")
    for k in range(5):
        cv.rect(23 + (k % 2) * 2 - 1, 36 - k * 3, 2, 2, [Y, W][k % 2])
    scope(cv, 40, 22, 74, 60, lambda t: math.sin(t * 2 * math.pi * 2) * math.sin(t * 2 * math.pi * 17), K1)
    foot(cv, [("FREQ", "440"), ("KEY", "ON"), ("LFO", "3"), ("MIX", "60")], lit=0)


@shot("fx-warp", "FX 3 WARP", "A short comb / flanger: the metallic 'teleporter' sound. The comb's teeth are "
      "its notches; feedback raises them.")
def s_fx_warp(cv):
    fx_page(cv, 2)
    cv.frame(4, 16, 112, 72, DG)
    for i in range(108):
        g = abs(math.cos(i / 108 * math.pi * 6)) ** 0.6
        h = int(g * 56) + 2
        cv.vline(6 + i, 86 - h, h, K1 if i % 2 == 0 else B)
    foot(cv, [("TIME", "3.1"), ("FB", "+70"), ("RATE", "8"), ("MIX", "50")], lit=1)


@shot("fx-glitch", "FX 4 GLITCH", "A beat-repeat in tempo: by chance (KNOB 2) a slice (KNOB 1) is caught and "
      "repeated, each repeat pitched (KNOB 3) like a cartridge game crashing.")
def s_fx_glitch(cv):
    fx_page(cv, 3)
    cv.frame(4, 16, 112, 72, DG)
    for i in range(14):
        x = 6 + i * 8
        caught = 4 <= i < 10
        cv.rect(x, 40 - (i - 4) * 2 if caught else 44, 7, 12, K1 if caught else DG)
    cv.text(8, 78, "1/16 X6", K1)
    foot(cv, [("LEN", "1/16"), ("CHNC", "25"), ("PTCH", "-1"), ("MIX", "100")], lit=0)


@shot("fx-chorus", "FX 5 CHORUS", "The detuned 'PAL' chorus: two delayed copies swaying apart.")
def s_fx_chorus(cv):
    fx_page(cv, 4)
    scope(cv, 4, 16, 112, 72, lambda t: math.sin(t * 2 * math.pi * 3), K1)
    scope(cv, 4, 16, 112, 72, lambda t: math.sin(t * 2 * math.pi * 3 + 0.6), K2, frame=False)
    foot(cv, [("RATE", "7"), ("DEP", "40"), ("WID", "100"), ("MIX", "40")], lit=1)


@shot("fx-echo", "FX 6 ECHO", "A tempo echo whose repeats darken and crumble (KNOB 3 LOFI), ping-ponged. The "
      "balls are the repeats.")
def s_fx_echo(cv):
    fx_page(cv, 5)
    cv.frame(4, 16, 112, 72, DG)
    for k in range(6):
        x = 10 + k * 18
        h = int(60 * 0.62 ** k)
        cv.rect(x, 84 - h, 6, 6, [W, LB, LB, B, B, DG][k])
        cv.vline(x + 2, 84 - h + 6, h - 6, DG)
    foot(cv, [("TIME", "1/8D"), ("FB", "62"), ("LOFI", "40"), ("MIX", "30")], lit=1)


@shot("fx-room", "FX 7 ROOM", "A small reverb: the room's size is drawn as the room.")
def s_fx_room(cv):
    fx_page(cv, 6)
    sz = 0.7
    w, h = int(100 * sz), int(64 * sz)
    x, y = 60 - w // 2, 52 - h // 2
    cv.frame(x, y, w, h, K1)
    cv.frame(x + 4, y + 4, w - 8, h - 8, B)
    cv.frame(x + 8, y + 8, w - 16, h - 16, DG)
    cv.sprite(56, y + h - 16 + 1, "AGENT_STAND")
    foot(cv, [("SIZE", "70"), ("DAMP", "50"), ("PRE", "10"), ("MIX", "25")], lit=0)


@shot("fx-tv", "FX 8 TV", "The family telly the C64 was plugged into: a small speaker's band, the 50 Hz hum "
      "and a little drive. Last in the chain.")
def s_fx_tv(cv):
    fx_page(cv, 7)
    cv.frame(16, 17, 88, 64, GR)
    cv.frame(17, 18, 86, 62, DG)
    for y in range(20, 78, 2):
        cv.hline(19, y, 64, B)
    cv.rect(19, 20, 64, 58, B)
    for y in range(21, 78, 2):
        cv.hline(19, y, 64, LB)
    cv.text(28, 44, "READY.", W)
    cv.rect(88, 24, 10, 10, DG)
    cv.rect(88, 40, 10, 2, GR)
    cv.rect(88, 46, 10, 2, GR)
    cv.rect(40, 82, 40, 4, DG)
    foot(cv, [("TONE", "40"), ("HUM", "10"), ("DRV", "20"), ("MIX", "100")], lit=1)


@shot("browse", "PRESETS", "PRESETS (the knob) searches the terminals: every detent loads and plays the preset; "
      "OCT+ keeps it, OCT- puts back what you had. B1..B4 filter (ALL / SID / VOX / USER).")
def s_browse(cv):
    popup_frame(cv, Y)
    cv.text(4, 4, "SEARCH", Y, BIG)
    cv.text(58, 5, "ALL SID VOX USR", GR)
    cv.rect(58, 11, 15, 1, Y)
    names = ["14 DRUM KIT", "15 RESO PAD", "16 BP SWEEP", "17 INTRUDER", "18 DENIED", "19 COUNTDOWN"]
    for i, n in enumerate(names):
        y = 16 + i * 14 if i < 3 else 16 + i * 14 + 14
        if i == 3:
            continue
        cv.text(10, y + 3, n, DG if abs(i - 3) == 2 else GR)
    cv.rect(4, 58, 112, 18, K)
    cv.frame(4, 58, 112, 18, LG)
    cv.sprite(7, 61, "ICON_VOX")
    cv.text(20, 62, "17 INTRUDER", LG, BIG)
    for k in range(10):   # the search: a lit bar
        cv.rect(20 + k * 9, 72, 7, 2, LG if k < 7 else DG)
    back_ok(cv, "BACK", "LOAD")


@shot("save", "SAVE / NAME", "SAVE: the typewriter. The 27 keys are letters (B1..B11 = A..K, the white keys "
      "L..Z and space; SHIFT: digits). ALGORITHM moves the cursor, PRESETS rolls a villainous name. SAVE again "
      "or OCT+ stores it.")
def s_save(cv):
    popup_frame(cv, LG)
    cv.text(4, 4, "SAVE 33", LG, BIG)
    cv.sprite(108, 3, "ICON_DISK")
    name = "DOOMSDAY"
    for i in range(12):
        x = 6 + i * 9
        ch = name[i] if i < len(name) else ""
        if i == len(name):
            cv.rect(x, 22, 8, 10, W)
        elif ch:
            cv.text(x, 23, ch, W, BIG)
        cv.rect(x, 33, 8, 1, DG)
    labels = "ALBMCNDEOFPGQHRISJTKUVWXYZ_"
    keys = [0] * 27
    # map: black keys A..K, white keys L..Z and space
    WK = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26]
    BK = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25]
    lab = [""] * 27
    for i, k in enumerate(BK):
        lab[k] = "ABCDEFGHIJK"[i]
    for i, k in enumerate(WK):
        lab[k] = "LMNOPQRSTUVWXYZ_"[i]
    keybed(cv, 42, held=(9,), lit_col=LG, labels=lab, h=30)
    cv.text(4, 78, "SLOT 33 NEW", GR)
    cv.text(70, 78, "ROLL: PRESETS", DG)
    back_ok(cv, "BACK", "SAVE")
    del labels, keys


@shot("takeover", "Takeover", "A knob whose value the page doesn't show takes the screen for a second (FIZZ's "
      "rule): its name in its colour, the value in the BIG font at 2x, the neighbours of a list beside it.")
def s_takeover(cv):
    cv.rect(2, 2, 4, 4, K4)
    cv.text(9, 2, "KNOB 4  FILTER", K4)
    cv.dots(0, 10, 120, DG)
    cv.ctext(60, 26, "BP", DG, BIG)
    s = "LP"
    big2(cv, 60 - big2_w(s) // 2, 44, s, K4)
    cv.ctext(60, 70, "HP", DG, BIG)
    cv.ctext(60, 100, "CUTOFF 1100", GR)


@shot("confirm", "Confirmation", "One word, never a sentence, and the voice says it when VOICE PROMPTS is on.")
def s_confirm(cv):
    cv.sprite(52, 26, "ICON_DISK")
    s = "SAVED"
    big2(cv, 60 - big2_w(s) // 2, 50, s, LG, shadow=DG)
    cv.ctext(60, 74, "33 DOOMSDAY", W)


@shot("arm", "Arm, then confirm", "Destructive actions arm first: the head turns red, the key blinks, the "
      "second press in two seconds does it. Here: SHIFT + B11 in the browser, delete a user preset.")
def s_arm(cv):
    popup_frame(cv, R)
    cv.rect(2, 2, 116, 12, R)
    cv.text(4, 4, "DELETE?", W, BIG)
    cv.sprite(100, 4, "ICON_SKULL")
    cv.ctext(60, 40, "33 DOOMSDAY", W, BIG)
    cv.ctext(60, 56, "PRESS B11 AGAIN", LR)
    for k in range(5):
        cv.rect(20 + k * 17, 72, 12, 4, R if k < 3 else DG)
    back_ok(cv, "KEEP", "DELETE")


@shot("shift", "SHIFT", "GLO held: the black keys' shortcuts drawn where the keys are. Same on every page.")
def s_shift(cv):
    head(cv, "SHIFT", col=Y)
    icons = ["ICON_SID", "ICON_VOX", "ICON_FX", "ICON_NOTE", "ICON_KEY", "ICON_LOCK", "ICON_DISK", "ICON_SKULL"]
    words = ["SID", "VOX", "FX", "OCT", "MIDI", "LOCK", "INIT", "PANIC"]
    for i in range(8):
        col, row = i % 4, i // 4
        x, y = 4 + col * 29, 16 + row * 28
        cv.frame(x, y, 26, 24, DG)
        cv.sprite(x + 8, y + 3, icons[i])
        cv.ctext(x + 13, y + 15, words[i], W)
        cv.text(x + 2, y + 2, "%d" % (i + 1), GR)
    keybed(cv, 72, held=(1, 3, 5, 8, 10, 13, 15, 17), lit_col=Y, h=20)
    cv.ctext(60, 112, "PLAY: LATCH   REC: BLE", GR)


@shot("settings", "SETTINGS", "HOME held: the global settings, a pop-up of four rows, a row per knob (colour = "
      "knob); SELECT turns its pages.")
def s_settings(cv):
    popup_frame(cv, GR)
    cv.text(4, 4, "SETTINGS", W, BIG)
    cv.text(84, 5, "1/3", GR)
    rows = [("MIDI CH", "OMNI"), ("BLUETOOTH", "ON"), ("VOICE PROMPTS", "ON"), ("VELOCITY", "SOFT")]
    for i, (lab, val) in enumerate(rows):
        y = 18 + i * 22
        cv.rect(6, y + 2, 7, 7, KNOB_COL[i])
        cv.text(8, y + 3, str(i + 1), K)
        cv.text(17, y + 3, lab, GR)
        cv.rtext(114, y + 1, val, KNOB_COL[i], BIG)
        cv.dots(6, y + 15, 108, DG)
    back_ok(cv, "BACK", "DONE")


def main():
    OUT.mkdir(exist_ok=True)
    for f in OUT.glob("*.png"):
        f.unlink()
    for i, (name, title, note, fn) in enumerate(shots):
        cv = Canvas()
        fn(cv)
        cv.save(OUT / f"{i + 1:02d}-{name}.png")
    (OUT / "index.txt").write_text("".join(f"{i + 1:02d}-{n}\t{t}\t{d}\n" for i, (n, t, d, _) in enumerate(shots)))
    print(f"{len(shots)} screens -> {OUT}")


if __name__ == "__main__":
    main()
