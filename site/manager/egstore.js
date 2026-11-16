// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's store image read and written in the browser, without a unit: the reader half of core/store/store.c
// (the page store), the few record layouts of core/app/persist.c the manager needs, and a writer that puts MY PRESETS
// into an image. Adapted from FIZZ's site/manager/fizzstore.js (MPL-2.0). No DOM: tools/eg/manager_test.mjs runs it.
//
// THE IMAGE is the store's region as the unit gives it (the port's FZBI / FZBR; firmware/tools/fizz_xdata.py backup
// writes the same file): flash 0xAF000..0xDFFFF, 49 sectors of 4 KiB. Two page stores (core/app/persist.h, the
// Bluetooth package's, the only one EvilGenius ships):
//     sectors 0..10     MY PRESETS' (128 places, a record each, and the factory tags' record)
//     sectors 11..48    the projects' (4 projects: the settings, each project's header, patterns, pool)
// A sector's page 0 is its header: the magic ("EGB2" today: core/store/store.h QDS_MAGIC; the digit goes up when the
// patch format changes, and a firmware erases the sectors of another magic), the sector's sequence number u32, 5A5A
// and its complement. Pages 1..15 hold records. A page: key u32, the record's sequence u32, the page's index u16, the
// record's page count u16, its length u16 (FFFE a tombstone), CRC-16/CCITT-FALSE u16 over the header's 14 bytes and the
// 240-byte payload. A record's pages run on into the sector the log opened next; the highest sequence wins a key.
//
//   checkImage(bytes)            -> summary | throws Error {code: "size" | "foreign" | "mixed" | "nostore"}: is this
//                                   an EvilGenius backup at all
//   readImage(bytes)             -> {magic, blank, format, projects: [{slot, name}], presets: [preset], idNext,
//                                    used: {lib: [pages, of], prj: [pages, of]}}
//   readLibrary(bytes)           -> the same from MY PRESETS' sectors alone (the first LIB_BYTES of the store)
//   addPresets(image, sounds, {magic}) -> {image, added: [{slot, name, id}], skipped: [{name, why}]}
//                                   | throws {code: "full" | "nomagic"}: a new image, MY PRESETS' store written again
//                                   with the sounds in its free places; the projects' sectors byte for byte as they were
//   A preset: {slot (1..128), name, blob (128 bytes: core/voice/quad qd_quad_pack), id, tags, flags, imported, pan,
//              chorus, delay, reverb}
export const SECTOR = 4096, PAGE = 256, PPS = 16, HDR = 16, PAYLOAD = 240, DELETED = 0xFFFE;
export const LAYOUT = {
  region: 0xAF000, size: 49 * SECTOR, nproj: 4, nlib: 128,
  lib: { base: 0, nsec: 11, reserve: 2 },                  // persist.h QD_FLASH_LIB_SEC, QD_FLASH_LIB_RESERVE
  prj: { base: 11 * SECTOR, nsec: 38, reserve: 10 },
};
export const LIB_BYTES = LAYOUT.lib.nsec * SECTOR;
export const NAME = 13, BLOB = 128, PRESET_REC = 2 + NAME + BLOB + 8;   // persist.c ser_snd: 'S' 5
export const PRESET_MINE0 = 0x100, NFACTORY = 23, IMPORTED = 0x01;      // sounds.h, pattern.h QD_SNDF_IMPORTED
export const TAGS = ["BASS", "KEYS", "PLUCK", "PAD", "LEAD", "DRUMS", "FX"];   // sounds.c qd_preset_kind_name
export const BLOB_MAGIC = 0x53, BLOB_VERSIONS = [1, 2];    // quad_voice.c: 'S', VERSION 2 (1 read too: no SAY)

const RK = { SET: 1, HDR: 2, PAT: 3, SND: 4, LIB: 5, FTAG: 6, MFX: 7 };   // persist.h QD_RK_*
const rkey = (kind, p, i) => ((kind << 24) | (p << 16) | i) >>> 0;
const err = (code, msg) => Object.assign(new Error(msg), { code });

