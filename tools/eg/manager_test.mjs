// SPDX-License-Identifier: MPL-2.0
// EvilGenius's manager without hardware: the page's modules (site/manager/egwire.js, egstore.js, egfiles.js,
// eglink.js) against frames captured from a real FM-1 and from fm1-base's Python codec, a store image built here, and
// a simulated FM-1 that speaks the port's protocol (firmware/app/app.c app_usb_cmd: FZBI, FZBR, FZSR and its pulls);
// EvilGenius's own SysEx (egsysex.js, egsound.js) against replies captured from the unit (tools/eg/fixtures/
// sysex_frames.json: STATUS, PROJECTS, LIST with the factory's, a track's and a factory preset's DUMP, a refused PARAM)
// and the same simulated FM-1 answering it.
//
//   node tools/eg/manager_test.mjs
import * as W from "../../site/manager/egwire.js";
import * as S from "../../site/manager/egstore.js";
import * as F from "../../site/manager/egfiles.js";
import { findUnit, EgLink, Port } from "../../site/manager/eglink.js";
import * as X from "../../site/manager/egsysex.js";
import * as N from "../../site/manager/egsound.js";
import { VALUES, DESTS, DEST_ID } from "../../site/manager/egvalues.js";
import { readFileSync } from "node:fs";
import { SimUnit as EgSim } from "../../site/manager/egsim.js";
import { Live, plan, destOf, unroute, PADS } from "../../site/manager/eglive.js";
import { filterRows } from "../../site/manager/eglibrary.js";
import { help } from "../../site/manager/eghelp.js";
import * as Q from "../../site/manager/egseq.js";
import { SeqEditor } from "../../site/manager/egseqedit.js";
const FX = JSON.parse(readFileSync(new URL("./fixtures/sysex_frames.json", import.meta.url)));

