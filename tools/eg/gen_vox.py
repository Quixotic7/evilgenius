#!/usr/bin/env python3
"""EvilGenius's words: each spoken, trimmed, squeezed (the way the 1980s' speech digis were: loud and compressed,
so four bits stay intelligible), resampled to VOX_FS and quantised to 4-bit values for the SID's volume register,
two to a byte. Writes core/voice/sid/eg_vox_data.h.

  tools/eg/gen_vox.py --sam PATH        (the default) SAM speaks them: the Software Automatic Mouth, the C64's own
                                        speech synthesizer (1982), as s-macke/SAM's C port (github.com/s-macke/SAM).
                                        PATH is a `sam` built from your checkout without SDL:
                                          cc -O2 -o sam src/reciter.c src/sam.c src/render.c src/main.c src/debug.c
                                        (or $SAM_BIN, or `sam` on the PATH; core/voice/sam has the same code,
                                        changed for the firmware: README.md there). Each word is
                                        given in SAM's phonetic alphabet with its stress (PHONETIC below: the reciter's
                                        own guesses miss GENIUS, EVIL, AGENT ..); --sam-text uses the reciter instead.
                                        The voice: --speed 72 --pitch 64 --throat 128 --mouth 128 (SAM's own)
  tools/eg/gen_vox.py --tts say         the system's speech (macOS `say`, voice --voice) or espeak-ng (--tts espeak)
                                        (macOS's voices are for personal use: not for the released words)
  tools/eg/gen_vox.py --src DIR         your own recordings instead: DIR/<word in lower case, spaces as _>.wav
                                        (8- or 16-bit PCM, any rate), e.g. DIR/self_destruct.wav

The words, their order and their banks are WORDS below (the firmware's word numbers): add a word at the end of
its bank, regenerate, rebuild."""
import argparse
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
VOX_FS = 6000            # the words' sample rate (the games' 4-8 kHz)

# (bank, word); the banks are the browser's and the WORD knob's groups
WORDS = [
    ("SPY", "INTRUDER"), ("SPY", "ALERT"), ("SPY", "WARNING"), ("SPY", "DANGER"), ("SPY", "SECURITY"),
    ("SPY", "AGENT"), ("SPY", "ENEMY"), ("SPY", "TARGET"), ("SPY", "MISSION"), ("SPY", "ESCAPE"),
    ("LAB", "COMPUTER"), ("LAB", "SYSTEM"), ("LAB", "ERROR"), ("LAB", "ACCESS"), ("LAB", "DENIED"),
    ("LAB", "GRANTED"), ("LAB", "PASSWORD"), ("LAB", "TERMINAL"), ("LAB", "PROGRAM"), ("LAB", "DATA"),
    ("DOOM", "DESTROY"), ("DOOM", "LASER"), ("DOOM", "POWER"), ("DOOM", "OVERLOAD"), ("DOOM", "ACTIVATE"),
    ("DOOM", "LAUNCH"), ("DOOM", "COUNTDOWN"), ("DOOM", "SELF DESTRUCT"), ("DOOM", "ROBOT"), ("DOOM", "ATTACK"),
    ("COUNT", "ZERO"), ("COUNT", "ONE"), ("COUNT", "TWO"), ("COUNT", "THREE"), ("COUNT", "FOUR"),
    ("COUNT", "FIVE"), ("COUNT", "SIX"), ("COUNT", "SEVEN"), ("COUNT", "EIGHT"), ("COUNT", "NINE"),
    ("COUNT", "TEN"),
    ("EVIL", "EVIL"), ("EVIL", "GENIUS"), ("EVIL", "HA HA HA"), ("EVIL", "WELCOME"), ("EVIL", "GOODBYE"),
    ("EVIL", "HELLO"), ("EVIL", "YES"), ("EVIL", "NO"), ("EVIL", "FOOLS"), ("EVIL", "OBEY"),
    ("SYS", "SAVED"), ("SYS", "LOADED"), ("SYS", "DELETED"),
]

