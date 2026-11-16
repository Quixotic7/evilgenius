// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ONE PROJECT taken out of a store image and put into another (docs/BROWSER-FM1-PLAN.md phase 5; the file:
// docs/PROJECT-FORMAT.md). No DOM: tools/eg/manager_test.mjs runs it in Node.
//
// A project is its records in the projects' store, each keyed (kind, project, index): its header (H), its 64 patterns
// (P), its pool (S: a sound, or 'R' 1 and a preset id: a reference), its MIDI FX (X). Its sounds live partly outside
// it: a pool slot and a pattern's track sound ('P' 5 and 6: eight u16 ids after the first 12 bytes) can name one of
// MY PRESETS by id (persist.c snd_rec, ser_pat). So a project file carries every MY preset it names, whole, and a
// project put into a store has those presets found (the same name and patch: its id used) or added (a new id), and its
// references rewritten to the ids they get there. Factory presets (ids 1..23) are compiled in and travel as they are.
//
//   extractProject(image, slot 1..4, from) -> project (JSON-able; projectFile(project) is the .egprj text)
//   readProject(text | bytes, fileName)    -> project (throws: says why)
//   insertProject(image, slot 1..4, project) -> {image, added: [{name, id, slot}], reused: [{name, id}], replaced}
//                                            | throws {code: "store" | "full" | "nomagic" | "empty"}
//   projectsIn(image) -> [{slot, name}]
import { LAYOUT, RK, rkey, mount, get, records, writeStore, checkImage, libraryOf, writeLibrary, presetRecord, parsePreset,
  blobOk, sameBlob, cstr, isEgMagic, PRESET_MINE0, IMPORTED, NAME, BLOB, readImage } from "./egstore.js";
import { cleanName } from "./egfiles.js";

export const PROJECT = "evilgenius-project", VERSION = 1;
const KINDS = { [RK.HDR]: "HDR", [RK.PAT]: "PAT", [RK.SND]: "SND", [RK.MFX]: "MFX" };
const KIND_OF = { HDR: RK.HDR, PAT: RK.PAT, SND: RK.SND, MFX: RK.MFX };
const NTRACK = 6, TRACK_NAME = 13, REF_AT = 12;              // qd_config.h QD_TRACKS; model.h; ser_pat's header
const GONE = 0xFFFF;                                         // (an id no preset has: the firmware drops the reference)
const err = (code, msg) => Object.assign(new Error(msg), { code });
const g16 = (b, o) => b[o] | (b[o + 1] << 8);
const p16 = (b, o, v) => { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; };

// base64 a chunk at a time (a pattern record runs to 28 KB: too many arguments for one fromCharCode)
export function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(s);
}
function unb64(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch (_) { return null; }
}

// the preset ids a record names: a pool slot's reference, a pattern's track sounds' -> [{at, id}]
function refsOf(kind, b) {
  if (kind === RK.SND && b.length === 4 && b[0] === 0x52 && b[1] === 1) return [{ at: 2, id: g16(b, 2) }];
  if (kind === RK.PAT && b.length >= REF_AT + 2 * NTRACK && b[0] === 0x50 && b[1] >= 5 && b[1] <= 6) {
    const out = [];
    for (let t = 0; t < NTRACK; t++) { const id = g16(b, REF_AT + 2 * t); if (id) out.push({ at: REF_AT + 2 * t, id }); }
    return out;
  }
  return [];
}

// a header's name and its tracks' names (persist.c ser_hdr: 'H' 1, name, demo, six bytes, 6 x 7 the mix, three
// bytes, then each track's kind, named, name[12])
function headerOf(h) {
  if (!h || h[0] !== 0x48 || h[1] !== 1) return { name: "", tracks: [] };
  const name = cstr(h, 2, NAME - 1), tracks = [];
  let o = 2 + NAME + 1 + 6 + NTRACK * 7 + 3;
  for (let t = 0; t < NTRACK; t++, o += 2 + TRACK_NAME - 1) tracks.push(o + 2 + TRACK_NAME - 1 <= h.length && h[o + 1] ? cstr(h, o + 2, TRACK_NAME - 1) : "");
  return { name, tracks };
}

function stores(image) {
  const info = checkImage(image);
  return { info, lib: mount(image, LAYOUT.lib.base, LAYOUT.lib.nsec, info.magic), prj: mount(image, LAYOUT.prj.base, LAYOUT.prj.nsec, info.magic) };
}
export const projectsIn = (image) => readImage(image).projects;

