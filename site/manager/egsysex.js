// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's own SysEx (core/app/fizz_sx.h, docs/SYSEX.md), the host side: the frames the manager sends the unit and
// its replies read. Adapted from FIZZ's site/js/fizz_sysex.js (MPL-2.0): the protocol is FIZZ's, byte for byte, under
// EvilGenius's id F0 7D 45 47 01 (FIZZ's 7D 46 5A: neither answers the other's). The sound is SID TONE's 128-byte
// blob ('S', version 2: egsound.js), so a STORE is always the STORE6 frame. Pure: no DOM, no Node APIs.
//
//   identity()                        IDENTITY (01 -> 41 <protocol> <text>)
//   storeSound({name, blob, drive, pool, slot, batch, track, pan, chorus, delay, reverb, tags, audition, own, extras})
//                                     STORE6 (11 -> 50): a sound into MY PRESETS (pool false; slot 1..nlib, 0 the first
//                                     free) or the project's POOL (pool true: 1..128); track 0..5: LOAD onto it too;
//                                     audition (with track): onto the track only, nothing stored
//   listRequest({factory, pool}) / parseList     LIST (21 -> 61, in parts)
//   dumpRequest({source, slot}) / parseDump      DUMP (22 -> a STORE6 with the DUMP flag): "mine", "factory", "pool",
//                                     "track" (slot 1..6, 0 the selected one: its extras too)
//   trackFrame(dump), restoreFrame(dump, {slot})  a DUMP sent back: onto its track (AUDITION), or stored again
//   statusRequest / parseStatus       STATUS (02 -> 42): playing, project, pattern, the store's use, the package
//   flushRequest                      FLUSH (03)
//   tagsRequest, renameRequest, deleteRequest, swapRequest, poolRefRequest, usersRequest / parseUsers,
//   projectsRequest / parseProjects, projectRequest({op: load | new | copy | delete, p, q}), parseAck (52)
//   paramRequest({track, id, value, ack})   PARAM (30): one value of a track's sound, as a knob on the unit. id is ONE
//                                     7-bit byte: the sound's values 0..QD_QUAD_NP-1 and the mix's PAN DELAY REVERB CHORUS
//                                     LEVEL (MIX_ID); CRUSH .. TV (124..128) are out of its reach
//   browseRequest({track, id})        BROWSE (31): the unit's own sound browser at preset id
//   labelsRequest / parseLabels       LABELS (20 -> 60)
//   parseReply(bytes)                 any reply -> {kind: identity | store | error | labels | list | dump | ack |
//                                     status | users | projects, ..} | null (not EvilGenius's, a bad checksum)
//   usbPackets(frame)                 the frame as USB-MIDI packets (the browser build's midi in)
export const EG_HEADER = [0x7d, 0x45, 0x47];
export const EG_PROTOCOL = 1;
export const CMD = { IDENTITY: 0x01, STORE: 0x10, STORE6: 0x11, LABELS: 0x20, LIST: 0x21, DUMP: 0x22, PARAM: 0x30, BROWSE: 0x31 };   // (E1, P1.6l, P1.6m, P2-B, fixes)
export const REPLY = { IDENTITY: 0x41, STORE: 0x50, LABELS: 0x60, LIST: 0x61, ERROR: 0x7f };
export const SOURCES = ["mine", "factory", "pool"];    // P1.6m: LIST / DUMP's sources
export const SOURCE_TRACK = 4;                           // Manager P2-B: DUMP's source: a track's sound
export const XTRA_LEN = 8;                               // .. its extras' bytes (after the tags byte)
// P1.6l: the labels' order (docs/SYSEX.md): the knobs, the 14 buttons (the FM-1's panel labels), W1..W16, B1..B11
export const LABEL_KNOBS = ["SELECT", "ALGORITHM", "PRESETS", "K1", "K2", "K3", "K4", "MASTER"];
export const LABEL_BUTTONS = ["FX", "TRACKS", "MIX", "LATCH", "EDIT", "SHIFT", "HOME", "SOUNDS", "FILL", "PATTERNS", "PLAY",
  "REC", "F1", "F2"];