# each word in SAM's phonetic alphabet (its manual): IY IH EH AE AA AH AO OH UH UX ER AX IX the vowels, EY AY OY AW OW
# UW the diphthongs, /H the H; a digit after a vowel its stress (4 ordinary, 3 strong, 5 tight)
PHONETIC = {
    "INTRUDER": "IHNTRUW4DER", "ALERT": "AXLER4T", "WARNING": "WAO4RNIHNX", "DANGER": "DEY4NJER",
    "SECURITY": "SIHKYUH4RIHTIY", "AGENT": "EY4JEHNT", "ENEMY": "EH4NAXMIY", "TARGET": "TAA4RGIHT",
    "MISSION": "MIH4SHUN", "ESCAPE": "EHSKEY4P",
    "COMPUTER": "KAHMPYUW4TER", "SYSTEM": "SIH4STAXM", "ERROR": "EH4RER", "ACCESS": "AE4KSEHS",
    "DENIED": "DIHNAY4D", "GRANTED": "GRAE4NTIXD", "PASSWORD": "PAE4SWERD", "TERMINAL": "TER4MIHNUL",
    "PROGRAM": "PROW4GRAEM", "DATA": "DEY4TAH",
    "DESTROY": "DIHSTROY4", "LASER": "LEY4ZER", "POWER": "PAW4ER", "OVERLOAD": "OW4VERLOWD",
    "ACTIVATE": "AE4KTIHVEYT", "LAUNCH": "LAO4NCH", "COUNTDOWN": "KAW4NTDAWN", "SELF DESTRUCT": "SEH4LF DIHSTRAH4KT",
    "ROBOT": "ROW4BAAT", "ATTACK": "AXTAE4K",
    "ZERO": "ZIY4ROW", "ONE": "WAH4N", "TWO": "TUW4", "THREE": "THRIY4", "FOUR": "FOH4R", "FIVE": "FAY4V",
    "SIX": "SIH4KS", "SEVEN": "SEH4VEHN", "EIGHT": "EY4T", "NINE": "NAY4N", "TEN": "TEH4N",
    "EVIL": "IY4VUL", "GENIUS": "JIY4NYAHS", "HA HA HA": "/HAA4 /HAA4 /HAA3", "WELCOME": "WEH4LKAHM",
    "GOODBYE": "GUHDBAY4", "HELLO": "/HEHLOW4", "YES": "YEH4S", "NO": "NOW4", "FOOLS": "FUW4LZ", "OBEY": "OWBEY4",
    "SAVED": "SEY4VD", "LOADED": "LOW4DIHD", "DELETED": "DIHLIY4TIHD",
}


def sam_bin(args):
    import os
    b = args.sam or os.environ.get("SAM_BIN") or shutil.which("sam")
    if not b or not Path(b).exists():
        raise SystemExit("gen_vox: no SAM: build s-macke/SAM (see the top of this file) and give --sam PATH")
    return b


def speak(word, args, tmp):
    out = Path(tmp) / "w.wav"
    if args.tts == "sam":
        voice = ["-speed", str(args.speed), "-pitch", str(args.pitch), "-throat", str(args.throat),
                 "-mouth", str(args.mouth)]
        if args.sam_text:
            cmd = [sam_bin(args), *voice, "-wav", str(out), word]
        else:
            cmd = [sam_bin(args), *voice, "-phonetic", "-wav", str(out), PHONETIC[word]]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    elif args.tts == "espeak":
        subprocess.run(["espeak-ng", "-v", args.voice or "en-us", "-s", str(args.rate), "-w", str(out), word],
                       check=True)
    else:
        subprocess.run(["say", "-v", args.voice or "Ralph", "-r", str(args.rate), "--file-format=WAVE",
                        "--data-format=LEI16@22050", "-o", str(out), word], check=True)
    return out


def read_wav(path):
    with wave.open(str(path)) as w:
        sw, n, ch, fs = w.getsampwidth(), w.getnframes(), w.getnchannels(), w.getframerate()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    elif sw == 1:                                 # (8-bit WAV is unsigned: SAM's)
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float64) - 128.0) / 128.0
    else:
        raise SystemExit(f"gen_vox: {path}: 8- or 16-bit PCM only")
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x - x.mean(), fs


def resample(x, fs_in, fs_out):
    """windowed-sinc, low-passed at 0.45 * the lower rate"""
    n_out = int(len(x) * fs_out / fs_in)
    cut = 0.45 * min(fs_in, fs_out) / fs_in
    taps = 32
    k = np.arange(-taps, taps + 1)
    y = np.zeros(n_out)
    for i in range(n_out):
        t = i * fs_in / fs_out
        c = int(t)
        idx = c + k
        ok = (idx >= 0) & (idx < len(x))
        d = t - idx[ok]
        h = 2 * cut * np.sinc(2 * cut * d) * (0.5 + 0.5 * np.cos(np.pi * d / (taps + 1)))
        y[i] = np.dot(x[idx[ok]], h)
    return y


def shape(x, fs, emph=0.6, squeeze=0.6):
    """trim the silence, pre-emphasise (consonants survive four bits), compress, normalise (SAM's voice was made for
    four bits already: lighter on both)"""
    env = np.convolve(np.abs(x), np.ones(int(fs * 0.01)) / int(fs * 0.01), mode="same")
    on = np.where(env > env.max() * 0.04)[0]
    if len(on):
        x = x[max(0, on[0] - int(fs * 0.01)):on[-1] + int(fs * 0.03)]
    x = np.append(x[0], x[1:] - emph * x[:-1])
    x = x / (np.abs(x).max() + 1e-9)
    x = np.sign(x) * np.abs(x) ** squeeze       # a hard compressor: quiet parts up
    return x / (np.abs(x).max() + 1e-9)