export function extractProject(image, slot, from = {}) {
  if (!(image instanceof Uint8Array)) image = new Uint8Array(image);
  const { info, lib, prj } = stores(image), p = slot - 1;
  const h = get(prj, rkey(RK.HDR, p, 0));
  if (!h) throw err("empty", `slot ${slot} holds no project`);
  const mine = new Map(libraryOf(lib).presets.map((x) => [x.id, x]));
  const recs = [], ids = new Set(), patterns = [];
  for (const { key, bytes } of records(prj)) {
    const kind = key >>> 24;
    if (((key >>> 16) & 0xFF) !== p || !KINDS[kind]) continue;
    const index = key & 0xFFFF;
    recs.push({ kind: KINDS[kind], index, data: b64(bytes) });
    for (const r of refsOf(kind, bytes)) if (r.id >= PRESET_MINE0) ids.add(r.id);
    if (kind === RK.PAT && bytes.length > 7 && bytes[0] === 0x50 && bytes[7]) patterns.push(index);
  }
  const presets = [...ids].sort((a, b) => a - b).filter((id) => mine.has(id)).map((id) => {
    const x = mine.get(id);
    return { id, name: x.name, blob: b64(x.blob), tags: x.tags, flags: x.flags, pan: x.pan, chorus: x.chorus, delay: x.delay, reverb: x.reverb };
  });
  const hd = headerOf(h);
  return { format: PROJECT, version: VERSION, store: info.magic, name: hd.name || `PROJECT ${slot}`, saved: new Date().toISOString(),
    from: { ...from, slot }, records: recs, presets, summary: { tracks: hd.tracks, patterns } };
}

export const projectFile = (j) => JSON.stringify(j, null, 1) + "\n";
const safe = (s) => String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").trim() || "PROJECT";
export const projectName = (j) => `${safe(j.name)}.egprj`;

// a project file read and checked: its records decoded, its presets whole
export function readProject(data, file = "this file") {
  let text = data;
  if (typeof data !== "string") {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length > 16 << 20) throw new Error(`${file}: too big to be an EVILGENIUS project`);
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (_) { throw new Error(`${file}: not an EVILGENIUS project`); }
  }
  let j;
  try { j = JSON.parse(text); } catch (_) { throw new Error(`${file}: not an EVILGENIUS project`); }
  if (!j || typeof j !== "object" || j.format !== PROJECT) throw new Error(`${file}: not an EVILGENIUS project`);
  if (!(j.version >= 1) || j.version > VERSION) throw new Error(`${file}: written by a newer manager (version ${j.version}). Reload this page`);
  if (!isEgMagic(j.store)) throw new Error(`${file}: it does not say which EVILGENIUS store it is from`);
  if (!Array.isArray(j.records) || !j.records.some((r) => r && r.kind === "HDR")) throw new Error(`${file}: it holds no project header`);
  const records = j.records.map((r, i) => {
    const bytes = r && unb64(r.data);
    if (!bytes || !KIND_OF[r.kind] || !(r.index >= 0 && r.index <= 0xFFFF)) throw new Error(`${file}: record ${i + 1} is damaged`);
    return { kind: r.kind, index: r.index | 0, data: r.data, bytes };
  });
  const presets = (Array.isArray(j.presets) ? j.presets : []).map((x, i) => {
    const blob = x && unb64(x.blob);
    if (!blob || blob.length !== BLOB || !blobOk(blob) || !(x.id >= PRESET_MINE0)) throw new Error(`${file}: preset ${i + 1} is damaged`);
    return { ...x, name: cleanName(x.name) || "?", blob };
  });
  return { ...j, name: cleanName(j.name) || "PROJECT", records, presets };
}
// (a project as extractProject or the library gives it, base64 still: read as its file would be)
const decoded = (j) => (j.records.every((r) => r.bytes) ? j : readProject(JSON.stringify(j)));

