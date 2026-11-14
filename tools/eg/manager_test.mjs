// SPDX-License-Identifier: MPL-2.0
// EvilGenius's manager without hardware: the page's modules (site/manager/egwire.js, egstore.js, egfiles.js,
// eglink.js) against frames captured from a real FM-1 and from fm1-base's Python codec, a store image built here, and
// a simulated FM-1 that speaks the port's protocol (firmware/app/app.c app_usb_cmd: FZBI, FZBR, FZSR and its pulls).
//
//   node tools/eg/manager_test.mjs
import * as W from "../../site/manager/egwire.js";
import * as S from "../../site/manager/egstore.js";
import * as F from "../../site/manager/egfiles.js";
import { findUnit, EgLink, Port } from "../../site/manager/eglink.js";

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

console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks pass`);
process.exit(fails ? 1 : 0);
