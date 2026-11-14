// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's manager: the files it writes and reads. No DOM: tools/eg/manager_test.mjs runs it in Node.
//
// A BACKUP, .egbak: the store's region exactly as the unit holds it (200704 bytes: egstore.js), nothing added. It is
// the file firmware/tools/fizz_xdata.py backup writes and restore reads, so either tool takes the other's.
//
// A SOUND, .egsnd: JSON, one of MY PRESETS:
//   { "format": "evilgenius-sound", "version": 1, "name": "HOT RHINO",
//     "patch": "<base64 of the 128-byte packed sound: core/voice/quad/quad_voice.c qd_quad_pack, 'S' 2>",
//     "tags": ["BASS"], "pan": 0, "chorus": 0, "delay": 0, "reverb": 0,
//     "from": { "firmware": "FM-1_4500", "store": "EGB2", "place": 1, "date": "2026-11-14T10:00:00.000Z" } }
// SOUNDS, .egsnds: JSON, several: { "format": "evilgenius-sounds", "version": 1, "sounds": [ <a sound without its
//   format and version> .. ], "from": {..} }
//
//   soundFile(preset, from) -> text          soundsFile(presets, from) -> text
//   readSounds(text | bytes, fileName) -> [{name, blob, tags, pan, chorus, delay, reverb}]   (throws: says why)
//   backupName(date), soundName(preset), soundsName(date)
import { BLOB, TAGS, blobOk, tagNames } from "./egstore.js";

export const SOUND = "evilgenius-sound", SOUNDS = "evilgenius-sounds", VERSION = 1;

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
function unb64(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch (_) { return null; }
}
const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
const safe = (s) => String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").trim() || "SOUND";
export const backupName = (date = new Date()) => `EVILGENIUS backup ${stamp(date)}.egbak`;
export const soundName = (p) => `${safe(p.name)}.egsnd`;
export const soundsName = (date = new Date()) => `EVILGENIUS presets ${stamp(date)}.egsnds`;

const entry = (p) => ({ name: p.name, patch: b64(p.blob), tags: tagNames(p.tags), pan: p.pan, chorus: p.chorus, delay: p.delay, reverb: p.reverb });
export const soundFile = (p, from = {}) =>
  JSON.stringify({ format: SOUND, version: VERSION, ...entry(p), from: { ...from, place: p.slot } }, null, 2) + "\n";
export const soundsFile = (presets, from = {}) =>
  JSON.stringify({ format: SOUNDS, version: VERSION, from, sounds: presets.map(entry) }, null, 2) + "\n";

// a name as the unit keeps one: twelve printable ASCII characters, upper case (its fonts have no lower case)
export function cleanName(s) {
  return String(s ?? "").toUpperCase().replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "?").trim().slice(0, 12).trim();
}
const int = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : 0);

function sound(j, where) {
  if (!j || typeof j !== "object") throw new Error(`${where}: not a sound`);
  const name = cleanName(j.name);
  if (!name) throw new Error(`${where}: the sound has no name`);
  const blob = unb64(j.patch);
  if (!blob || blob.length !== BLOB) throw new Error(`${where}: "${name}" has no patch of ${BLOB} bytes`);
  if (blob[0] !== 0x53) throw new Error(`${where}: "${name}" is not a SID patch`);
  if (!blobOk(blob)) throw new Error(`${where}: "${name}" was made by a newer EVILGENIUS (patch version ${blob[1]})`);
  const tags = Array.isArray(j.tags) ? j.tags.reduce((m, t) => { const k = TAGS.indexOf(String(t).toUpperCase()); return k < 0 ? m : m | (1 << k); }, 0)
    : int(j.tags, 0, 127);
  return { name, blob, tags, pan: int(j.pan, -64, 63), chorus: int(j.chorus, 0, 127), delay: int(j.delay, 0, 127), reverb: int(j.reverb, 0, 127) };
}

export function readSounds(data, file = "this file") {
  let text = data;
  if (typeof data !== "string") {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length > 4 << 20) throw new Error(`${file}: too big to be EVILGENIUS sounds`);
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (_) { throw new Error(`${file}: not an EVILGENIUS sound file`); }
  }
  let j;
  try { j = JSON.parse(text); } catch (_) { throw new Error(`${file}: not an EVILGENIUS sound file`); }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(`${file}: not an EVILGENIUS sound file`);
  if (typeof j.format === "string" && /^fizz-/.test(j.format))
    throw new Error(`${file}: a FIZZ file. FIZZ's FM sounds do not play on EVILGENIUS's SID`);
  if (j.format !== SOUND && j.format !== SOUNDS) throw new Error(`${file}: not an EVILGENIUS sound file`);
  if (!(j.version >= 1) || j.version > VERSION) throw new Error(`${file}: written by a newer manager (version ${j.version}). Reload this page`);
  if (j.format === SOUND) return [sound(j, file)];
  if (!Array.isArray(j.sounds)) throw new Error(`${file}: it holds no sounds`);
  return j.sounds.map((s, i) => sound(s, `${file}, sound ${i + 1}`));
}
