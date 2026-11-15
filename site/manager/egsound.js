// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The sound editor's model: an EvilGenius sound as SID TONE's values (egvalues.js, generated from the core: names,
// ranges, texts), its name, tags and mix; read from a DUMP reply or a preset's 128-byte blob, packed back exactly as
// core/voice/quad/quad_voice.c qd_quad_pack does ('S', version 2: each value - min a byte, a range over 255 two, little
// end first; version 1 had no SAY: its five values take their defaults). A MIDI track's sound ("MIDI" in bytes
// 124..127: its 28 slots' values and CC numbers) is kept as it came (midi: true): the editor shows it, does not edit it.
// Adapted in spirit from FIZZ's site/manager/sound.js (MPL-2.0); FIZZ's FM values have no place here. No DOM.
//
//   NP, valuesOf(blob) -> values | null, blobOf(values) -> Uint8Array(128), defaults()
//   info(id) -> {id, name, min, max, def, rule, lockable, texts?}; text(id, v); clampV(id, v)
//   soundFromDump(parsed) -> sound | null   (egsysex.js parseDump's reply)
//   soundFromPreset({name, tags, blob, pan, sends}) -> sound   (egstore.js parsePreset's preset)
//   storeFrameOf(sound, opts) -> a STORE6 frame (egsysex.js storeSound: opts its pool, slot, track, audition ..)
//   SECTIONS: the editor's pages, each its rows of value ids (the unit's own pages: OSC, ENV, FILTER, AMP, GLIDE, VOX,
//   LFO, MOD, VOICE, SAY); MIX: the track's mix as PARAM ids (egsysex.js MIX_ID)
//   lfo(k, f), mod(k, f), destValue(d), destName(d)
import { VALUES, DESTS, DEST_ID, DEST_ORDER } from "./egvalues.js";
import { storeSound, MIX_ID, BLOB_LEN } from "./egsysex.js";

export const NP = VALUES.length;                         // QD_QUAD_NP (119)
export const MAGIC = 0x53, VERSION = 2;
const TAG_O = BLOB_LEN - 4, MIDI_TAG = [0x4d, 0x49, 0x44, 0x49];   // "MIDI"
export const ID = {                                      // quad_voice.h QD_QP_*
  W1: 0, C1: 1, F1: 2, PW1: 3, M1: 4, W2: 5, C2: 6, F2: 7, PW2: 8, M2: 9, W3: 10, C3: 11, F3: 12, PW3: 13, M3: 14,
  DETUNE: 15, EATK: 16, EDEC: 17, ESUS: 18, EREL: 19, E2A: 20, E2D: 21, E2S: 22, E2R: 23, E2LINK: 24,
  E3A: 25, E3D: 26, E3S: 27, E3R: 28, E3LINK: 29, HR: 30, FREQ: 31, RESO: 32, FTYPE: 33, FROUTE: 34, FDEPTH: 35,
  FKTRK: 36, FATK: 37, FDEC: 38, FSUS: 39, FREL: 40, CHIP: 41, LEVEL: 42, VEL: 43, DRIVE: 44, DRPRE: 45, BITS: 46,
  SRR: 47, CRPOST: 48, PORT: 49, PTIM: 50, PSLOPE: 51, WORD: 52, ROOT: 53, VSTART: 54, VEND: 55, VLOOP: 56,
  DBITS: 57, DHOLD: 58, DBOOST: 59, DLVL: 60, LFO0: 61, MOD0: 85, VMODE: 109, UNI: 110, UDET: 111, USPR: 112,
  VPRIO: 113, SAY: 114, SSPD: 115, SPIT: 116, STHR: 117, SMTH: 118,
};
export const LFO_F = ["SPEED", "MULT", "FADE", "DEST", "WAVE", "PHASE", "TRIG", "DEPTH"];   // QD_QL_*
export const lfo = (k, f) => ID.LFO0 + k * 8 + (typeof f === "string" ? LFO_F.indexOf(f) : f);
export const mod = (k, f) => ID.MOD0 + k * 3 + (typeof f === "string" ? ["SRC", "DST", "DEPTH"].indexOf(f) : f);
export const NMOD = 8, NLFO = 3;
export const MOD_SOURCES = VALUES[ID.MOD0][5];           // OFF VEL KEY MW AT PB BR RAND F ENV (QD_MS_*)
export const destValue = (d) => DEST_ID[d] ?? -1;
export const destName = (d) => DESTS[d] || "?";
export { DESTS, DEST_ORDER };