const g16 = (b, o) => b[o] | (b[o + 1] << 8);
const g32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const p16 = (b, o, v) => { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; };
const p32 = (b, o, v) => { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; b[o + 2] = (v >>> 16) & 0xFF; b[o + 3] = (v >>> 24) & 0xFF; };
function crc16(c, b, from, to) {
  for (let i = from; i < to; i++) {
    c ^= b[i] << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
  }
  return c;
}
const pagesOf = (len) => (len === DELETED || !len ? 1 : Math.ceil(len / PAYLOAD));
const isBlank = (b, o, n) => { for (let j = 0; j < n; j++) if (b[o + j] !== 0xFF) return false; return true; };

// a sector's header: its magic as text ("EGB2", "Z2FB", ..) when it is a page store's, "" else
function sectorMagic(b, o) {
  if (o + 12 > b.length || g16(b, o + 8) !== (~g16(b, o + 10) & 0xFFFF)) return "";
  const q = g32(b, o + 4);
  if (!q || q === 0xFFFFFFFF) return "";
  const m = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  return /^[A-Z0-9]{4}$/.test(m) ? m : "";
}
export const isEgMagic = (m) => /^EGB\d$/.test(m);

// every sector of an image: {magics: Map(magic -> count), blank, other (neither a store's sector nor blank)}
export function sectors(img) {
  const magics = new Map();
  let blank = 0, other = 0;
  for (let o = 0; o + SECTOR <= img.length; o += SECTOR) {
    const m = sectorMagic(img, o);
    if (m) magics.set(m, (magics.get(m) || 0) + 1);
    else if (isBlank(img, o, SECTOR)) blank++;
    else other++;
  }
  return { magics, blank, other };
}

// one store's index, as store.c qd_store_mount builds it
export function mount(img, base, nsec, want = "") {
  const sseq = new Array(nsec).fill(0);
  const order = [];
  let magic = "";
  for (let k = 0; k < nsec; k++) {
    const o = base + k * SECTOR;
    const mg = sectorMagic(img, o);
    if (mg && (!want || mg === want)) {
      sseq[k] = g32(img, o + 4);
      order.push(k);
      magic = magic || mg;
      continue;
    }
    sseq[k] = isBlank(img, o, SECTOR) ? 0 : 0xFFFFFFFF;
  }
  order.sort((a, b) => sseq[a] - sseq[b]);
  const st = { img, base, nsec, sseq, magic, keys: new Map() };
  const hdr = (pg) => {
    const o = base + pg * PAGE;
    const h = { key: g32(img, o), rseq: g32(img, o + 4), idx: g16(img, o + 8), np: g16(img, o + 10), len: g16(img, o + 12), crc: g16(img, o + 14) };
    if (h.key === 0xFFFFFFFF && h.rseq === 0xFFFFFFFF) return { r: -1, h };
    return { r: crc16(crc16(0xFFFF, img, o, o + 14), img, o + HDR, o + PAGE) === h.crc ? 1 : 0, h };
  };
  let open = false, okey = 0, orseq = 0, onext = 0, ofirst = -1, onp = 0, olen = 0;
  for (const sec of order) {
    for (let p = 1; p < PPS; p++) {
      const pg = sec * PPS + p, { r, h } = hdr(pg);
      if (r < 0) { open = false; break; }
      if (r === 0 || !h.np) { open = false; continue; }
      if (h.idx === 0) { open = true; okey = h.key; orseq = h.rseq; onext = 1; ofirst = pg; onp = h.np; olen = h.len; }
      else if (!open || h.key !== okey || h.rseq !== orseq || h.idx !== onext) { open = false; continue; }
      else onext++;
      if (open && onext === onp) {                          // the commit page: store.c index_put
        open = false;
        if (onp !== pagesOf(olen)) continue;
        const e = st.keys.get(okey);
        if (e && e.rseq > orseq) continue;
        st.keys.set(okey, { rseq: orseq, page: ofirst, len: olen });
      }
    }
  }
  st.live = [...st.keys.values()].reduce((n, e) => n + (e.len === DELETED ? 0 : pagesOf(e.len)), 0);
  st.total = nsec * (PPS - 1);
  st.sectors = order.length;
  return st;
}

function nextPage(st, pg) {
  const sec = Math.floor(pg / PPS), p = pg % PPS;
  if (p < PPS - 1) return pg + 1;
  let best = -1;
  for (let k = 0; k < st.nsec; k++) {
    const live = st.sseq[k] && st.sseq[k] !== 0xFFFFFFFF;
    if (live && st.sseq[k] > st.sseq[sec] && (best < 0 || st.sseq[k] < st.sseq[best])) best = k;
  }
  return best < 0 ? -1 : best * PPS + 1;
}

