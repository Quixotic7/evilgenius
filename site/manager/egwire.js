// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's manager: the bytes on the wire. No DOM, no MIDI: tools/eg/manager_test.mjs runs it in Node.
// Adapted from FIZZ's manager (site/manager/fizzlink.js, fizzbak.js) and fm1-base's installer (fm1lib.js), MPL-2.0.
//
// TWO FRAMINGS reach an FM-1 running EvilGenius:
//   - the update's (fm1-base, Felucca): F0 pack7(00 59 cmd len16 00 payload ~sum) F7, the bytes packed 7 bits a byte
//     as one bit stream, low bits first. The handshake (who is there), and the port's own commands, cmd 46
//     (firmware/app/app.c app_usb_cmd), a 4-letter tag then little-endian words:
//         "FZBI"            -> "FZBI" off size crc      the store's flash offset, its size, its CRC-32 now
//         "FZBR" off n      -> "FZBD" off <n bytes>     n <= 256 bytes of the store
//         "FZSR" len crc    the restore: the unit pulls the image twice with the update's read requests (cmd 30,
//                           512 bytes each), then answers "FZOK", or "FZER" and a code
//     (the tags are FIZZ's: EvilGenius kept them)
//   - EvilGenius's own: F0 7D 45 47 01 cmd body chk F7 (core/app/fizz_sx.c; chk: the sum of cmd, body, chk is 0 mod
//     128). Only IDENTITY is here: the page asks it once and shows the answer if one comes.

export const EG_PREFIX = "FM-1_45";              // the USB identity of an FM-1 running EvilGenius (FIZZ's is FM-1_46)
export const BULK = 0x46;                        // app_usb_cmd's command byte
export const CHUNK = 256;                        // app.c FZ_BK_CHUNK: a backup read's bytes at most
export const PULL = 512;                         // a restore's read request at most
export const HS_QUERY = [0xF0, 0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7F, 0xF7];
export const FZER = {                            // app.c, firmware/tools/fizz_xdata.py
  10: "the FM-1 is playing. Press stop on it, then try again",
  11: "the backup is not the size of this FM-1's store",
  12: "the backup did not arrive whole. Nothing on the FM-1 was changed",
  13: "a write failed. The FM-1 cleared its store: restore the backup again",
  14: "the store did not read back as the backup. Restore it again",
  15: "this needs the USB cable, not Bluetooth",
};