// the editor's pages: the unit's own (core/app/view.c), each a title and its rows of value ids
export const SECTIONS = [
  { key: "osc", title: "OSC", rows: [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [ID.DETUNE, ID.HR]],
    labels: ["OSC 1", "OSC 2", "OSC 3", ""] },
  { key: "env", title: "ENV", rows: [[16, 17, 18, 19], [20, 21, 22, 23, 24], [25, 26, 27, 28, 29]], labels: ["ENV 1 (AMP)", "ENV 2", "ENV 3"] },
  { key: "filter", title: "FILTER", rows: [[ID.FREQ, ID.RESO, ID.FTYPE, ID.FROUTE, ID.CHIP], [ID.FDEPTH, ID.FKTRK, ID.FATK, ID.FDEC, ID.FSUS, ID.FREL]],
    labels: ["FILTER", "FILTER ENV"] },
  { key: "amp", title: "AMP", rows: [[ID.LEVEL, ID.VEL], [ID.DRIVE, ID.DRPRE, ID.BITS, ID.SRR, ID.CRPOST], [ID.PORT, ID.PTIM, ID.PSLOPE]],
    labels: ["AMP", "DRIVE · CRUSH", "GLIDE"] },
  { key: "vox", title: "VOX", rows: [[ID.WORD, ID.ROOT, ID.VSTART, ID.VEND, ID.VLOOP], [ID.DBITS, ID.DHOLD, ID.DBOOST, ID.DLVL],
    [ID.SAY, ID.SSPD, ID.SPIT, ID.STHR, ID.SMTH]], labels: ["VOX", "DIGI", "SAY (SAM)"] },
  { key: "lfo", title: "LFO", rows: [0, 1, 2].map((k) => Array.from({ length: 8 }, (_, f) => lfo(k, f))), labels: ["LFO 1", "LFO 2", "LFO 3"] },
  { key: "mod", title: "MOD", rows: Array.from({ length: NMOD }, (_, k) => [mod(k, 0), mod(k, 1), mod(k, 2)]),
    labels: Array.from({ length: NMOD }, (_, k) => `MOD ${k + 1}`) },
  { key: "voice", title: "VOICE", rows: [[ID.VMODE, ID.UNI, ID.UDET, ID.USPR, ID.VPRIO]], labels: ["VOICE"] },
];
// the track's mix (not in the blob: the preset keeps it beside), as PARAM's ids
export const MIX = [
  { id: MIX_ID.PAN, key: "pan", name: "PAN", min: -64, max: 63, def: 0 },
  { id: MIX_ID.DELAY, key: "delay", name: "DELAY", min: 0, max: 127, def: 0 },
  { id: MIX_ID.REVERB, key: "reverb", name: "REVERB", min: 0, max: 127, def: 0 },
  { id: MIX_ID.CHORUS, key: "chorus", name: "CHORUS", min: 0, max: 127, def: 0 },
];
const mixOf = (id) => MIX.find((m) => m.id === id);

export function info(id) {
  const m = mixOf(id);
  if (m) return { id, name: m.name, min: m.min, max: m.max, def: m.def, rule: m.id === MIX_ID.PAN ? "pan" : "int", lockable: true };
  const v = VALUES[id];
  if (!v) return null;
  const [name, min, max, def, rule, ex, lockable] = v;
  return { id, name, min, max, def, rule, lockable: !!lockable, ...(rule === "list" ? { texts: ex } : { ex }) };
}
export function text(id, v) {
  const i = info(id);
  if (!i) return String(v);
  if (i.rule === "pan") return v === 0 ? "C" : v < 0 ? `L${-v}` : `R${v}`;
  if (i.rule === "list") return i.texts[v - i.min] ?? String(v);
  if (i.ex && i.ex[String(v)] !== undefined) return i.ex[String(v)];
  const a = Math.abs(v);
  switch (i.rule) {
    case "ofs": return v > 0 ? `+${v}` : String(v);
    case "c64": return v > 64 ? `+${v - 64}` : String(v - 64);
    case "fix2": return `${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
    case "fix2s": return `${v < 0 ? "-" : "+"}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
    default: return String(v);
  }
}
export function clampV(id, v) {
  const i = info(id);
  return i ? Math.max(i.min, Math.min(i.max, Math.round(v))) : v;
}
export const defaults = () => VALUES.map((v) => v[3]);
const span = (id) => VALUES[id][2] - VALUES[id][1];