export function get(st, key) {
  const e = st.keys.get(key >>> 0);
  if (!e || e.len === DELETED) return null;
  const out = new Uint8Array(e.len);
  let pg = e.page, got = 0;
  for (let k = 0; k < pagesOf(e.len) && pg >= 0; k++) {
    const take = Math.min(PAYLOAD, e.len - got), o = st.base + pg * PAGE + HDR;
    out.set(st.img.subarray(o, o + take), got);
    got += take;
    pg = nextPage(st, pg);
  }
  return got === e.len ? out : null;
}

// every live record of a mounted store, by key
export function records(st) {
  const out = [];
  for (const key of [...st.keys.keys()].sort((a, b) => a - b)) {
    const bytes = get(st, key);
    if (bytes) out.push({ key, bytes });
  }
  return out;
}

// a store written fresh, as store.c's own writes would leave it, but packed: the records one after another from the
// region's first sector, the sectors' sequence numbers 1, 2, .. in place order, the records' 1, 2, ..; every other
// sector erased. The unit keeps `reserve` sectors blank for its garbage collection: more records than that leaves
// room for is refused. -> the sectors used
export function writeStore(img, base, nsec, recs, magic, reserve) {
  img.fill(0xFF, base, base + nsec * SECTOR);
  let sec = -1, p = PPS, rseq = 0;
  const page = () => {
    if (p === PPS) {                                        // the next sector, its header (store.c open_sector)
      if (++sec >= nsec - reserve) throw err("full", `the records do not fit (${nsec - reserve} sectors)`);
      const o = base + sec * SECTOR;
      for (let i = 0; i < 4; i++) img[o + i] = magic.charCodeAt(i);
      p32(img, o + 4, sec + 1);
      p16(img, o + 8, 0x5A5A); p16(img, o + 10, ~0x5A5A & 0xFFFF);
      p = 1;
    }
    return base + (sec * PPS + p++) * PAGE;
  };
  for (const { key, bytes } of recs) {
    const len = bytes.length, np = pagesOf(len);
    if (len >= DELETED) throw new Error(`record ${(key >>> 0).toString(16)}: ${len} bytes`);
    rseq++;
    for (let idx = 0; idx < np; idx++) {                    // (store.c write_page)
      const o = page(), take = Math.min(PAYLOAD, len - idx * PAYLOAD);
      img.fill(0, o + HDR, o + PAGE);
      if (take > 0) img.set(bytes.subarray(idx * PAYLOAD, idx * PAYLOAD + take), o + HDR);
      p32(img, o, key >>> 0); p32(img, o + 4, rseq); p16(img, o + 8, idx); p16(img, o + 10, np); p16(img, o + 12, len);
      p16(img, o + 14, crc16(crc16(0xFFFF, img, o, o + 14), img, o + HDR, o + PAGE));
    }
  }
  return sec + 1;
}

// ---- the records
const cstr = (b, o, n) => { let s = ""; for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i]); return s; };

// a packed sound a firmware of today reads (quad_voice.c qd_quad_unpack: its length, 'S', its version)
export const blobOk = (blob) => blob instanceof Uint8Array && blob.length === BLOB && blob[0] === BLOB_MAGIC && BLOB_VERSIONS.includes(blob[1]);