// the project into slot `slot` of a copy of the image: the slot's records replaced, its presets found or added
export function insertProject(image, slot, project) {
  if (!(image instanceof Uint8Array)) image = new Uint8Array(image);
  const j = decoded(project), p = slot - 1;
  if (!(p >= 0 && p < LAYOUT.nproj)) throw err("slot", `there is no slot ${slot}`);
  const { info, lib, prj } = stores(image);
  const magic = info.magic || j.store;
  if (info.magic && info.magic !== j.store)
    throw err("store", `the project is from another EVILGENIUS version (its store is ${j.store}, this FM-1's is ${info.magic})`);
  // the presets: the same one there (name and patch): its id; else a free place and a new id
  const libRecs = new Map(records(lib).map((r) => [r.key, r.bytes]));
  const { presets: there, idNext } = libraryOf(lib);
  const used = new Set(there.map((x) => x.slot)), free = [];
  for (let k = 1; k <= LAYOUT.nlib; k++) if (!used.has(k)) free.push(k);
  let next = Math.max(PRESET_MINE0 + LAYOUT.nlib, idNext, ...there.map((x) => x.id + 1));
  const map = new Map(), added = [], reused = [];
  for (const x of j.presets) {
    const same = [...there, ...added.map((a) => a.preset)].find((y) => y.name === x.name && sameBlob(y.blob, x.blob));
    if (same) { map.set(x.id, same.id); if (!added.some((a) => a.preset === same)) reused.push({ name: x.name, id: same.id }); continue; }
    if (!free.length) throw err("full", `MY PRESETS is full: the project needs ${j.presets.length - reused.length} of its sounds added`);
    if (next > 0xFFFE) throw err("full", "this store has given out all its preset ids");
    const place = free.shift(), id = next++;
    const preset = { ...x, id, flags: (x.flags | 0) | IMPORTED };
    libRecs.set(rkey(RK.LIB, 0, place - 1), presetRecord(preset));
    map.set(x.id, id);
    added.push({ name: x.name, id, slot: place, preset: parsePreset(presetRecord(preset), place) });
  }
  // the projects' records: every other project's (and the settings) as they are, this slot's the project's
  const old = get(prj, rkey(RK.HDR, p, 0)), replaced = old ? headerOf(old).name || `PROJECT ${slot}` : "";
  const out = records(prj).filter(({ key }) => ((key >>> 16) & 0xFF) !== p || (key >>> 24) === RK.SET);
  for (const r of j.records) {
    const kind = KIND_OF[r.kind], bytes = Uint8Array.from(r.bytes);
    for (const ref of refsOf(kind, bytes)) if (ref.id >= PRESET_MINE0) p16(bytes, ref.at, map.has(ref.id) ? map.get(ref.id) : GONE);
    out.push({ key: rkey(kind, p, r.index), bytes });
  }
  out.sort((a, b) => a.key - b.key);
  if (!isEgMagic(magic)) throw err("nomagic", "the store's version is not known");
  const img = Uint8Array.from(image);
  writeStore(img, LAYOUT.prj.base, LAYOUT.prj.nsec, out, magic, LAYOUT.prj.reserve);
  if (added.length || !info.magic) writeLibrary(img, libRecs, next, magic);
  return { image: img, added: added.map(({ preset, ...a }) => a), reused, replaced };
}

// ---- THE LIBRARY: the projects kept in this browser (IndexedDB "evilgenius-projects"), as many as it will hold. An
// entry: {id, name, saved, from, project (the file's JSON)}. Nothing in it is ever overwritten by a pull: each is a new
// entry. (No IndexedDB, as in Node: the library is empty and keeps nothing.)
const SHELF = "evilgenius-projects";
function shelfDb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("this browser keeps nothing (no IndexedDB)")); return; }
    const r = indexedDB.open(SHELF, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error("IndexedDB"));
  });
}
async function shelfTx(mode, fn) {
  const d = await shelfDb();
  return new Promise((res, rej) => {
    const t = d.transaction("projects", mode), s = t.objectStore("projects");
    const out = fn(s);
    t.oncomplete = () => { d.close(); res(out && "result" in out ? out.result : undefined); };
    t.onerror = () => { d.close(); rej(t.error || new Error("IndexedDB")); };
  });
}
// a project as the library keeps it: the file's JSON (records and presets in base64)
const plain = (j) => JSON.parse(projectFile({ ...j, records: j.records.map(({ bytes, ...r }) => r),
  presets: j.presets.map((x) => ({ ...x, blob: typeof x.blob === "string" ? x.blob : b64(x.blob) })) }));
// a project with another name: its header record's name too (what the FM-1 shows: persist.c ser_hdr, 12 characters)
export function renamed(j, name) {
  const records = j.records.map((r) => {
    if (r.kind !== "HDR") return r;
    const b = Uint8Array.from(r.bytes || unb64(r.data));
    b.fill(0, 2, 2 + NAME);
    for (let i = 0; i < NAME - 1 && i < name.length; i++) b[2 + i] = name.charCodeAt(i) & 0x7F;
    return r.bytes ? { ...r, bytes: b, data: b64(b) } : { ...r, data: b64(b) };
  });
  return { ...j, name, records };
}
export const shelf = {
  async list() { try { return ((await shelfTx("readonly", (s) => s.getAll())) || []).sort((a, b) => b.saved.localeCompare(a.saved)); } catch (_) { return []; } },
  async add(project) {
    const j = plain(project);
    return shelfTx("readwrite", (s) => s.add({ name: j.name, saved: new Date().toISOString(), from: j.from || {}, project: j }));
  },
  async rename(id, name) {
    const all = await shelf.list(), e = all.find((x) => x.id === id);
    if (!e) return;
    await shelfTx("readwrite", (s) => s.put({ ...e, name, project: renamed(e.project, name) }));
  },
  async remove(id) { await shelfTx("readwrite", (s) => s.delete(id)); },
};