export const isMidiBlob = (b) => !!b && b.length >= BLOB_LEN && MIDI_TAG.every((c, k) => b[TAG_O + k] === c);

// quad_voice.c qd_quad_unpack: the values, or null (not a SID TONE sound, a value out of its range)
export function valuesOf(blob) {
  if (!blob || blob.length < BLOB_LEN || blob[0] !== MAGIC || (blob[1] !== VERSION && blob[1] !== 1)) return null;
  const p = defaults();
  if (isMidiBlob(blob)) return p;                        // (a MIDI sound: its slots stay in the blob)
  const np = blob[1] === 1 ? ID.SAY : NP;
  for (let i = 0, o = 2; i < np; i++) {
    let x = blob[o++];
    if (span(i) > 255) x |= blob[o++] << 8;
    if (x > span(i)) return null;
    p[i] = x + VALUES[i][1];
  }
  return p;
}
// quad_voice.c qd_quad_pack: 'S' 2, each value - min (two bytes when its range is over 255), zeros after
export function blobOf(values) {
  const b = new Uint8Array(BLOB_LEN);
  b[0] = MAGIC; b[1] = VERSION;
  for (let i = 0, o = 2; i < NP; i++) {
    const x = clampV(i, values[i] ?? VALUES[i][3]) - VALUES[i][1];
    b[o++] = x & 255;
    if (span(i) > 255) b[o++] = x >> 8;
  }
  return b;
}

const sound = (o) => ({ name: o.name || "", tags: o.tags || 0, pan: o.pan || 0, chorus: o.chorus || 0, delay: o.delay || 0,
  reverb: o.reverb || 0, drive: o.drive || 0, blob: o.blob, midi: isMidiBlob(o.blob), values: valuesOf(o.blob),
  ...(o.extras ? { extras: o.extras } : {}), ...(o.track !== undefined ? { track: o.track } : {}),
  ...(o.source ? { source: o.source, slot: o.slot } : {}) });
export function soundFromDump(d) {
  if (!d || !d.blob || d.blob[0] !== MAGIC) return null;
  const s = sound(d);
  return s.values ? s : null;
}
export function soundFromPreset(p) {
  const blob = p.blob instanceof Uint8Array ? p.blob : Uint8Array.from(p.blob || []);
  const sends = p.sends || {};
  return sound({ ...p, blob, pan: p.pan ?? 0, chorus: p.chorus ?? sends.chorus, delay: p.delay ?? sends.delay, reverb: p.reverb ?? sends.reverb });
}
// the sound's 128 bytes now: its values packed (a MIDI sound: its blob as it came)
export const blobNow = (s) => (s.midi ? s.blob : blobOf(s.values));
export function storeFrameOf(s, opts = {}) {
  return storeSound({ name: s.name, blob: blobNow(s), drive: s.drive, tags: s.tags, pan: s.pan, chorus: s.chorus,
    delay: s.delay, reverb: s.reverb, ...opts });
}
// a value of the sound by id (the mix's too)
export function valueOf(s, id) {
  const m = mixOf(id);
  return m ? s[m.key] : s.values[id];
}
export function setValue(s, id, v) {
  const m = mixOf(id);
  v = clampV(id, v);
  if (m) s[m.key] = v; else s.values[id] = v;
  return v;
}
// the sound's routes: each LFO with a DEST and DEPTH off centre, each MOD slot with a SOURCE and DEST
export function routes(values) {
  const out = [];
  for (let k = 0; k < NLFO; k++) {
    const d = values[lfo(k, "DEST")];
    if (d) out.push({ kind: "lfo", k, dest: d, depth: values[lfo(k, "DEPTH")] - 64 });
  }
  for (let k = 0; k < NMOD; k++) {
    const src = values[mod(k, 0)], d = values[mod(k, 1)];
    if (src && d) out.push({ kind: "mod", k, src, dest: d, depth: values[mod(k, 2)] });
  }
  return out;
}
export const freeMod = (values) => {
  for (let k = 0; k < NMOD; k++) if (!values[mod(k, 0)] || !values[mod(k, 1)]) return k;
  return -1;
};