export const LABELS_N = LABEL_KNOBS.length + LABEL_BUTTONS.length + 16 + 11;   // 49
export const FLAGS = { POOL: 0x01, BATCH: 0x02, LOAD: 0x04, DUMP: 0x08, AUDITION: 0x10, OWN: 0x20 };   // (P1.6m: DUMP: a dump's
// reply, ignored as it is; P2-B: AUDITION onto the track only, OWN the owner's preset)
export const MIX = { PAN: 0x01, CHORUS: 0x02, DELAY: 0x04, REVERB: 0x08 };
export const STATUS = ["OK", "FULL", "BAD LENGTH", "BAD CHECKSUM", "BAD PATCH", "BAD SLOT", "BAD VERSION", "BAD COMMAND",
  "BUSY", "NOT FOUND", "IN USE", "BAD TRACK"];   // (8..11: the web manager's Phase 1)
// the web manager's Phase 1 (docs/SYSEX.md): its commands, replies, sources, PROJECT's ops, STATUS's flags
export const CMD1 = { STATUS: 0x02, FLUSH: 0x03, TAGS: 0x12, RENAME: 0x13, DELETE: 0x14, SWAP: 0x15, POOLREF: 0x16,
  USERS: 0x17, PROJECTS: 0x23, PROJECT: 0x24 };
export const REPLY1 = { STATUS: 0x42, ACK: 0x52, USERS: 0x57, PROJECTS: 0x63 };
export const ST = { OK: 0, FULL: 1, BAD_LENGTH: 2, BAD_SLOT: 5, BAD_COMMAND: 7, BUSY: 8, NOT_FOUND: 9, IN_USE: 10, BAD_TRACK: 11 };
export const PROJECT_OPS = ["", "load", "new", "copy", "delete"];
export const SOURCE_PROJECT = 3;
export const NAME_LEN = 12, BLOB_LEN = 128;
// PARAM's ids for the track's mix (core/seq/pattern.h QD_LK_*: after the sound's QD_QUAD_NP = 119 values)
export const MIX_ID = { PAN: 119, DELAY: 120, REVERB: 121, CHORUS: 122, LEVEL: 123 };
// the tags (core/seq/sounds.h QD_PK_*, sounds.c qd_preset_kind_name), bit k: the STORE's optional tags byte
export const TAGS = ["BASS", "KEYS", "PLUCK", "PAD", "LEAD", "DRUMS", "FX"];
export const tagMask = (tags) => typeof tags === "number" ? tags & 0x7f
  : Array.isArray(tags) ? tags.reduce((m, t) => m | (TAGS.includes(String(t).toUpperCase()) ? 1 << TAGS.indexOf(String(t).toUpperCase()) : 0), 0) : 0;

export function pack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const g = bytes.slice(i, i + 7);
    let hi = 0;
    g.forEach((b, j) => { hi |= ((b >> 7) & 1) << j; });
    out.push(hi, ...Array.from(g, (b) => b & 0x7f));
  }
  return out;
}
export function unpack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; ) {
    const hi = bytes[i++];
    for (let j = 0; j < 7 && i < bytes.length; j++) out.push(bytes[i++] | (((hi >> j) & 1) << 7));
  }
  return Uint8Array.from(out);
}
const checksum = (bytes) => (0x80 - (bytes.reduce((s, b) => s + b, 0) & 0x7f)) & 0x7f;
function frame(cmd, body) {
  const b = [cmd, ...body];
  return Uint8Array.from([0xf0, ...EG_HEADER, EG_PROTOCOL, ...b, checksum(b), 0xf7]);
}

export const identity = () => frame(CMD.IDENTITY, []);