let fails = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails++; console.log(`  FAIL ${msg}`); } };
const hex = (s) => Uint8Array.from(Buffer.from(s.replace(/\s+/g, ""), "hex"));
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const throws = async (fn, want, msg) => {
  try { await fn(); check(false, `${msg}: did not refuse`); }
  catch (e) { check(want instanceof RegExp ? want.test(e.message) : e.code === want, `${msg}: refused with ${e.code || ""} "${e.message}"`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the wire
console.log("wire");
{
  const data = Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xFF);
  for (const n of [0, 1, 6, 7, 8, 13, 256, 300]) check(same(W.unpack7(W.pack7(data.slice(0, n))).slice(0, n), data.slice(0, n)), `pack7 round trip, ${n} bytes`);
  // fm1-base's Python codec (firmware/fm1-base/tools/fm1_install.py frame(), response()) made these
  check(same(W.bulkFrame("FZBI"), hex("f000321922000000235a0425220df7")), "FZBI's request as fm1_install.py frames it");
  check(same(W.bulkFrame("FZBR", [0x1200, 256]), hex("f000321962000000235a04490220020000000200000017f7")), "FZBR's request");
  check(same(W.bulkFrame("FZSR", [200704, 0xdc83e2f1]), hex("f000321962000000235a2649020062000071450f645d0ef7")), "FZSR's request");
  check(same(W.response(0x200, [1, 2, 3, 4, 5, 6, 7, 8], 3), hex("f00032410101004001000400000001000001040c2050404103081c03f7")), "a pull's answer");
  // a real FM-1 running EvilGenius sent these (2026-11-14)
  const id = W.parseIdentity(hex("f0 00 32 45 58 01 00 00 23 4d 5a 44 79 45 26 0d 18 30 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 40 39 f7"));
  check(id && id.text === "FM-1_4500" && id.evilgenius && !id.loader, "the unit's handshake answer: FM-1_4500, EvilGenius");
  const bi = W.parseBulk(hex("f0 00 32 19 02 01 00 00 23 5a 04 25 02 00 5e 02 00 00 20 0c 00 10 5e 78 41 5c 2b 02 f7"));
  check(bi && bi.tag === "FZBI" && W.rd32(bi.data, 0) === 0xAF000 && W.rd32(bi.data, 4) === 200704 && W.rd32(bi.data, 8) === 0xdc83e2f1, "the unit's FZBI answer: 0xAF000, 200704 bytes");
  check(W.rd32(bi.data, 0) === S.LAYOUT.region && W.rd32(bi.data, 4) === S.LAYOUT.size, "the unit's store is the layout egstore.js knows");
  const bad = hex("f0 00 32 19 02 01 00 00 23 5a 04 25 02 00 5e 02 00 00 20 0c 00 10 5e 78 41 5c 2b 03 f7");
  check(W.parseBulk(bad) === null, "a frame with a wrong checksum is not read");
  check(W.parseBulk([0x90, 60, 100]) === null && W.parseIdentity([0xF0, 0xF7]) === null && W.parseRequest([]) === null, "what is not a frame is not read");
  const q = W.parseRequest(W.readRequest(0x30000, 512, 2));
  check(q && q.addr === 0x30000 && q.len === 512 && q.fl === 2, "a pull request read");
  const a = W.parseResponse(W.response(0x30000, data.slice(0, 256), 2));
  check(a && a.addr === 0x30000 && a.fl === 2 && same(a.data, data.slice(0, 256)), "a pull's answer read back");
  check(W.crc32(new TextEncoder().encode("123456789")) === 0xCBF43926, "CRC-32");
  check(W.firmwareName(W.parseIdentity(W.identityFrame("FM-1_46001100"))) === "FIZZ" && W.firmwareName(W.parseIdentity(W.identityFrame("FM-1_016"))) === "M-VAVE's firmware" &&
    W.parseIdentity(W.identityFrame("ota-FM1C_3")).loader, "other firmwares named");
  // EvilGenius's own frames (core/app/fizz_sx.c: F0 7D 45 47 01 cmd body chk F7, the sum of cmd..chk 0 mod 128)
  check(same(W.egIdentityRequest(), [0xF0, 0x7D, 0x45, 0x47, 0x01, 0x01, 0x7F, 0xF7]), "IDENTITY's request: 7D 45 47");
  const ver = W.egFrame(0x41, [1, ...[..."EVILGENIUS 1.0"].map((c) => c.charCodeAt(0))]);
  check(ver.slice(5, -1).reduce((x, y) => x + y, 0) % 128 === 0 && W.parseEgIdentity(ver) === "EVILGENIUS 1.0", "IDENTITY's answer read");
  const fz = ver.slice(); fz[2] = 0x46; fz[3] = 0x5A;
  check(W.parseEgIdentity(fz) === null, "FIZZ's identity (7D 46 5A) is not EvilGenius's");
}

// ---------------------------------------------------------------- the store
console.log("store");
const RK = (kind, p, i) => ((kind << 24) | (p << 16) | i) >>> 0;
// a packed sound the firmware reads (quad_voice.c qd_quad_unpack: 'S', 2, every value at its least or a little above)
const blob = (seed) => { const b = new Uint8Array(S.BLOB); b[0] = 0x53; b[1] = 2; b[40] = seed & 3; return b; };
const snd = (name, seed, more = {}) => ({ name, blob: blob(seed), tags: 1 << (seed % 7), pan: (seed % 9) - 4, chorus: seed % 5, delay: 0, reverb: 7, ...more });
const hdr = (name) => { const b = new Uint8Array(187); b[0] = 0x48; b[1] = 1; [...name].forEach((c, i) => { b[2 + i] = c.charCodeAt(0); }); return b; };
const set = () => { const b = new Uint8Array(99); b[0] = 0x47; b[1] = 2; return b; };
const pat = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xFF);
function makeImage({ presets = [], projects = ["ALPHA", "BRAVO"], magic = "EGB2", ftag = true } = {}) {
  const img = new Uint8Array(S.LAYOUT.size).fill(0xFF);
  const lib = presets.map((p, k) => ({ key: RK(5, 0, p.place ?? k), bytes: S.presetRecord({ ...p, id: p.id ?? 0x180 + k, flags: 0 }) }));
  if (ftag) { const f = new Uint8Array(27); f[0] = 0x46; f[1] = 2; f[25] = 0x90; f[26] = 0x01; lib.push({ key: RK(6, 0, 0), bytes: f }); }
  S.writeStore(img, S.LAYOUT.lib.base, S.LAYOUT.lib.nsec, lib, magic, S.LAYOUT.lib.reserve);
  const prj = [{ key: RK(1, 0, 0), bytes: set() }, ...projects.flatMap((n, p) => [{ key: RK(2, p, 0), bytes: hdr(n) }, { key: RK(3, p, 0), bytes: pat(5000) }])];
  S.writeStore(img, S.LAYOUT.prj.base, S.LAYOUT.prj.nsec, prj, magic, S.LAYOUT.prj.reserve);
  return img;
}
{
  const mine = [snd("HOT RHINO", 1), snd("COLD CAT", 2), snd("WARM DOG", 3, { place: 7 })];
  const img = makeImage({ presets: mine });
  const s = S.readImage(img);
  check(s.magic === "EGB2" && !s.blank && s.format === 2, "an image read: its magic, its format");
  check(s.projects.length === 2 && s.projects[0].name === "ALPHA" && s.projects[1].slot === 2, "its projects");
  check(s.presets.length === 3 && s.presets[2].slot === 8 && s.presets[0].name === "HOT RHINO" && same(s.presets[1].blob, mine[1].blob) &&
    s.presets[1].pan === mine[1].pan && s.presets[1].tags === mine[1].tags && s.presets[1].reverb === 7 && s.idNext === 0x190, "its presets, as written");
  const l = S.readLibrary(img.subarray(0, S.LIB_BYTES));
  check(l.presets.length === 3 && l.magic === "EGB2" && l.idNext === 0x190, "MY PRESETS' sectors alone read the same");
  check(S.PRESET_REC === 151, "a preset's record is 151 bytes (persist.c ser_snd 'S' 5)");

  // a later record wins its key; a damaged page loses its record, not the store
  const two = new Uint8Array(S.LAYOUT.size).fill(0xFF);
  S.writeStore(two, 0, 11, [{ key: RK(5, 0, 0), bytes: S.presetRecord({ ...snd("OLD", 1), id: 300, flags: 0 }) }, { key: RK(5, 0, 0), bytes: S.presetRecord({ ...snd("NEW", 2), id: 300, flags: 0 }) },
    { key: RK(5, 0, 1), bytes: S.presetRecord({ ...snd("KEPT", 3), id: 301, flags: 0 }) }], "EGB2", 2);
  check(S.readImage(two).presets.map((p) => p.name).join() === "NEW,KEPT", "the later record wins its key");
  two[S.PAGE * 2 + 40] ^= 1;
  check(S.readImage(two).presets.map((p) => p.name).join() === "OLD,KEPT", "a damaged page: its record is dropped (its CRC-16), the one before stands");

  // what is not an EvilGenius backup
  await throws(() => S.readImage(img.subarray(0, 1000)), "size", "a short file");
  await throws(() => S.readImage(new Uint8Array(73 * 4096).fill(0xFF)), "size", "FIZZ's USB package's size");
  await throws(() => S.readImage(makeImage({ presets: mine, magic: "Z2FB" })), /FIZZ backup/, "a FIZZ store of the same size");
  const mixed = makeImage({ presets: mine }); mixed[S.LAYOUT.prj.base + 3] = 0x31;   // (the projects' first sector "EGB1")
  await throws(() => S.readImage(mixed), "mixed", "sectors of two store versions");
  const junk = new Uint8Array(S.LAYOUT.size).map((_, i) => (i * 31) & 0xFF);
  await throws(() => S.readImage(junk), "nostore", "200704 bytes of something else");
  const empty = S.readImage(new Uint8Array(S.LAYOUT.size).fill(0xFF));
  check(empty.blank && !empty.presets.length && !empty.projects.length, "an erased store reads as empty");

  // presets added
  const add = [snd("ZZ TEST", 4), snd("HOT RHINO", 1), snd("ZZ TEST", 4), snd("HOT RHINO", 2)];
  const r = S.addPresets(img, add);
  const t = S.readImage(r.image);
  check(r.added.length === 2 && r.skipped.length === 2 && r.added[0].slot === 3 && r.added[1].slot === 4, "new sounds into the first free places; one already there and one given twice skipped");
  check(r.added[0].id === 0x190 && r.added[1].id === 0x191 && t.idNext === 0x192, "their ids above every id given before; the next id kept");
  check(t.presets.length === 5 && t.presets.find((p) => p.slot === 3).name === "ZZ TEST" && t.presets.find((p) => p.slot === 3).imported &&
    same(t.presets.find((p) => p.slot === 4).blob, add[3].blob) && t.presets.find((p) => p.slot === 8).name === "WARM DOG", "the new image holds the old presets and the new");
  check(same(r.image.subarray(S.LIB_BYTES), img.subarray(S.LIB_BYTES)), "the projects' sectors are byte for byte as they were");
  check(same(img, makeImage({ presets: mine })), "the image given is not changed");
  const again = S.addPresets(r.image, add);
  check(!again.added.length && again.skipped.length === 4 && same(again.image, r.image), "the same import again changes nothing");
  // ids without the next-id record: above the library's highest and its 128 first ids
  const noF = S.addPresets(makeImage({ presets: [snd("A", 1, { id: 900 })], ftag: false }), [snd("B", 2)]);
  check(noF.added[0].id === 901 && S.readImage(noF.image).idNext === 902, "no next-id record: above the highest id there, and one is written");
  const low = S.addPresets(makeImage({ presets: [snd("A", 1, { id: 0x101 })], ftag: false }), [snd("B", 2)]);
  check(low.added[0].id === 0x180, "never an id of the first 128 (0.6's own)");
  // full
  const full = makeImage({ presets: Array.from({ length: 127 }, (_, k) => snd(`P${k}`, k)) });
  check(S.addPresets(full, [snd("LAST", 5)]).added[0].slot === 128, "the 128th place taken");
  await throws(() => S.addPresets(full, [snd("LAST", 5), snd("MORE", 6)]), "full", "more sounds than free places");
  const all = S.readImage(S.addPresets(full, [snd("LAST", 5)]).image);
  check(all.presets.length === 128 && all.used.lib[0] === 129, "128 presets and the tags' record fit MY PRESETS' sectors");
  await throws(() => S.addPresets(new Uint8Array(S.LAYOUT.size).fill(0xFF), [snd("X", 1)]), "nomagic", "an erased store, its version unknown");
  check(S.readImage(S.addPresets(new Uint8Array(S.LAYOUT.size).fill(0xFF), [snd("X", 1)], { magic: "EGB2" }).image).presets[0].name === "X", "an erased store, its version given");
  await throws(() => S.addPresets(img, [{ ...snd("BAD", 1), blob: new Uint8Array(96) }]), /not an EVILGENIUS sound/, "a 96-byte FIZZ patch");
}

// ---------------------------------------------------------------- the files
console.log("files");
{
  const img = makeImage({ presets: [snd("HOT RHINO", 1), snd("a/b:c", 2)] });
  const ps = S.readImage(img).presets;
  const one = F.readSounds(F.soundFile(ps[0], { firmware: "FM-1_4500", store: "EGB2" }), "x.egsnd");
  check(one.length === 1 && one[0].name === "HOT RHINO" && same(one[0].blob, ps[0].blob) && one[0].tags === ps[0].tags && one[0].pan === ps[0].pan &&
    one[0].chorus === ps[0].chorus && one[0].reverb === ps[0].reverb, "a sound written and read back the same");
  const many = F.readSounds(new TextEncoder().encode(F.soundsFile(ps)), "x.egsnds");
  check(many.length === 2 && many[1].name === "A/B:C" && same(many[1].blob, ps[1].blob), "several sounds in one file, read from bytes");
  check(F.soundName(ps[1]) === "a_b_c.egsnd" && /^EVILGENIUS backup \d{4}-\d\d-\d\d \d{4}\.egbak$/.test(F.backupName()), "file names");
  check(F.cleanName("  hot\trhino the second ") === "HOT RHINO TH" && F.cleanName("é") === "?", "a name as the unit keeps one");
  const j = JSON.parse(F.soundFile(ps[0]));
  const bad = (change, want, msg) => throws(() => { const x = structuredClone(j); change(x); return F.readSounds(JSON.stringify(x), "x.egsnd"); }, want, msg);
  await throws(() => F.readSounds("hello", "notes.txt"), /not an EVILGENIUS sound file/, "a text file");
  await throws(() => F.readSounds(img, "store.egbak"), /not an EVILGENIUS sound file/, "a backup given as a sound");
  await throws(() => F.readSounds("[1,2]", "x.json"), /not an EVILGENIUS sound file/, "other JSON");
  await bad((x) => { x.format = "fizz-sound"; }, /FIZZ file/, "a FIZZ sound");
  await bad((x) => { x.version = 2; }, /newer manager/, "a newer file version");
  await bad((x) => { x.patch = x.patch.slice(0, 40); }, /no patch of 128 bytes/, "a short patch");
  await bad((x) => { x.patch = "!!!"; }, /no patch/, "a patch that is not base64");
  await bad((x) => { x.patch = btoa("F" + atob(x.patch).slice(1)); }, /not a SID patch/, "a patch that is not a SID one");
  await bad((x) => { x.patch = btoa("S\x03" + atob(x.patch).slice(2)); }, /newer EVILGENIUS/, "a newer patch version");
  await bad((x) => { x.name = ""; }, /no name/, "no name");
  await throws(() => F.readSounds(JSON.stringify({ format: F.SOUNDS, version: 1 }), "x"), /holds no sounds/, "a bundle without sounds");
  const odd = F.readSounds(JSON.stringify({ ...j, tags: 5, pan: 999, chorus: "x" }), "x")[0];
  check(odd.tags === 5 && odd.pan === 63 && odd.chorus === 0, "odd values clamped");
}

// ---------------------------------------------------------------- the link, against a simulated FM-1
console.log("link");
// an FM-1 as the page sees one: a MIDI port that answers the handshake and the port's cmd 46 (app.c app_usb_cmd)
class SimUnit {
  constructor({ name = "FM-1", id = "FM-1_4500", image = makeImage(), drop = 0, silent = false, semantic = null } = {}) {
    Object.assign(this, { name, id, image, drop, silent, semantic, playing: false, seen: 0, frames: [], restores: 0, onRead: null, waiting: null, sent: 0 });
    this.input = { name, state: "connected", onmidimessage: null, open: async () => {} };
    this.output = { name, state: "connected", open: async () => {}, send: (b) => { if (this.output.state !== "connected") throw new Error("gone"); this.sent++; setImmediate(() => this.take(Array.from(b))); } };
  }
  unplug() { this.input.state = this.output.state = "disconnected"; }
  out(bytes) { setImmediate(() => { if (this.input.onmidimessage && this.input.state === "connected") this.input.onmidimessage({ data: Uint8Array.from(bytes) }); }); }
  take(p) {
    if (this.silent) return;
    this.seen++;
    if (this.drop && this.seen % this.drop === 0) return;            // (a frame lost on the way)
    this.frames.push(p);
    if (same(p, W.HS_QUERY)) { this.out(W.identityFrame(this.id)); return; }
    if (this.semantic && same(p, W.egIdentityRequest())) { this.out(W.egFrame(0x41, [1, ...[...this.semantic].map((c) => c.charCodeAt(0))])); return; }
    if (this.sem && this.answer(p)) return;
    const a = W.parseResponse(p);
    if (a) { if (this.waiting) this.waiting(a); return; }
    const b = W.parseBulk(p);
    if (!b) return;
    if (b.tag === "FZBI") this.out(W.bulkFrame("FZBI", [S.LAYOUT.region, this.image.length, W.crc32(this.image)]));
    else if (b.tag === "FZBR") {
      const off = W.rd32(b.data, 0), n = W.rd32(b.data, 4);
      if (n > 256 || off + n > this.image.length) { this.out(W.bulkFrame("FZER", [11])); return; }
      this.out(W.bulkFrame("FZBD", [off], Array.from(this.image.subarray(off, off + n))));
      if (this.onRead) this.onRead(off);
    } else if (b.tag === "FZSR") this.restore(W.rd32(b.data, 0), W.rd32(b.data, 4));
  }
  // EvilGenius's own SysEx, as the unit answers it (the replies captured from it; PARAM, TAGS, RENAME kept)
  answer(p) {
    const r = W.parseEg(p);
    if (!r) return false;
    const ack = (cmd, st, a, b) => this.out(W.egFrame(0x52, [cmd, st, (a >> 7) & 127, a & 127, (b >> 7) & 127, b & 127]));
    const sem = this.sem, b = r.body;
    sem.cmds.push(r.cmd);
    if (r.cmd === X.CMD1.STATUS) this.out(hex(FX.status[0]));
    else if (r.cmd === X.CMD1.PROJECTS) this.out(hex(FX.projects[0]));
    else if (r.cmd === X.CMD.LIST) for (const f of FX.listf) this.out(hex(f));
    else if (r.cmd === X.CMD.DUMP && b[0] === X.SOURCE_TRACK) this.out(hex(FX.track1[0]));
    else if (r.cmd === X.CMD.DUMP && b[0] === 1) this.out(hex(FX.factory1[0]));
    else if (r.cmd === X.CMD.PARAM) {
      const t = b[0], id = b[1], v = ((b[2] << 14) | (b[3] << 7) | b[4]) - (1 << 20);
      if (t > 5 && t !== 127) { ack(X.CMD.PARAM, X.ST.BAD_TRACK, t + 1, id); return true; }
      sem.params.push([t, id, v]);
      if (b[5] & 1) ack(X.CMD.PARAM, 0, t + 1, id);
    } else if (r.cmd === X.CMD1.TAGS) { sem.tags.push([b[0], (b[1] << 7) | b[2], b[3]]); ack(r.cmd, 0, 0, 0); }
    else if (r.cmd === X.CMD1.RENAME) { sem.names.push(String.fromCharCode(...b.slice(3, 15)).trimEnd()); ack(r.cmd, 0, 0, 0); }
    else if (r.cmd === X.CMD.STORE6) { sem.stores.push(b); this.out(W.egFrame(0x50, [0, b[0] & 1, 0, 7])); }
    else this.out(W.egFrame(0x7F, [X.ST.BAD_COMMAND, r.cmd]));
    return true;
  }
  async pull(addr) {                                                 // (fz_pull: asked again until it comes)
    for (let k = 0; k < 20; k++) {
      const got = new Promise((r) => { this.waiting = r; });
      this.out(W.readRequest(addr, 512, k & 0xFF));
      const a = await Promise.race([got, sleep(12).then(() => null)]);
      if (a && a.addr === addr && a.data.length === 512) { this.waiting = null; return a.data; }
    }
    this.waiting = null;
    return null;
  }
  async restore(len, crc) {
    if (this.restoring) return;
    this.restoring = true;
    const done = (tag, code) => { this.restoring = false; this.out(W.bulkFrame(tag, [code])); };
    if (this.playing) return done("FZER", 10);
    if (len !== this.image.length) return done("FZER", 11);
    let c = 0;
    for (let a = 0; a < len; a += 512) { const d = await this.pull(a); if (!d) return done("FZER", 12); c = W.crc32(d, c); }
    if (c !== crc) return done("FZER", 12);
    const next = new Uint8Array(len);
    for (let a = 0; a < len; a += 512) { const d = await this.pull(a); if (!d) { this.image = new Uint8Array(len).fill(0xFF); return done("FZER", 13); } next.set(d, a); }
    this.image = next;
    this.restores++;
    done("FZOK", 1);
  }
}
const quick = (l) => { l.gap = 0; l.rto = 40; return l; };              // (the tests do not wait as a real link does)
const accessOf = (...units) => ({ inputs: new Map(units.map((u, i) => [`in${i}`, u.input])), outputs: new Map(units.map((u, i) => [`out${i}`, u.output])) });
{
  const mine = [snd("HOT RHINO", 1), snd("COLD CAT", 2)];
  const unit = new SimUnit({ image: makeImage({ presets: mine }) });
  const link = quick(await findUnit(accessOf(new SimUnit({ name: "Onyx Producer 2-2", silent: true }), unit)));
  check(link instanceof EgLink && link.id === "FM-1_4500" && link.port === "FM-1", "the FM-1 found among the ports");
  check(await link.version() === null, "no answer to EvilGenius's own IDENTITY: null (today's firmware)");
  const info = await link.info();
  check(info.lo === 0xAF000 && info.size === 200704 && info.crc === W.crc32(unit.image), "the store's place, size and CRC-32");
  let last = 0;
  const b = await link.backup((f) => { last = f; });
  check(same(b.image, unit.image) && b.crc === W.crc32(unit.image) && last === 1, "a backup is the unit's store, byte for byte");
  const l = await link.library();
  check(S.readLibrary(l.bytes).presets.length === 2 && l.bytes.length === S.LIB_BYTES && !l.moving, "MY PRESETS' sectors read");

  // the import, end to end: backup, the presets added, the store written back, read again
  const r = S.addPresets(b.image, F.readSounds(F.soundsFile([{ ...snd("ZZ TEST", 9), slot: 1 }]), "t.egsnds"));
  const phases = [];
  const res = await link.restore(r.image, { onPhase: (p) => phases.push(p), onProgress: (f) => { last = f; } });
  check(res.ok && same(unit.image, r.image) && phases.join() === "check,write" && last === 1, "a restore: the unit pulls the image twice and holds it after");
  check(S.readLibrary((await link.library()).bytes).presets.map((p) => p.name).join() === "HOT RHINO,COLD CAT,ZZ TEST", "the imported preset is in MY PRESETS");

  // refusals from the unit
  unit.playing = true;
  const before = unit.image;
  await throws(() => link.restore(b.image), "fzer", "a restore while playing (FZER 10)");
  try { await link.restore(b.image); } catch (e) { check(e.fzer === 10 && e.written === false && /playing/.test(e.message), "playing: said so, nothing written"); }
  check(unit.image === before, "the store untouched after the refusal");
  unit.playing = false;
  try { await link.restore(b.image.subarray(0, 4096)); check(false, "a short image"); } catch (e) { check(e.fzer === 11 && !e.written, "an image of another size refused (FZER 11)"); }
  link.close();

  // frames lost on the way (one in seven): asked again, the result the same
  const lossy = new SimUnit({ image: makeImage({ presets: mine }), drop: 7 });
  const ll = quick(await findUnit(accessOf(lossy)));
  const lb = await ll.backup();
  check(same(lb.image, lossy.image), "a backup over a link that loses frames");
  const lr = S.addPresets(lb.image, [snd("LOSSY", 3)]);
  await ll.restore(lr.image);
  check(same(lossy.image, lr.image), "a restore over a link that loses frames");
  ll.close();

  // the store changing while it is read (an autosave): read again; one that keeps changing: refused
  const busy = new SimUnit({ image: makeImage({ presets: mine }) });
  let hits = 0;
  busy.onRead = (off) => { if (off === 0x8000 && !hits++) { busy.image = Uint8Array.from(busy.image); busy.image[0x9000 + 20] ^= 0xFF; } };
  const bl = quick(await findUnit(accessOf(busy)));
  const bb = await bl.backup();
  check(same(bb.image, busy.image) && hits === 2, "a store that changed while read is read again");
  busy.onRead = (off) => { if (off === 0x8000) { busy.image = Uint8Array.from(busy.image); busy.image[0x9000 + 21]++; } };
  await throws(() => bl.backup(), "changed", "a store that keeps changing");
  busy.onRead = null;
  busy.unplug();
  await throws(() => bl.info(), "lost", "the cable pulled");
  bl.close();

  // who is not there
  await throws(() => findUnit(accessOf()), "noport", "no MIDI port at all");
  await throws(() => findUnit(accessOf(new SimUnit({ name: "Onyx Producer 2-2" }))), "noport", "only other gear (never asked)");
  const other = new SimUnit({ name: "Onyx Producer 2-2" });
  await findUnit(accessOf(other)).catch(() => {});
  check(other.sent === 0, "other gear is sent nothing");
  await throws(() => findUnit(accessOf(new SimUnit({ id: "FM-1_46001100" }))), /runs FIZZ/, "an FM-1 running FIZZ");
  await throws(() => findUnit(accessOf(new SimUnit({ id: "FM-1_016" }))), /M-VAVE's firmware/, "an FM-1 running M-VAVE's firmware");
  await throws(() => findUnit(accessOf(new SimUnit({ id: "ota-FM1C_3" }))), "update", "an FM-1 in update mode");
  const ble = new SimUnit({ name: "FM-1 1A2B Bluetooth" });
  await throws(() => findUnit(accessOf(ble)), "ble", "an FM-1 over Bluetooth only");
  check(ble.sent === 0, "the Bluetooth port is sent nothing");
  const both = await findUnit(accessOf(ble, new SimUnit()));
  check(both.port === "FM-1" && ble.sent === 0, "USB and Bluetooth both there: the USB port, the Bluetooth one untouched");
  both.close();
  await throws(() => findUnit(accessOf(new SimUnit({ silent: true }))), "silent", "an FM-1 that does not answer");
  const talk = await findUnit(accessOf(new SimUnit({ semantic: "EVILGENIUS 1.0" })));
  check(await talk.version() === "EVILGENIUS 1.0", "a firmware that answers IDENTITY: its text");
  talk.close();

  // a frame the browser delivers in parts is joined
  const inp = { state: "connected" }, port = new Port(inp, { state: "connected", send() {} });
  const fr = W.bulkFrame("FZBI", [1, 2, 3]);
  inp.onmidimessage({ data: Uint8Array.from(fr.slice(0, 9)) });
  inp.onmidimessage({ data: Uint8Array.from([0xF8]) });
  inp.onmidimessage({ data: Uint8Array.from(fr.slice(9)) });
  check(same(await port.read(10), fr), "a frame in two parts, a clock byte between");
}

// ---------------------------------------------------------------- EvilGenius's own SysEx
console.log("sysex");
{
  const id = X.identity();
  check(same(id, hex("F07D454701017FF7")), "IDENTITY's frame: 7D 45 47, protocol 1, its checksum");
  for (const [k, list] of Object.entries(FX)) for (const f of list) check(X.parseReply(hex(f)) !== null, `the unit's ${k} reply is read`);
  check(X.parseReply(hex(FX.status[0]).map((v, i, a) => (i === a.length - 2 ? v ^ 1 : v))) === null, "a bad checksum: not read");
  const fizz = hex(FX.status[0]); fizz[2] = 0x46; fizz[3] = 0x5a;
  check(X.parseReply(fizz) === null, "FIZZ's id (7D 46 5A): not EvilGenius's");
  const st = X.parseStatus(hex(FX.status[0]));
  check(st.tracks === 6 && st.package === "ble" && st.nproj === 4 && st.nlib === 128 && st.lib[1] === 165, "STATUS: tracks, the package, its places, the store's pages");
  const pj = X.parseProjects(hex(FX.projects[0]));
  check(pj.list.length === 4 && pj.list[0].current && pj.list[1].there && !pj.list[3].there, "PROJECTS: four places, the current one, which are there");
  const parts = FX.listf.map((f) => X.parseList(hex(f)));
  const rows = parts.flatMap((l) => l.entries);
  check(parts.at(-1).last && rows.length === parts[0].total && rows.every((r) => r.source === "factory" || r.source === "pool"), "LIST: its parts, as many rows as its total");
  const td = X.parseDump(hex(FX.track1[0]));
  check(td.source === "track" && td.track === 0 && td.extras && td.blob.length === 128 && td.blob[0] === 0x53, "a track's DUMP: its track, its extras, SID TONE's blob");
  const fd = X.parseDump(hex(FX.factory1[0]));
  check(fd.source === "mine" || fd.source === "pool" || fd.slot >= 0, "a factory preset's DUMP read");
  const bad = X.parseAck(hex(FX.param_bad[0]));
  check(bad && bad.command === X.CMD.PARAM && bad.statusName === "BAD TRACK", "PARAM on track 10: the unit's BAD TRACK");
  const back = X.trackFrame(hex(FX.track1[0]));
  check(X.parseReply(back) === null && back[6] & X.FLAGS.AUDITION && !(back[6] & X.FLAGS.DUMP), "a track's DUMP sent back as an AUDITION (its checksum made again)");
  let threw = false; try { X.storeSound({ name: "X", blob: new Uint8Array(96) }); } catch (_) { threw = true; }
  check(threw, "a 96-byte (FM) blob refused: EvilGenius stores SID TONE's 128 bytes only");
  const pr = X.paramRequest({ track: 2, id: X.MIX_ID.PAN, value: -5, ack: true });
  check(pr[6] === 2 && pr[7] === 119 && ((pr[8] << 14) | (pr[9] << 7) | pr[10]) - (1 << 20) === -5 && pr[11] === 1, "PARAM: track, the mix's PAN id (119), a signed value, ACK");

  // the sound's values: the core's, packed as the core packs them
  check(N.NP === 119 && VALUES[N.ID.SAY][0] === "SAY" && VALUES[N.ID.MOD0][0] === "SOURCE" && VALUES[N.ID.VMODE][6] === 0, "egvalues.js: 119 values, SAY and MOD where quad_voice.h has them, VOICE not lockable");
  check(DESTS[2] === "CUTOFF" && DEST_ID[2] === N.ID.FREQ && DEST_ID[1] === -1 && DEST_ID.every((v) => v < N.NP), "the destinations: each its value (PITCH none)");
  if (DESTS.length > 20)                                   // (a core with the envelopes' destinations, QD_D_EA..FKTRK)
    check(DESTS[20] === "ATK" && DEST_ID[20] === N.ID.EATK && DEST_ID[36] === N.ID.FKTRK, "the destinations: EA..FKTRK, each its value");
  for (const [k, f] of [["track", td], ["factory", fd]]) {
    const sn = N.soundFromDump(f);
    check(sn && same(N.blobOf(sn.values), f.blob), `${k}: the unit's blob unpacked and packed again, byte for byte`);
  }
  let ok = true;
  for (let n = 0; n < 200; n++) {
    const v = VALUES.map(([, mn, mx]) => mn + Math.floor(Math.random() * (mx - mn + 1)));
    if (JSON.stringify(N.valuesOf(N.blobOf(v))) !== JSON.stringify(v)) { ok = false; break; }
  }
  check(ok, "200 random sounds: packed and unpacked, the same values");
  const v1 = N.blobOf(N.defaults()); v1[1] = 1;
  const old = N.valuesOf(v1);
  check(old && old[N.ID.SSPD] === VALUES[N.ID.SSPD][3], "a version-1 sound: SAY's values take their defaults");
  const over = N.blobOf(N.defaults()); over[2] = 200;
  check(N.valuesOf(over) === null, "a value out of its range: not a sound");
  const midi = new Uint8Array(128); midi[0] = 0x53; midi[1] = 2; midi.set([77, 73, 68, 73], 124);
  const ms = N.soundFromPreset({ name: "CCS", blob: midi });
  check(ms.midi && same(N.blobNow(ms), midi), "a MIDI track's sound kept as it came");
  check(N.text(N.ID.FDEPTH, 70) === "+6" && N.text(N.ID.C1, -3) === "-3" && N.text(N.ID.FTYPE, 1) === "LP" && N.text(X.MIX_ID.PAN, -5) === "L5", "the values' texts as the unit shows them");
  const s0 = N.soundFromDump(td);
  N.setValue(s0, N.lfo(1, "DEST"), 3); N.setValue(s0, N.lfo(1, "DEPTH"), 80);
  check(N.routes(s0.values).some((r) => r.kind === "lfo" && r.k === 1 && r.dest === 3 && r.depth === 16), "LFO 2 onto RESO: a route");
  check(N.clampV(N.ID.FREQ, 5000) === 2047, "a value clamped to its range");

  // the link: the unit's own SysEx through it
  const unit = new SimUnit({ image: makeImage() });
  unit.sem = { cmds: [], params: [], tags: [], names: [], stores: [] };
  const link = quick(await findUnit(accessOf(unit)));
  const ls = await link.status();
  check(ls && ls.kind === "status" && ls.tracks === 6, "link.status()");
  const lr = await link.list({ factory: true, pool: true });
  check(lr.length === rows.length, "link.list(): every part");
  const lt = await link.dumpTrack(1);
  check(lt && same(lt, hex(FX.track1[0])), "link.dumpTrack(1)");
  const a = await link.param(2, N.ID.FREQ, 1500);
  check(a.status === 0 && unit.sem.params.at(-1).join() === `2,${N.ID.FREQ},1500`, "link.param(): the value reaches the unit, its ACK");
  const nb = await link.param(9, 0, 1);
  check(nb.statusName === "BAD TRACK", "link.param() refused: the status said");
  const tg = await link.tags("mine", 3, ["BASS", "FX"]);
  check(tg.status === 0 && unit.sem.tags.at(-1).join() === `0,3,${1 | 64}`, "link.tags(): MY PRESETS 3 tagged BASS and FX");
  await link.rename("mine", 3, "NEW NAME");
  check(unit.sem.names.at(-1) === "NEW NAME", "link.rename()");
  const sr = await link.store(N.storeFrameOf(s0, { slot: 0 }));
  check(sr.kind === "store" && sr.slot === 7 && unit.sem.stores.length === 1, "link.store(): a STORE6, the place it went");
  const old2 = await link.browse(0, 5);
  check(old2.old === true, "a command the unit does not know: {old}");
  link.close();
}

// ---------------------------------------------------------------- EDIT and LIBRARY's model, against egsim.js
console.log("edit");
{
  const sim = new EgSim();
  const link = quick(await findUnit(sim.access));
  check(await link.version() === "EVILGENIUS SIM", "the simulated unit: found, its IDENTITY");
  const rows = await link.list({ factory: true });
  check(rows.length === 95 && rows[1].name === "SAW LEAD", "its LIST: the unit's 95 factory presets");
  const t1 = N.soundFromDump(X.parseDump(await link.dumpTrack(1)));
  check(t1 && t1.name === "ZAP" && same(t1.blob, sim.tracks[0].blob), "a track's DUMP: the unit's own sound");
  // live: a drag's many values: the latest of each id, one at a time with its ACK
  const errs = [];
  const live = new Live({ link, track: 0, onError: (e) => errs.push(e) });
  for (let v = 10; v <= 90; v += 5) live.set(N.ID.PW1, v);
  live.set(N.ID.FREQ, 1500); live.set(X.MIX_ID.PAN, -10);
  await live.idle();
  const sv = N.valuesOf(sim.tracks[0].blob);
  check(sv[N.ID.PW1] === 90 && sv[N.ID.FREQ] === 1500 && sim.tracks[0].pan === -10 && !errs.length, "LIVE: the values reach the track, the mix's PAN too");
  check(sim.counts.params <= 5, `LIVE: a drag of 17 values sent as ${sim.counts.params} PARAMs (only the latest of each)`);
  const bad = new Live({ link, track: 9, onError: (e) => errs.push(e) });
  bad.set(0, 1); await bad.idle();
  check(errs.length === 1 && errs[0].statusName === "BAD TRACK", "LIVE: a refusal reaches onError");
  // an AUDITION and the track put back
  const kept = await link.dumpTrack(2);
  const saw = N.soundFromDump(X.parseDump(await link.dump("factory", 2)));
  await link.store(N.storeFrameOf(saw, { track: 1, audition: true }));
  check(sim.tracks[1].name === "SAW LEAD" && !sim.mine.some(Boolean), "SEND TO TRACK: on the track, nothing stored");
  await link.store(X.trackFrame(kept));
  check(same(sim.tracks[1].blob, X.parseDump(kept).blob) && sim.tracks[1].name === X.parseDump(kept).name, "PUT TRACK BACK: the track as it was");
  // SAVE AS NEW, REPLACE, the library's commands
  const r1 = await link.store(N.storeFrameOf({ ...saw, name: "MY SAW" }, { slot: 0, own: true }));
  check(r1.slot === 1 && sim.mine[0].name === "MY SAW" && !sim.mine[0].imported, "SAVE AS NEW: MY PRESETS' first free place, the owner's");
  N.setValue(saw, N.ID.FREQ, 77);
  await link.store(N.storeFrameOf({ ...saw, name: "MY SAW" }, { slot: 1, own: true }));
  check(N.valuesOf(sim.mine[0].blob)[N.ID.FREQ] === 77 && sim.mine.filter(Boolean).length === 1, "REPLACE: the same place, the new sound");
  check((await link.rename("mine", 1, "SAW TWO")).status === 0 && sim.mine[0].name === "SAW TWO", "RENAME");
  check((await link.swap("mine", 1, 3)).status === 0 && sim.mine[2] && !sim.mine[0], "SWAP into an empty place: a move");
  check((await link.browse("selected", sim.mine[2].id)).status === 0, "BROWSE (LOAD ON FM-1)");
  const inUse = await link.remove("mine", 3);
  check(inUse.statusName === "IN USE", "DELETE of a preset a track plays: IN USE first");
  check((await link.remove("mine", 3, { confirm: true })).status === 0 && !sim.mine.some(Boolean), "DELETE confirmed");
  check(filterRows(rows, { q: "bass" }).every((r) => /bass/i.test(r.name)) && filterRows(rows, { src: "mine" }).length === 0 &&
    filterRows(rows, { tags: 1 }).every((r) => r.tags & 1), "LIBRARY's filters: a name, where, a tag");
  link.close();

  // routes: an LFO onto a value, a MOD source into the first free slot, FULL
  const v = N.defaults();
  const pl = plan(v, { kind: "lfo", k: 1 }, destOf(N.ID.RESO));
  check(destOf(N.ID.RESO) === 3 && pl.changes.some(([id, x]) => id === N.lfo(1, "DEST") && x === 3) && pl.changes.some(([id, x]) => id === N.lfo(1, "DEPTH") && x === 88),
    "LFO 2 onto RESO: its DEST, a depth that moves");
  for (const [id, x] of pl.changes) v[id] = x;
  check(plan(v, { kind: "lfo", k: 1 }, 3).existing, "the same route again: its card, nothing changed");
  const pm = plan(v, { kind: "mod", src: 1 }, destOf(N.ID.FREQ));
  check(pm.changes.join() === [[N.mod(0, 0), 1], [N.mod(0, 1), 2], [N.mod(0, 2), 40]].join(), "VEL onto CUTOFF: slot 1 at +40");
  for (let k = 0; k < 8; k++) { v[N.mod(k, 0)] = 2; v[N.mod(k, 1)] = 3; }
  check(plan(v, { kind: "mod", src: 1 }, 2).full, "every slot used: FULL");
  check(unroute({ kind: "mod", k: 3 }).join() === [N.mod(3, 0), 0].join(), "a route removed: the slot's SOURCE off");
  check(destOf(N.ID.W1) === -1 && PADS.includes(1) && PADS.includes(12), "a WAVE is no destination; PITCH and PAN are pads");
  check(VALUES.every((_, id) => help(id).length > 10), "every value has its help line");
}

// ---------------------------------------------------------------- the open pattern, read (docs/SEQ-SYSEX-PLAN.md phase 1)
console.log("seq");
{
  const st = { ...Q.emptyStep(), ovr: 0x16b, on: true, locked: true, type: 3, slots: [36, 40, 43, 0, 0, 0], vel: 99, len: 7, micro: -23,
    ratch: 8, ramp: 3, chance: 75, cond: 43, sound: 128, strum: 23, func: 158, mfx: 6 };
  check(JSON.stringify(Q.stepOf(Q.stepWire(st))) === JSON.stringify(st), "a step: its 20 bytes and back (every field at its edge)");
  const sim = new EgSim();
  const ts = sim.pat.tracks[2].set;
  check(JSON.stringify(Q.tsetOf(Q.tsetBytes(ts))) === JSON.stringify({ ...ts, rate: ts.rbase * 3 + ts.rtype }), "a track's settings: its 44 bytes and back");
  check(Q.loopSteps(ts).length === 32 && Q.loopSteps(ts)[16] === 16, "the loop: pages 1 and 2, 32 steps in order");
  const pl = Q.played(sim.pat.tracks[1].steps[4], sim.pat.tracks[1].set);
  check(pl.notes.join() === "36,40,43" && pl.chance === 75 && Q.condName(pl.cond) === "1:2" && pl.sound === 7 && pl.micro === 3 && pl.len === 4,
    "a step as it plays: its own notes, chance, condition (1:2), sound lock; the track's length");
  check(Q.played(Q.emptyStep(), sim.pat.tracks[0].set).notes.join() === "60" && Q.lenName(4) === "1" && Q.rateName(12) === "1/16" &&
    Q.lockName(31) === "CUTOFF" && Q.lockName(128) === "TV" && Q.funcName(1) === "RESTART", "the names: the core's own (egseqnames.js)");
  check(Q.played({ ...Q.emptyStep(), on: true, ovr: 1 << Q.PM.TRIG, type: 0 }, sim.pat.tracks[0].set).type === 1, "a trig with no type plays a NOTE");

  const link = quick(await findUnit(sim.access));
  const info = await link.patternInfo();
  check(info && info.pattern === 0 && info.rev === 1 && info.bpm === 120 && info.tracks.length === 6 && info.wire === 20 &&
    info.tsetSize === 44 && info.tracks[0].name === "ZAP" && info.nlock === 6, "PATTERN INFO: the pattern, its revision, its six tracks");
  const pat = Q.patternOf(info);
  check(pat.tracks[2].set.loop === 3 && pat.tracks[1].set.chan === 1, "PATTERN INFO: each track's settings decoded");
  const r = await link.steps(1, { locks: true });
  check(r && r.steps.length === 128 && r.steps.every(Boolean) && r.locks.length === 6, "STEPS: track 2's 128 steps and its 6 locks");
  Q.putSteps(pat, 1, 0, r.steps); Q.putLocks(pat, 1, r.locks);
  check(JSON.stringify(pat.tracks[1].steps) === JSON.stringify(sim.pat.tracks[1].steps) && pat.tracks[1].locks.find((l) => l.id === 119).value === -20,
    "STEPS: every step as the unit holds it, a negative lock value");
  const part = await link.steps(2, { first: 16, count: 8 });
  check(part && part.steps.length === 8 && Q.stepOf(part.steps[0]).slots[0] === 60 && part.locks === null, "STEPS: a range, no locks asked");
  sim.editPat((P) => { for (let s = 0; s < 128; s++) for (const id of [31, 32]) P.tracks[3].locks.push({ step: s, id, value: s * 7 + id }); });
  const many = await link.steps(3, { locks: true });
  check(many.locks.length === 256 && many.rev === 2 && many.locks[255].value === 127 * 7 + 32, "STEPS: 256 locks over three replies, the revision moved");
  const sts = await link.status();
  check(sts.rev === 2 && sts.package === "ble" && sts.nlib === 128, "STATUS: the revision last");
  check((await link.steps(9)).old === false && (await link.steps(9)).statusName === "BAD TRACK", "STEPS: track 10: BAD TRACK");
  link.close();
  // the core's own replies (core/tests/test_sysex.c --seq-frames: the host core's PATTERN INFO and STEPS of a track
  // with 271 locks) read by the page's parsers, against what the core holds
  const SF = JSON.parse(readFileSync(new URL("./fixtures/seq_frames.json", import.meta.url)));
  const ci = X.parseReply(hex(SF.pinfo));
  check(ci && ci.kind === "pinfo" && ci.pattern === SF.pattern && ci.rev === SF.rev && ci.bpm === SF.bpm && ci.nlock === SF.nlock &&
    same(ci.tracks[1].tset, hex(SF.tset1)) && ci.tracks[1].name === SF.name1, "the core's PATTERN INFO read: track 2's settings byte for byte");
  const cs = [], cl = [];
  let clast = false;
  for (const f of SF.steps) {
    const r = X.parseReply(hex(f));
    if (r && r.kind === "steps") r.steps.forEach((w, k) => { cs[r.first + k] = w; });
    if (r && r.kind === "locks") { cl.push(...r.locks); clast = r.last; }
  }
  check(cs.length === 128 && cs.every((w, k) => same(w, hex(SF.wire1[k]))), "the core's STEPS read: 128 steps, each the core's 20 bytes");
  check(clast && cl.length === SF.locks1.length && cl.every((l, k) => l.step === SF.locks1[k][0] && l.id === SF.locks1[k][1] && l.value === SF.locks1[k][2]),
    `the core's LOCKS read: ${cl.length} locks (ids past 127, negative values), the last marked`);
  check(Q.tsetOf(hex(SF.tset1)).pend[0] === 15 && Q.stepOf(hex(SF.wire1[0])).slots.slice(0, 3).join() === "36,40,43", "the core's bytes decoded: a page's end, a chord's slots");
  // an EVILGENIUS without them (0.1.x): BAD COMMAND, said as {old}
  const oldUnit = new SimUnit({ image: makeImage() });
  oldUnit.sem = { cmds: [], params: [], tags: [], names: [], stores: [] };
  const ol = quick(await findUnit(accessOf(oldUnit)));
  check((await ol.patternInfo()).old === true && (await ol.steps(0)).old === true, "a firmware without them: {old}");
  check(X.parseStatus(hex(FX.status[0])).rev === undefined, "STATUS of 0.1.x: no revision");
  ol.close();
}

// ---------------------------------------------------------------- the open pattern, written (phase 2)
console.log("seq write");
{
  // the page's frames, byte for byte the frames the core's own test sends (core/tests/test_sysex.c --seq-writes)
  const SW = JSON.parse(readFileSync(new URL("./fixtures/seq_writes.json", import.meta.url)));
  check(same(X.stepSetRequest({ pattern: SW.pattern, track: 3, steps: [0, 4, 8],
    fields: [[X.FIELD.TRIG, X.TRIG_ON], [X.FIELD.NOTES, [48, 52, 55]], [X.FIELD.VEL, 99]] }), hex(SW.chord[0])),
    "STEP SET: the page's frame is the core test's (a chord, a trig, a velocity on 1, 5, 9)");
  check(same(X.lockSetRequest({ pattern: SW.pattern, track: 3, steps: [0, 4],
    entries: [{ op: "set", id: 31, value: 1600 }, { op: "set", id: 128, value: 80 }] }), hex(SW.locks[0])),
    "LOCK SET: the page's frame is the core test's (CUTOFF 1600, TV 80)");
  check(X.maskOf([0, 6, 7, 127]).join() === [65, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2].join(), "the step mask: bit s % 7 of byte s / 7");
  let threw = 0;
  try { X.stepsPutRequest({ pattern: 0, track: 0, first: 0, wires: new Array(25).fill(new Uint8Array(20)) }); } catch (_) { threw++; }
  try { X.lockSetRequest({ pattern: 0, track: 0, steps: [0], entries: new Array(17).fill({ op: "set", id: 1, value: 1 }) }); } catch (_) { threw++; }
  check(threw === 2, "STEPS PUT over 24 steps, LOCK SET over 16 entries: refused before sending");
  check(X.stepsPutRequest({ pattern: 0, track: 0, first: 0, wires: new Array(24).fill(new Uint8Array(20)) }).length <= 640,
    "STEPS PUT of 24 steps fits the unit's 640-byte inbound frame");

  // the link against the simulated unit
  const sim = new EgSim();
  const link = quick(await findUnit(sim.access));
  const P = sim.pat.pattern;
  let a = await link.stepSet({ pattern: P, track: 3, steps: [0, 4, 8], fields: [[X.FIELD.TRIG, X.TRIG_ON], [X.FIELD.NOTES, [48, 52, 55]], [X.FIELD.VEL, 99]] });
  let st = sim.pat.tracks[3].steps[4];
  check(a.status === 0 && a.a === 4 && a.b === 3 && st.on && st.slots.slice(0, 3).join() === "48,52,55" && st.vel === 99,
    "stepSet: a chord on three steps (ACK a 4, b 3)");
  a = await link.stepSet({ pattern: P + 1, track: 3, steps: [1], fields: [[X.FIELD.VEL, 50]] });
  check(a.statusName === "BAD PATTERN" && a.b === P + 1, "stepSet for another pattern: BAD PATTERN, b the open one");
  a = await link.stepSet({ pattern: P, track: 3, steps: [1], fields: [[X.FIELD.VEL, 200]] });
  check(a.statusName === "BAD VALUE", "stepSet velocity 200: BAD VALUE");
  a = await link.lockSet({ pattern: P, track: 3, steps: [0, 4], entries: [{ op: "set", id: 31, value: 1600 }, { op: "set", id: 128, value: 80 }] });
  check(a.status === 0 && sim.pat.tracks[3].locks.filter((l) => l.id === 128).length === 2 && sim.pat.tracks[3].steps[0].locked,
    "lockSet: CUTOFF and TV on two steps");
  a = await link.lockSet({ pattern: P, track: 3, steps: [0, 4], entries: [{ op: "set", id: 32, value: 99 }] });
  check(a.statusName === "BAD VALUE", "lockSet RESO 99: BAD VALUE (the core's range, egseqnames.js)");
  const w = [0, 4, 8].map((s) => Q.stepWire(sim.pat.tracks[0].steps[s]));
  sim.hist && sim.closeGesture();
  await new Promise((r) => setTimeout(r, 520));
  a = await link.stepsPut({ pattern: P, track: 3, first: 8, wires: w });
  check(a.status === 0 && a.b === 3 && sim.pat.tracks[3].steps[8].slots[0] === 36, "stepsPut: three steps pasted");
  a = await link.undo();
  check(a.status === 0 && sim.pat.tracks[3].steps[8].slots.slice(0, 3).join() === "48,52,55", "undo: the paste undone");
  a = await link.undo(true);
  check(a.status === 0 && sim.pat.tracks[3].steps[8].slots[0] === 36, "redo: the paste again");
  for (let k = 0; k < 6; k++) a = await link.undo();
  check(a.statusName === "NOT FOUND" && !sim.pat.tracks[3].steps[4].on, "undo past the first level: NOT FOUND, the track as it was");
  // what the page reads back is what it wrote
  await link.stepSet({ pattern: P, track: 2, steps: [5], fields: [[X.FIELD.TRIG, X.TRIG_ON], [X.FIELD.COND, 9], [X.FIELD.CHANCE, 50], [X.FIELD.RATCH, 3 | (1 << 4)]] });
  const back = await link.steps(2, { first: 5, count: 1 });
  const b0 = Q.stepOf(back.steps[0]);
  check(b0.on && Q.condName(b0.cond) === "1:2" && b0.chance === 50 && b0.ratch === 3 && b0.ramp === 1, "written, then read back: 1:2, 50 %, x3 rising");
  link.close();
}

// ---------------------------------------------------------------- phase 3: a track's settings, another pattern
console.log("seq phase 3");
{
  const sim = new EgSim();
  const link = quick(await findUnit(sim.access));
  const P = sim.pat.pattern;
  let a = await link.trackSet({ pattern: P, track: 2, fields: [[X.TFIELD.LOOP, 3], [X.TFIELD.PEND, (1 << 4) | 7], [X.TFIELD.RATE, 9],
    [X.TFIELD.TRANSPOSE, -12], [X.TFIELD.DEF, (1 << 8) | 77], [X.TFIELD.DEFNOTE, 50]] });
  const info = Q.patternOf(await link.patternInfo()), ts = info.tracks[2].set;
  check(a.status === 0 && a.b === 6 && ts.loop === 3 && ts.pend[1] === 7 && Q.rateName(ts.rate) === "1/8" && ts.transpose === -12 &&
    ts.def.vel === 77 && ts.def.slots[0] === 50 && Q.loopSteps(ts).length === 24, "trackSet: loop, a page's end, 1/8, -12, the defaults; read back");
  a = await link.trackSet({ pattern: P, track: 2, fields: [[X.TFIELD.PSTART, (1 << 4) | 9]] });
  check(a.statusName === "BAD VALUE", "trackSet: a page's start past its end: BAD VALUE");
  a = await link.gotoPattern(5);
  const st = await link.status(), pi = await link.patternInfo();
  check(a.status === 0 && a.a === 6 && st.pattern === 5 && pi.pattern === 5, "gotoPattern(6): STATUS and PATTERN INFO say pattern 6");
  a = await link.stepSet({ pattern: 0, track: 0, steps: [0], fields: [[X.FIELD.VEL, 50]] });
  check(a.statusName === "BAD PATTERN" && a.b === 6, "a write for the pattern left: BAD PATTERN, b the open one");
  check(X.gotoRequest(5).length === 9 && X.trackSetRequest({ pattern: 0, track: 2, fields: [[0, 3]] }).length === 15, "the frames' sizes (GO TO 9 bytes, TRACK SET of one field 15)");
  link.close();
}

// ---------------------------------------------------------------- phase 4's overview: the project's patterns in the store
console.log("patterns");
{
  const img = new Uint8Array(S.LAYOUT.size).fill(0xFF);
  const patRec = (used) => { const b = new Uint8Array(40); b[0] = 0x50; b[1] = 6; b[2] = 20; b[3] = 44; b[7] = used; return b; };
  S.writeStore(img, S.LAYOUT.prj.base, S.LAYOUT.prj.nsec, [{ key: RK(1, 0, 0), bytes: set() }, { key: RK(3, 0, 2), bytes: patRec(1) },
    { key: RK(3, 0, 5), bytes: patRec(0) }, { key: RK(3, 1, 3), bytes: patRec(1) }], "EGB2", S.LAYOUT.prj.reserve);
  const p1 = S.patternsOf(img, 1), p2 = S.patternsOf(img.subarray(S.LAYOUT.prj.base, S.LAYOUT.prj.base + S.LAYOUT.prj.nsec * S.SECTOR), 2);
  check(p1.length === 64 && p1[2].used && p1[5].there && !p1[5].used && !p1[3].there, "project 1: A03 has steps, A06 is there but empty, A04 not there");
  check(p2[3].used && !p2[2].there, "project 2's from the projects' sectors alone: A04");
}

// ---------------------------------------------------------------- SEQUENCE's editing model, against the simulated unit
console.log("seq editor");
{
  const sim = new EgSim();
  const link = quick(await findUnit(sim.access));
  const errs = [];
  const ed = new SeqEditor({ link, onError: (m) => errs.push(m) });
  await ed.load();
  check(ed.pat.tracks.length === 6 && ed.pat.tracks[1].locks.length === 6 && ed.played(4, 1).notes.join() === "36,40,43", "load: six tracks, their locks, a chord as it plays");
  ed.track = 3;
  ed.addNote(2, 60); ed.addNote(2, 64); ed.addNote(2, 67);
  await ed.idle();
  check(sim.pat.tracks[3].steps[2].slots.slice(0, 3).join() === "60,64,67" && ed.played(2).notes.join() === "60,64,67", "addNote x3: a chord on the page and on the unit");
  ed.removeNote(2, 64);
  await ed.idle();
  check(sim.pat.tracks[3].steps[2].slots.filter(Boolean).join() === "60,67", "removeNote: the chord's middle note gone, on the unit too");
  for (let v = 10; v <= 120; v += 10) ed.setField([2], X.FIELD.VEL, v);
  await ed.idle();
  check(sim.pat.tracks[3].steps[2].vel === 120 && sim.counts.cmds[0x34] < 8, `a velocity drag: the unit ends on 120, ${sim.counts.cmds[0x34]} STEP SETs in all`);
  ed.setField([2, 6], X.FIELD.COND, 9); ed.setField([2, 6], X.FIELD.CHANCE, 50); ed.setField([6], X.FIELD.SOUND, 7);
  ed.setLock([2, 6], 31, 1200); ed.setLock([2], 125, 90);
  await ed.idle();
  const sp = sim.pat.tracks[3];
  check(sp.steps[6].cond === 9 && sp.steps[6].chance === 50 && sp.steps[6].sound === 7 && sp.locks.length === 3 && sp.steps[2].locked,
    "fields on two steps, a sound lock, CUTOFF and ROBOT locks: on the unit");
  ed.clearLock([2, 6], 31);
  await ed.idle();
  check(sp.locks.length === 1 && sp.locks[0].id === 125, "clearLock: CUTOFF gone from both, ROBOT kept");
  const copied = [2, 3, 4, 5, 6].map((s) => ({ ...ed.steps()[s] }));
  ed.paste(16, copied, ed.locksAt(2).map((l) => ({ ...l, step: 0 })));
  await ed.idle();
  check(sp.steps[16].slots.filter(Boolean).join() === "60,67" && sp.steps[20].sound === 7 && sp.locks.some((l) => l.step === 16 && l.id === 125),
    "paste: five steps at 17 with the first one's lock");
  ed.setTrack(X.TFIELD.LOOP, 3); ed.setTrack(X.TFIELD.TRANSPOSE, 5);
  await ed.idle();
  check(sp.set.loop === 3 && sp.set.transpose === 5, "setTrack: loop pages 1..2, transpose +5 on the unit");
  // the page and the unit agree: read again, compare
  const mine = JSON.stringify(ed.pat.tracks[3].steps), locks = JSON.stringify(ed.pat.tracks[3].locks);
  await ed.load();
  check(JSON.stringify(ed.pat.tracks[3].steps) === mine && JSON.stringify(ed.pat.tracks[3].locks) === locks, "the page's model and the unit's, read again: the same");
  ed.clear([16]);
  await ed.idle();
  check(!sp.steps[16].on && !sp.locks.some((l) => l.step === 16), "clear: the step and its lock gone");
  // the unit changed under the page: poll reads it again
  await new Promise((r) => setTimeout(r, 850));
  sim.editPat((P) => { P.tracks[0].steps[3] = { ...Q.emptyStep(), on: true }; });
  check(await ed.poll() && ed.pat.tracks[0].steps[3].on, "poll: the unit's own edit (revision moved) read in");
  check(!(await ed.poll()), "poll: nothing moved, nothing read");
  // the unit on another pattern: the next write is refused and the page reads the unit again
  const keep = ed.pat.pattern;
  await link.gotoPattern(9);
  ed.setField([1], X.FIELD.VEL, 66);
  await ed.idle();
  check(errs.some((m) => /pattern 10/.test(m)) && ed.pat.pattern === 9 && keep === 0, "a write for the pattern left: said, and the unit read again (pattern 10)");
  const a = await ed.gotoPattern(0);
  check(a.status === 0 && ed.pat.pattern === 0 && ed.pat.tracks[3].set.transpose === 5, "gotoPattern(1): back, its edits there");
  await ed.undo();
  check(errs.length === 1, "undo through the editor: no new refusal");
  link.close();
}

console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks pass`);
process.exit(fails ? 1 : 0);