// a MY PRESETS record ('S' 5: name[13], the blob, id u16, tags, flags, pan, chorus, delay, reverb) -> a preset | null
export function parsePreset(b, slot) {
  if (!b || b.length !== PRESET_REC || b[0] !== 0x53 || b[1] !== 5) return null;
  const o = 2 + NAME + BLOB;
  const pan = (b[o + 4] << 24) >> 24;
  return { slot, name: cstr(b, 2, NAME - 1) || "?", blob: b.slice(2 + NAME, o), id: g16(b, o), tags: b[o + 2] & 0x7F,
    flags: b[o + 3], imported: !!(b[o + 3] & IMPORTED), pan: Math.max(-64, Math.min(63, pan)),
    chorus: b[o + 5] & 0x7F, delay: b[o + 6] & 0x7F, reverb: b[o + 7] & 0x7F };
}
export function presetRecord(s) {
  const b = new Uint8Array(PRESET_REC), o = 2 + NAME + BLOB;
  b[0] = 0x53; b[1] = 5;
  for (let i = 0; i < NAME - 1 && i < s.name.length; i++) b[2 + i] = s.name.charCodeAt(i) & 0x7F;
  b.set(s.blob, 2 + NAME);
  p16(b, o, s.id);
  b[o + 2] = s.tags & 0x7F; b[o + 3] = s.flags & 0xFF; b[o + 4] = s.pan & 0xFF;
  b[o + 5] = s.chorus & 0x7F; b[o + 6] = s.delay & 0x7F; b[o + 7] = s.reverb & 0x7F;
  return b;
}
export const tagNames = (mask) => TAGS.filter((_, k) => (mask >> k) & 1);

function libraryOf(lib) {
  const presets = [];
  for (let k = 0; k < LAYOUT.nlib; k++) { const p = parsePreset(get(lib, rkey(RK.LIB, 0, k)), k + 1); if (p) presets.push(p); }
  // the factory tags' record ('F' 2: a byte a factory preset, then the next MY preset id: persist.c)
  const f = get(lib, rkey(RK.FTAG, 0, 0));
  const idNext = f && f.length === 2 + NFACTORY + 2 && f[0] === 0x46 && f[1] === 2 ? g16(f, 2 + NFACTORY) : 0;
  return { presets, idNext };
}

// is this an EvilGenius backup: its size, its sectors' magic -> {magic, blank} | throws
export function checkImage(img) {
  if (!(img instanceof Uint8Array)) img = new Uint8Array(img);
  if (img.length !== LAYOUT.size)
    throw err("size", `not an EVILGENIUS backup: it is ${img.length} bytes, a backup is ${LAYOUT.size}`);
  const s = sectors(img);
  const eg = [...s.magics.keys()].filter(isEgMagic), foreign = [...s.magics.keys()].filter((m) => !isEgMagic(m));
  if (foreign.length && !eg.length)
    throw err("foreign", /^Z2F/.test(foreign[0]) ? "this is a FIZZ backup, not an EVILGENIUS one" : `not an EVILGENIUS backup: its sectors are marked ${foreign.join(", ")}`);
  if (eg.length > 1) throw err("mixed", `not a whole EVILGENIUS backup: its sectors are of ${eg.length} store versions (${eg.join(", ")})`);
  if (!eg.length && s.blank !== LAYOUT.size / SECTOR) throw err("nostore", "not an EVILGENIUS backup: there is no EVILGENIUS store in it");
  return { magic: eg[0] || "", blank: !eg.length };
}

export function readImage(img) {
  if (!(img instanceof Uint8Array)) img = new Uint8Array(img);
  const { magic, blank } = checkImage(img);
  const lib = mount(img, LAYOUT.lib.base, LAYOUT.lib.nsec, magic), prj = mount(img, LAYOUT.prj.base, LAYOUT.prj.nsec, magic);
  const projects = [];
  for (let p = 0; p < LAYOUT.nproj; p++) {
    const h = get(prj, rkey(RK.HDR, p, 0));
    if (h && h[0] === 0x48 && h[1] === 1) projects.push({ slot: p + 1, name: cstr(h, 2, NAME - 1) });
  }
  const set = get(prj, rkey(RK.SET, 0, 0));
  return { magic, blank, format: set && set.length >= 2 && set[0] === 0x47 ? set[1] : null, projects, ...libraryOf(lib),
    used: { lib: [lib.live, lib.total], prj: [prj.live, prj.total] } };
}

// MY PRESETS' sectors alone (the store's first LIB_BYTES): what the page reads to list the presets
export function readLibrary(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < LIB_BYTES) throw err("size", "MY PRESETS' sectors did not arrive whole");
  const part = bytes.subarray(0, LIB_BYTES), s = sectors(part);
  const eg = [...s.magics.keys()].filter(isEgMagic);
  if (eg.length > 1 || (!eg.length && s.magics.size)) throw err("foreign", "the FM-1's store is not an EVILGENIUS store");
  const lib = mount(part, 0, LAYOUT.lib.nsec, eg[0] || "");
  return { magic: eg[0] || "", ...libraryOf(lib), used: { lib: [lib.live, lib.total] } };
}