// a sound into MY PRESETS (pool false; slot 1..nlib, 0 the first free) or the project's POOL (pool true; slot 1..128, 0
// the first free: a MY preset referenced there). blob: SID TONE's 128-byte sound (egsound.js blobOf); drive 0..127 (the
// mix's DRIVE byte, kept for the frame's layout). batch: joins the previous import's undo level. pan (-64..63), chorus,
// delay, reverb (0..127): whichever are given go with the preset, and with track 0..5 (LOAD) onto that track of the
// pattern playing too. tags: a mask or names of TAGS; none or 0: the unit's classifier decides.
export function storeSound({ name = "", blob, drive = 0, pool = false, slot = 0, batch = false, track = -1, pan, chorus,
                             delay, reverb, tags, audition = false, own = false, extras = null } = {}) {
  if (!(blob instanceof Uint8Array) || blob.length !== BLOB_LEN || blob[0] !== 0x53)
    throw new Error("blob: SID TONE's 128-byte sound ('S')");
  if (!(slot >= 0 && slot <= (pool ? 128 : 256))) throw new Error(`slot: 0 (the first free) .. ${pool ? 128 : 256}`);
  const nm = Array.from({ length: NAME_LEN }, (_, i) => {
    const c = i < name.length ? name.charCodeAt(i) : 0x20;
    return c >= 0x20 && c <= 0x7e ? c : 0x3f;
  });
  const load = track >= 0 && track <= 5;
  const mask = (pan !== undefined ? MIX.PAN : 0) | (chorus !== undefined ? MIX.CHORUS : 0) |
               (delay !== undefined ? MIX.DELAY : 0) | (reverb !== undefined ? MIX.REVERB : 0);   // (P1.5x: LOAD or not)
  const tm = tagMask(tags);
  const c7 = (v) => Math.max(0, Math.min(127, Math.round(v || 0)));
  const flags = (pool ? FLAGS.POOL : 0) | (batch ? FLAGS.BATCH : 0) | (load ? FLAGS.LOAD : 0) | (audition && load ? FLAGS.AUDITION : 0) |
    (own ? FLAGS.OWN : 0);
  const xt = audition && load && extras ? extrasBytes(extras) : null;   // (P2-B: the tags byte then the track's extras)
  return frame(CMD.STORE6, [flags, (slot >> 7) & 0x7f, slot & 0x7f, ...nm, c7(drive), load ? track : 0,
                           c7((pan === undefined ? 0 : pan) + 64), c7(chorus), c7(delay), c7(reverb), mask,
                           ...pack7(blob), ...(tm || xt ? [tm] : []), ...(xt || [])]);
}

// P2-B: a track's extras as bytes ({id, sound, edited}), and PARAM
const extrasBytes = (x) => [(x.id >> 14) & 0x7f, (x.id >> 7) & 0x7f, x.id & 0x7f, (x.sound >> 7) & 0x7f, x.sound & 0x7f, x.edited ? 1 : 0, 0, 0];
export function paramRequest({ track = "selected", id, value, ack = false }) {
  const t = track === "selected" ? 127 : track, v = (Math.round(value) + (1 << 20)) >>> 0;
  return frame(CMD.PARAM, [t & 0x7f, id & 0x7f, (v >> 14) & 0x7f, (v >> 7) & 0x7f, v & 0x7f, ack ? 1 : 0]);
}

// Manager fixes: BROWSE: the unit's browser on track (0..5, "selected") at preset id (3 x 7 bits)
export function browseRequest({ track = "selected", id }) {
  const t = track === "selected" ? 127 : track;
  return frame(CMD.BROWSE, [t & 0x7f, (id >> 14) & 0x7f, (id >> 7) & 0x7f, id & 0x7f]);
}

export const labelsRequest = ({ subscribe = false } = {}) => frame(CMD.LABELS, [subscribe ? 1 : 0]);