def quantise(x):
    """-1..1 -> 0..15 around 8, with a little TPDF dither, faded in and out (no step at either end)"""
    rng = np.random.default_rng(64)
    fade = min(len(x) // 4, int(VOX_FS * 0.01))
    if fade:
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade:] *= np.linspace(1, 0, fade)
    q = np.round(8 + x * 7.49 + (rng.random(len(x)) - rng.random(len(x))) * 0.5)
    return np.clip(q, 0, 15).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="a directory of your own recordings (WORD.wav)")
    ap.add_argument("--tts", choices=["sam", "say", "espeak"], default="sam")
    ap.add_argument("--sam", help="SAM's binary (s-macke/SAM, built without SDL; else $SAM_BIN or `sam`)")
    ap.add_argument("--sam-text", action="store_true", help="SAM's reciter reads the words (not PHONETIC)")
    ap.add_argument("--speed", type=int, default=72)
    ap.add_argument("--pitch", type=int, default=64)
    ap.add_argument("--throat", type=int, default=128)
    ap.add_argument("--mouth", type=int, default=128)
    ap.add_argument("--voice", default=None, help="the speech voice (say: Ralph; espeak: en-us)")
    ap.add_argument("--rate", type=int, default=120, help="words per minute")
    ap.add_argument("--out", default=str(ROOT / "core" / "voice" / "sid" / "eg_vox_data.h"))
    args = ap.parse_args()
    if not args.src and args.tts == "say" and not shutil.which("say"):
        raise SystemExit("gen_vox: no speech: install espeak-ng, or give --src DIR with your own recordings")
    banks = []
    for b, _ in WORDS:
        if b not in banks:
            banks.append(b)
    data, offs, lens = bytearray(), [], []
    with tempfile.TemporaryDirectory() as tmp:
        for bank, word in WORDS:
            if args.src:
                path = Path(args.src) / (word.lower().replace(" ", "_") + ".wav")
                if not path.exists():
                    raise SystemExit(f"gen_vox: {path}: missing")
            else:
                path = speak(word, args, tmp)
            x, fs = read_wav(path)
            x = shape(x, fs, 0.3, 0.8) if args.tts == "sam" and not args.src else shape(x, fs)
            q = quantise(resample(x, fs, VOX_FS))
            if len(q) & 1:
                q = np.append(q, 8)
            offs.append(len(data))
            lens.append(len(q))
            q = q.astype(np.uint8)
            data += bytes(((q[0::2] << 4) | q[1::2]).astype(np.uint8))
            print(f"  {bank:5s} {word:14s} {len(q) / VOX_FS:.2f} s")
    if args.src:
        src = "your recordings"
    elif args.tts == "sam":
        src = (f"SAM, the Software Automatic Mouth (s-macke/SAM's C port),\n * speed {args.speed} pitch {args.pitch} "
               f"throat {args.throat} mouth {args.mouth}, " + ("its reciter" if args.sam_text else "PHONETIC"))
    else:
        src = f"{args.tts} voice {args.voice or ('Ralph' if args.tts == 'say' else 'en-us')}"
    lines = [
        "/* generated by tools/eg/gen_vox.py: the words, 4-bit at VOX_FS, two to a byte (high nibble first);",
        f" * spoken by {src}. Do not edit: regenerate. */",
        "#pragma once",
        "#include <stdint.h>",
        f"#define VOX_FS {VOX_FS}u",
        f"#define VOX_NWORDS {len(WORDS)}u",
        f"#define VOX_NBANKS {len(banks)}u",
        "static const char *const VOX_BANK_NAME[VOX_NBANKS] = {" + ", ".join(f'"{b}"' for b in banks) + "};",
        "static const char *const VOX_WORD_NAME[VOX_NWORDS] = {",
        *[f'    "{w}",' for _, w in WORDS],
        "};",
        "/* each in SAM's phonetic alphabet: the firmware's SAM speaks them live in another voice (core/voice/sam) */",
        "static const char *const VOX_WORD_PHON[VOX_NWORDS] = {",
        *[f'    "{PHONETIC[w]}",' for _, w in WORDS],
        "};",
        "static const uint8_t VOX_WORD_BANK[VOX_NWORDS] = {" + ", ".join(str(banks.index(b)) for b, _ in WORDS) + "};",
        "static const uint32_t VOX_WORD_OFF[VOX_NWORDS] = {" + ", ".join(map(str, offs)) + "};",
        "static const uint32_t VOX_WORD_LEN[VOX_NWORDS] = {" + ", ".join(map(str, lens)) + "};   /* samples */",
        f"static const uint8_t VOX_DATA[{len(data)}] = {{",
    ]
    for i in range(0, len(data), 24):
        lines.append("    " + ",".join(f"0x{b:02X}" for b in data[i:i + 24]) + ",")
    lines.append("};")
    for i, (_, w) in enumerate(WORDS):
        lines.append(f"#define VOX_W_{w.replace(' ', '_')} {i}u")
    Path(args.out).write_text("\n".join(lines) + "\n")
    print(f"gen_vox: {len(WORDS)} words, {len(data)} B, {sum(lens) / VOX_FS:.1f} s -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