const sameBlob = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// the sounds ({name, blob, tags, pan, chorus, delay, reverb}) into MY PRESETS' free places of a copy of the image. A
// sound already there (the same name and the same patch) is skipped. Each new preset gets an id no preset had before
// (persist.c lib_new_id: above every id in the library and the record's own "next id"), marked imported.
export function addPresets(image, sounds, { magic = "" } = {}) {
  const info = checkImage(image);
  const mg = info.magic || magic;
  if (!isEgMagic(mg)) throw err("nomagic", "the FM-1's store is empty, so its version is not known. Save a preset on the FM-1 first");
  const lib = mount(image, LAYOUT.lib.base, LAYOUT.lib.nsec, info.magic);
  const { presets, idNext } = libraryOf(lib);
  const used = new Set(presets.map((p) => p.slot));
  const free = [];
  for (let k = 1; k <= LAYOUT.nlib; k++) if (!used.has(k)) free.push(k);
  const added = [], skipped = [], recs = new Map(records(lib).map((r) => [r.key, r.bytes]));
  let next = Math.max(PRESET_MINE0 + LAYOUT.nlib, idNext, ...presets.map((p) => p.id + 1));
  const fresh = [];
  for (const s of sounds) {                                 // (already there, or twice in these files: once)
    if (!blobOk(s.blob)) throw new Error(`${s.name}: not an EVILGENIUS sound`);
    const dup = [...presets, ...fresh].some((p) => p.name === s.name && sameBlob(p.blob, s.blob));
    if (dup) skipped.push({ name: s.name, why: "already in MY PRESETS" });
    else fresh.push(s);
  }
  if (fresh.length > free.length)
    throw err("full", `MY PRESETS has ${free.length} free place${free.length === 1 ? "" : "s"}, the files hold ${fresh.length} new sounds`);
  for (const s of fresh) {
    if (next > 0xFFFE) throw err("full", "this store has given out all its preset ids");
    const slot = free.shift(), id = next++;
    recs.set(rkey(RK.LIB, 0, slot - 1), presetRecord({ ...s, id, flags: IMPORTED }));
    added.push({ slot, name: s.name, id });
  }
  const out = Uint8Array.from(image);
  if (!added.length) return { image: out, added, skipped };
  // the next id kept with the factory tags (none yet: a record of the classifier's tags, zeros)
  const fk = rkey(RK.FTAG, 0, 0), f0 = recs.get(fk);
  if (!f0 || (f0.length === 2 + NFACTORY + 2 && f0[0] === 0x46 && f0[1] === 2)) {
    const f = f0 ? Uint8Array.from(f0) : new Uint8Array(2 + NFACTORY + 2);
    f[0] = 0x46; f[1] = 2;
    p16(f, 2 + NFACTORY, next);
    recs.set(fk, f);
  }
  const list = [...recs.keys()].sort((a, b) => a - b).map((key) => ({ key, bytes: recs.get(key) }));
  writeStore(out, LAYOUT.lib.base, LAYOUT.lib.nsec, list, mg, LAYOUT.lib.reserve);
  return { image: out, added, skipped };
}

// 2026-11-15 (SEQUENCE's patterns, docs/SEQ-SYSEX-PLAN.md phase 4's overview): which of a project's 64 patterns the
// store holds, and which of those have content (persist.c ser_pat: 'P', its version, the step's and the settings'
// sizes, master (2), swing, used). prjBytes: the projects' sectors alone (LAYOUT.prj), or a whole image
//   patternsOf(bytes, project 1..4) -> [{k, there, used}] x 64
export function patternsOf(bytes, project) {
  let img = bytes;
  if (bytes.length === LAYOUT.prj.nsec * SECTOR) {           // (the projects' sectors read alone: placed in an image)
    img = new Uint8Array(LAYOUT.size).fill(0xFF);
    img.set(bytes, LAYOUT.prj.base);
  }
  const st = mount(img, LAYOUT.prj.base, LAYOUT.prj.nsec);
  return Array.from({ length: 64 }, (_, k) => {
    const r = get(st, rkey(RK.PAT, project - 1, k));
    return { k, there: !!r, used: !!(r && r.length > 7 && r[0] === 0x50 && r[7]) };
  });
}