export function parseLabels(bytes) {
  const b = Array.from(bytes);
  if (b.length < 10 || b[0] !== 0xf0 || b[b.length - 1] !== 0xf7 || b[1] !== 0x7d || b[2] !== 0x45 || b[3] !== 0x47 ||
      b[5] !== REPLY.LABELS) return null;
  if (b.slice(5, -1).reduce((s, x) => s + x, 0) & 0x7f) return null;
  const count = (b[6] << 7) | b[7], n = b[8], list = [];
  let o = 9;
  for (let i = 0; i < n && o < b.length - 2; i++) {
    const len = b[o++];
    list.push(String.fromCharCode(...b.slice(o, o + len)));
    o += len;
  }
  if (list.length !== n) return null;
  const at = (k) => list[k] || "";
  const nk = LABEL_KNOBS.length, nb = LABEL_BUTTONS.length;
  return { count, list,
    knobs: Object.fromEntries(LABEL_KNOBS.map((k, i) => [k, at(i)])),
    buttons: Object.fromEntries(LABEL_BUTTONS.map((k, i) => [k, at(nk + i)])),
    white: Array.from({ length: 16 }, (_, i) => at(nk + nb + i)),
    black: Array.from({ length: 11 }, (_, i) => at(nk + nb + 16 + i)) };
}

// ---- P1.6m: LIST, DUMP
export const listRequest = ({ factory = false, pool = false } = {}) => frame(CMD.LIST, [(factory ? 1 : 0) | (pool ? 2 : 0)]);
export const dumpRequest = ({ source = "mine", slot = 0 } = {}) => {
  const src = source === "track" ? SOURCE_TRACK : SOURCES.indexOf(source);
  if (src < 0) throw new Error(`source: one of ${SOURCES.join(", ")}`);
  return frame(CMD.DUMP, [src, (slot >> 7) & 0x7f, slot & 0x7f]);
};
const sumOk = (b) => !(b.slice(5, -1).reduce((s, x) => s + x, 0) & 0x7f);
const isEg = (b) => b.length >= 8 && b[0] === 0xf0 && b[b.length - 1] === 0xf7 && b[1] === 0x7d && b[2] === 0x45 && b[3] === 0x47;
export function parseList(bytes) {
  const b = Array.from(bytes);
  if (!isEg(b) || b[5] !== REPLY.LIST || !sumOk(b)) return null;
  const entries = [];
  for (let e = 0, o = 11; e < b[10] && o + 20 <= b.length - 2; e++, o += 20)
    entries.push({ source: SOURCES[b[o]] || String(b[o]), slot: (b[o + 1] << 7) | b[o + 2],
      id: (b[o + 3] << 14) | (b[o + 4] << 7) | b[o + 5], name: String.fromCharCode(...b.slice(o + 6, o + 18)).trimEnd(),
      tags: b[o + 18], imported: !!(b[o + 19] & 1), inPool: !!(b[o + 19] & 2) });
  return { part: b[6], last: !!b[7], total: (b[8] << 7) | b[9], entries };
}
export function parseDump(bytes) {
  const b = Array.from(bytes);
  if (!isEg(b) || (b[5] !== CMD.STORE && b[5] !== CMD.STORE6) || !sumOk(b) || !(b[6] & FLAGS.DUMP)) return null;
  const six = b[5] === CMD.STORE6, n7 = six ? 147 : 110, body = b.slice(6, -2);
  const blob = unpack7(body.slice(22, 22 + n7));
  const x = body.length >= 22 + n7 + 1 + XTRA_LEN ? body.slice(22 + n7 + 1) : null, load = !!(body[0] & FLAGS.LOAD);
  return { source: load ? "track" : body[0] & FLAGS.POOL ? "pool" : "mine", slot: load ? body[16] + 1 : (body[1] << 7) | body[2],
    name: String.fromCharCode(...body.slice(3, 15)).trimEnd(), drive: body[15], pan: body[17] - 64, chorus: body[18],
    delay: body[19], reverb: body[20], tags: body.length > 22 + n7 ? body[22 + n7] : 0, blob, six, frame: Uint8Array.from(b),
    ...(load ? { track: body[16] } : {}),
    ...(x ? { extras: { id: (x[0] << 14) | (x[1] << 7) | x[2], sound: (x[3] << 7) | x[4], edited: !!(x[5] & 1), selected: !!(x[5] & 2),
      rec: !!(x[5] & 4), playing: !!(x[5] & 8), browse: !!(x[5] & 16), chan: x[6], sel: x[7] } } : {}) };
}
// P2-B: a track's DUMP as an AUDITION back onto that track: the track exactly as it was (its extras)
export function trackFrame(bytes) {
  const b = Array.from(bytes);
  b[6] = (b[6] & ~FLAGS.DUMP & 0x7f) | FLAGS.AUDITION | FLAGS.LOAD;
  b[b.length - 2] = (0x80 - (b.slice(5, -2).reduce((s, x) => s + x, 0) & 0x7f)) & 0x7f;
  return Uint8Array.from(b);
}
export function restoreFrame(bytes, { slot } = {}) {
  const b = Array.from(bytes);
  b[6] &= ~FLAGS.DUMP & 0x7f;
  if (slot !== undefined) { b[7] = (slot >> 7) & 0x7f; b[8] = slot & 0x7f; }
  b[b.length - 2] = (0x80 - (b.slice(5, -2).reduce((s, x) => s + x, 0) & 0x7f)) & 0x7f;
  return Uint8Array.from(b);
}