// ---- CRC-32 (zlib's), as the unit's fz_crc32
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b, c = 0) {
  c = (c ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
export const hex8 = (n) => (n >>> 0).toString(16).padStart(8, "0");

// ---- the update's framing
export function pack7(data) {
  const out = [];
  let acc = 0, nb = 0;
  for (const b of data) {
    acc |= (b & 0xFF) << nb;
    nb += 8;
    while (nb >= 7) { out.push(acc & 0x7F); acc >>>= 7; nb -= 7; }
  }
  if (nb) out.push(acc & 0x7F);
  return out;
}
export function unpack7(s) {
  const out = [];
  let acc = 0, nb = 0;
  for (const b of s) {
    acc |= (b & 0x7F) << nb;
    nb += 7;
    while (nb >= 8) { out.push(acc & 0xFF); acc >>>= 8; nb -= 8; }
  }
  return out;
}
const isSysex = (p) => !!p && p.length >= 3 && p[0] === 0xF0 && p[p.length - 1] === 0xF7;
const le32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
export const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function frame(cmd, payload = []) {
  let s = 0;
  for (const b of payload) s += b;
  return [0xF0, ...pack7([0x00, 0x59, cmd, payload.length & 0xFF, payload.length >> 8, 0, ...payload, ~s & 0xFF]), 0xF7];
}
// a cmd-46 frame: its tag, then 32-bit words (and, a reply's, raw bytes after them)
export const bulkFrame = (tag, words = [], data = []) =>
  frame(BULK, [...[...tag].map((c) => c.charCodeAt(0)), ...words.flatMap(le32), ...data]);
// -> {tag, data} | null (not a cmd-46 frame, or its checksum is wrong)
export function parseBulk(p) {
  if (!isSysex(p)) return null;
  const u = unpack7(Array.prototype.slice.call(p, 1, -1));
  if (u.length < 11 || u[0] !== 0 || u[1] !== 0x59 || u[2] !== BULK) return null;
  const n = u[3] | (u[4] << 8);
  if (u.length < 7 + n || n < 4) return null;
  let s = 0;
  for (let i = 6; i < 6 + n; i++) s += u[i];
  if ((~s & 0xFF) !== u[6 + n]) return null;
  return { tag: String.fromCharCode(...u.slice(6, 10)), data: Uint8Array.from(u.slice(10, 6 + n)) };
}

// the unit's read request during a restore (cmd 30) -> {fl, addr, len} | null; and the answer to one
export function parseRequest(p) {
  if (!isSysex(p)) return null;
  const u = unpack7(Array.prototype.slice.call(p, 1, -1));
  if (u.length !== 15 || u[0] !== 0 || u[1] !== 0x59 || u[2] !== 0x30) return null;
  let s = 0;
  for (let i = 6; i < 14; i++) s += u[i];
  if ((~s & 0xFF) !== u[14]) return null;
  return { fl: u[6], addr: rd32(u, 7), len: u[11] | (u[12] << 8) | (u[13] << 16) };
}
export function response(addr, data, fl = 0) {
  const n = data.length;
  const body = [0x00, 0x59, 0x30, (n + 8) & 0xFF, ((n + 8) >> 8) & 0xFF, 0, fl, ...le32(addr), n & 0xFF, (n >> 8) & 0xFF, 0, ...data];
  let s = 0;
  for (let i = 6; i < body.length; i++) s += body[i];
  body.push(~s & 0xFF);
  return [0xF0, ...pack7(body), 0xF7];
}
export function readRequest(addr, len, fl = 0) {      // (the unit's side: the tests' simulated FM-1 sends it)
  const body = [0x00, 0x59, 0x30, 8, 0, 0, fl, ...le32(addr), len & 0xFF, (len >> 8) & 0xFF, (len >> 16) & 0xFF];
  let s = 0;
  for (let i = 6; i < body.length; i++) s += body[i];
  body.push(~s & 0xFF);
  return [0xF0, ...pack7(body), 0xF7];
}
// the answer to a read request -> {fl, addr, data} | null (the simulated FM-1 reads it)
export function parseResponse(p) {
  if (!isSysex(p)) return null;
  const u = unpack7(Array.prototype.slice.call(p, 1, -1));
  if (u.length < 15 || u[0] !== 0 || u[1] !== 0x59 || u[2] !== 0x30) return null;
  const n = (u[3] | (u[4] << 8)) - 8;
  if (n < 0 || u.length < 15 + n) return null;
  let s = 0;
  for (let i = 6; i < 14 + n; i++) s += u[i];
  if ((~s & 0xFF) !== u[14 + n] || (u[11] | (u[12] << 8)) !== n) return null;
  return { fl: u[6], addr: rd32(u, 7), data: Uint8Array.from(u.slice(14, 14 + n)) };
}

// the handshake's answer: "FM-1_4500" -> {text, model, version, loader, evilgenius} | null
export function parseIdentity(p) {
  if (!isSysex(p)) return null;
  const d = unpack7(Array.prototype.slice.call(p, 1, -1));
  if (d.length !== 34 || d[0] !== 0 || d[1] !== 0x59 || d[2] !== 0x11) return null;
  const text = String.fromCharCode(...d.slice(6, 33)).replace(/\0+$/, "");
  if (!/^[\x20-\x7e]+$/.test(text)) return null;
  const m = /^([^_]+)_(\d+)$/.exec(text);
  const model = m ? m[1] : text;
  const loader = /^ota-/i.test(model);
  return { text, model, version: m ? parseInt(m[2], 10) : 0, loader, evilgenius: !loader && text.startsWith(EG_PREFIX) };
}
export function identityFrame(text) {                 // (the unit's side: the tests')
  const d = new Array(34).fill(0);
  d[1] = 0x59; d[2] = 0x11;
  [...text].forEach((c, i) => { d[6 + i] = c.charCodeAt(0); });
  return [0xF0, ...pack7(d), 0xF7];
}
// what a firmware is, by its identity, for a refusal that says so
export function firmwareName(id) {
  if (!id) return "nothing";
  if (id.loader) return "the update loader";
  if (id.text.startsWith(EG_PREFIX)) return "EVILGENIUS";
  if (id.text.startsWith("FM-1_46")) return "FIZZ";
  if (/^FM-1_0\d\d$/.test(id.text)) return "M-VAVE's firmware";
  return id.text;
}

// ---- EvilGenius's own frames (7D 45 47 01)
export const EG_ID = [0x7D, 0x45, 0x47], EG_PROTO = 1;
export function egFrame(cmd, body = []) {
  let s = cmd;
  for (const b of body) s += b;
  return [0xF0, ...EG_ID, EG_PROTO, cmd & 0x7F, ...body.map((b) => b & 0x7F), (0x80 - (s & 0x7F)) & 0x7F, 0xF7];
}
// -> {cmd, body} | null (not EvilGenius's, another protocol version, a wrong checksum)
export function parseEg(p) {
  if (!isSysex(p) || p.length < 8 || p[1] !== EG_ID[0] || p[2] !== EG_ID[1] || p[3] !== EG_ID[2] || p[4] !== EG_PROTO) return null;
  let s = 0;
  for (let i = 5; i < p.length - 1; i++) s += p[i];
  if (s & 0x7F) return null;
  return { cmd: p[5], body: Array.prototype.slice.call(p, 6, -2) };
}
export const egIdentityRequest = () => egFrame(0x01);
// IDENTITY's answer (41 <protocol> <ASCII>) -> its text | null
export function parseEgIdentity(p) {
  const r = parseEg(p);
  return r && r.cmd === 0x41 && r.body.length >= 1 ? String.fromCharCode(...r.body.slice(1)) : null;
}