// ---- the web manager's Phase 1
const u14 = (v) => [(v >> 7) & 0x7f, v & 0x7f];
const srcOf = (source) => {
  const k = source === "project" ? SOURCE_PROJECT : SOURCES.indexOf(source);
  if (k < 0) throw new Error(`source: one of ${SOURCES.join(", ")}, project`);
  return k;
};
const r14 = (b, o) => (b[o] << 7) | b[o + 1];
export const statusRequest = () => frame(CMD1.STATUS, []);
export const flushRequest = () => frame(CMD1.FLUSH, []);
export const projectsRequest = () => frame(CMD1.PROJECTS, []);
export const tagsRequest = ({ source = "mine", slot, tags = 0 }) => frame(CMD1.TAGS, [srcOf(source), ...u14(slot), tagMask(tags)]);
export const renameRequest = ({ source = "mine", slot, name = "" }) => frame(CMD1.RENAME, [srcOf(source), ...u14(slot),
  ...Array.from({ length: NAME_LEN }, (_, i) => { const c = i < name.length ? name.charCodeAt(i) : 0x20; return c >= 0x20 && c <= 0x7e ? c : 0x3f; })]);
export const deleteRequest = ({ source = "mine", slot, confirm = false }) => frame(CMD1.DELETE, [srcOf(source), ...u14(slot), confirm ? 1 : 0]);
export const swapRequest = ({ source = "mine", a, b }) => frame(CMD1.SWAP, [srcOf(source), ...u14(a), ...u14(b)]);
export const poolRefRequest = ({ slot = 0, id = 0 }) => frame(CMD1.POOLREF, [...u14(slot), (id >> 14) & 0x7f, (id >> 7) & 0x7f, id & 0x7f]);
export const usersRequest = ({ source = "mine", slot }) => frame(CMD1.USERS, [srcOf(source), ...u14(slot)]);
export function projectRequest({ op, p, q = 0 }) {
  const k = PROJECT_OPS.indexOf(op);
  if (k < 1) throw new Error("op: load, new, copy or delete");
  return frame(CMD1.PROJECT, [k, p, q]);
}
const body1 = (bytes, kind) => {
  const b = Array.from(bytes);
  return isEg(b) && b[5] === kind && sumOk(b) ? b : null;
};
export function parseAck(bytes) {
  const b = body1(bytes, REPLY1.ACK);
  return b && b.length >= 14 ? { command: b[6], status: b[7], statusName: STATUS[b[7]], a: r14(b, 8), b: r14(b, 10) } : null;
}
export function parseStatus(bytes) {
  const b = body1(bytes, REPLY1.STATUS);
  if (!b || b.length < 30) return null;
  const f = b[8];
  return { protocol: b[6], tracks: b[7], playing: !!(f & 1), noStore: !!(f & 2), dirty: !!(f & 4), job: !!(f & 8), demo: !!(f & 16),
    rec: !!(f & 32), browse: !!(f & 64), project: b[9] + 1, pattern: b[10], projects: b[11], mine: r14(b, 12), pool: r14(b, 14),
    written: (b[16] << 14) | r14(b, 17), lib: [r14(b, 19), r14(b, 21)], prj: [r14(b, 23), r14(b, 25)], jobCommand: b[27],
    ...(b.length >= 31 ? { sel: b[28] } : {}),
    // the package (docs/SYSEX.md "The package"): the Bluetooth one appends its byte, its projects, its MY PRESETS'
    // places; a reply without them is the USB package's (8 and 256)
    ...(b.length >= 35 && b[29] & 1 ? { package: "ble", nproj: b[30], nlib: r14(b, 31) } : { package: "usb", nproj: 8, nlib: 256 }) };
}
export function parseUsers(bytes) {
  const b = body1(bytes, REPLY1.USERS);
  if (!b || b.length < 12) return null;
  const n = b[9], projects = [];
  for (let i = 0, o = 10; i < n && o + 3 <= b.length - 2; i++, o += 3) projects.push({ project: b[o] + 1, steps: r14(b, o + 1) });
  return { source: SOURCES[b[6]] || String(b[6]), slot: r14(b, 7), projects, tracks: b[10 + 3 * n] || 0 };
}
export function parseProjects(bytes) {
  const b = body1(bytes, REPLY1.PROJECTS);
  if (!b || b.length < 10) return null;
  const list = [];
  for (let p = 0, o = 8; p < b[7] && o + 15 <= b.length - 2; p++, o += 15)
    list.push({ slot: p + 1, there: !!(b[o] & 1), current: !!(b[o] & 2), demo: !!(b[o] & 4),
      name: String.fromCharCode(...b.slice(o + 1, o + 13)).trimEnd(), pages: r14(b, o + 13) });
  return { current: b[6] + 1, list };
}

export function parseReply(bytes) {
  const b = Array.from(bytes);
  if (b.length < 8 || b[0] !== 0xf0 || b[b.length - 1] !== 0xf7 || b[1] !== 0x7d || b[2] !== 0x45 || b[3] !== 0x47)
    return null;
  const body = b.slice(5, -1);
  if (body.reduce((s, x) => s + x, 0) & 0x7f) return null;
  const [kind, ...rest] = body.slice(0, -1);
  if (kind === REPLY.IDENTITY) return { kind: "identity", protocol: rest[0], version: String.fromCharCode(...rest.slice(1)) };
  if (kind === REPLY.STORE)
    return { kind: "store", status: rest[0], statusName: STATUS[rest[0]], pool: rest[1] === 1, slot: (rest[2] << 7) | rest[3] };
  if (kind === REPLY.ERROR) return { kind: "error", status: rest[0], statusName: STATUS[rest[0]], command: rest[1] };
  if (kind === REPLY.LABELS) return { kind: "labels", ...parseLabels(bytes) };
  if (kind === REPLY.LIST) return { kind: "list", ...parseList(bytes) };
  if ((kind === CMD.STORE || kind === CMD.STORE6) && (rest[0] & FLAGS.DUMP)) return { kind: "dump", ...parseDump(bytes) };
  if (kind === REPLY1.ACK) return { kind: "ack", ...parseAck(bytes) };
  if (kind === REPLY1.STATUS) return { kind: "status", ...parseStatus(bytes) };
  if (kind === REPLY1.USERS) return { kind: "users", ...parseUsers(bytes) };
  if (kind === REPLY1.PROJECTS) return { kind: "projects", ...parseProjects(bytes) };
  return null;
}

// a SysEx frame as USB-MIDI event packets (cable 0): CIN 4 three bytes that go on, CIN 5 / 6 / 7 the last one, two,
// three bytes ending at F7; each packet a u32: CIN | b0 << 8 | b1 << 16 | b2 << 24 (FM1VST's fm1core midi_in)
export function usbPackets(f) {
  const out = [];
  for (let i = 0; i < f.length; i += 3) {
    const k = Math.min(3, f.length - i), end = i + k >= f.length && f[f.length - 1] === 0xf7;
    const cin = end ? 4 + k : 4;
    out.push((cin | (f[i] << 8) | ((k > 1 ? f[i + 1] : 0) << 16) | ((k > 2 ? f[i + 2] : 0) << 24)) >>> 0);
  }
  return out;
}
