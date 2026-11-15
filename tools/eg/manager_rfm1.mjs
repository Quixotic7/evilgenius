// SPDX-License-Identifier: MPL-2.0
// EvilGenius's manager against the .rfm1 RemoteFM1 plays (0.1.2): the page's own modules (site/manager/eglink.js,
// egwire.js, egstore.js) talk to a real build of the player, FM1VST's evilgenius-<v>.rfm1, run here in Node's
// WebAssembly as a host runs it (FM1VST docs/RFM1-FORMAT.md: the imports, the boot, the device clock: tick each ms,
// frame every 15 ms else idle, a 128-frame audio block when due at 44.1 kHz; the USB-MIDI packets in and out), its MIDI
// ports given to the page as Web MIDI ports. What it checks:
//   - the handshake (findUnit), EvilGenius's IDENTITY;
//   - FZBI: the unit's layout (0xAF000, 49 sectors); a backup (FZBR) whole, its CRC-32 FZBI's, an EvilGenius store
//     that egstore.js reads; MY PRESETS' sectors (link.library);
//   - a restore of an image the page's writer made (egstore.js addPresets: presets added to the backup): FZOK, and the
//     player's app sees them (its STATUS: MY presets used), a backup after it reads them back;
//   - a unit's own backup (a .egbak, optional second argument) restored into the player and read back;
//   - refused while playing (MIDI START: FZER 10).
//
//   node tools/eg/manager_rfm1.mjs <evilgenius-x.y.z.rfm1> [unit-backup.egbak]
import fs from "fs";
import * as W from "../../site/manager/egwire.js";
import * as S from "../../site/manager/egstore.js";
import { findUnit } from "../../site/manager/eglink.js";

let fails = 0, checks = 0;
const check = (ok, msg) => { checks++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fails++; };
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const [file, unitBak] = process.argv.slice(2);
if (!file) { console.error("usage: node tools/eg/manager_rfm1.mjs <evilgenius.rfm1> [unit-backup.egbak]"); process.exit(2); }

// ---------------------------------------------------------------- the host (RFM1-FORMAT.md 3, 4, 7)
const mod = await WebAssembly.compile(fs.readFileSync(file));
let mem;
const dv = () => new DataView(mem.buffer);
const wasi = {
  fd_write: (fd, iov, n, out) => { let t = 0; for (let i = 0; i < n; i++) t += dv().getUint32(iov + 8 * i + 4, true); dv().setUint32(out, t, true); return 0; },
  fd_read: () => 8, fd_close: () => 8, fd_seek: () => 8,
  clock_time_get: (id, prec, out) => { dv().setBigUint64(out, BigInt(Math.round(performance.now() * 1e6)), true); return 0; },
  proc_exit: (c) => { throw new Error(`proc_exit ${c}`); },
};
const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi });
const X = inst.exports;
mem = X.memory;
if (X._initialize) X._initialize();
const desc = X.rfm1_get(6), lay = (i) => X.rfm1_layout(i);
const panel = dv().getUint32(desc + lay(18 + 12), true);   // fm1core_t's panel
const str = (p) => { const b = new Uint8Array(mem.buffer); let s = ""; while (b[p]) s += String.fromCharCode(b[p++]); return s; };
const version = str(dv().getUint32(desc + lay(18 + 3), true));
X.rfm1_flash_stage(0, 0);
const sp = X.rfm1_alloc(64);
new Uint8Array(mem.buffer).set([...Buffer.from("fm1core:staged\0")], sp);
X.rfm1_options(sp, 0, 0, 1);
X.rfm1_boot_options(-1, 0, -1);
new Uint8Array(mem.buffer)[panel + lay(16)] = 2;            // ready: simulated time
X.rfm1_init(0);
const audio = X.rfm1_alloc(128 * 4), pkt = X.rfm1_alloc(4);
console.log(`${file}: evilgenius ${version}`);

let ms = 0, audioDue = 0;
const inq = [];                                                // USB-MIDI packets waiting for midi_in
let outBytes = [], onFrame = null;
function packets(bytes) {                                     // SysEx bytes -> CIN 4..7 packets; a real-time byte: CIN 15
  const out = [];
  if (bytes.length === 1) return [0x0F | (bytes[0] << 8)];
  for (let i = 0; i < bytes.length; i += 3) {
    const k = Math.min(3, bytes.length - i), end = i + k >= bytes.length;
    out.push((end ? 4 + k : 4) + bytes[i] * 0x100 + (k > 1 ? bytes[i + 1] * 0x10000 : 0) + (k > 2 ? bytes[i + 2] * 0x1000000 : 0));
  }
  return out;
}
function stepMs() {
  ms++;
  while (inq.length && X.rfm1_midi_in(inq[0])) inq.shift();
  X.rfm1_tick(ms);
  if (ms % 15 === 0) X.rfm1_frame(); else X.rfm1_idle();
  while (audioDue <= ms) { X.rfm1_audio(audio, 128); audioDue += 128 * 1000 / 44100; }
  while (X.rfm1_midi_out_take(pkt)) {
    const p = dv().getUint32(pkt, true), cin = p & 15, n = cin === 5 ? 1 : cin === 6 ? 2 : cin === 4 || cin === 7 ? 3 : 0;
    for (let k = 0; k < n; k++) {
      const b = (p >>> (8 * (k + 1))) & 0xFF;
      if (b === 0xF0) outBytes = [b]; else if (outBytes.length) outBytes.push(b);
      if (b === 0xF7 && outBytes.length) { const f = outBytes; outBytes = []; if (onFrame) onFrame(Uint8Array.from(f)); }
    }
  }
}
// the device clock in the background at SPEED x real time (the page's timeouts are real ms, the player's patience
// device ms), a few ms a turn of Node's loop: the page's awaits run between
const SPEED = 2, T0 = performance.now();
let running = true;
(function clock() {
  if (!running) return;
  for (let i = 0; i < 8 && ms < (performance.now() - T0) * SPEED; i++) stepMs();
  if (ms < (performance.now() - T0) * SPEED) setImmediate(clock); else setTimeout(clock, 1);
})();

// ---------------------------------------------------------------- the page's Web MIDI ports
const input = { name: "FM-1", state: "connected", onmidimessage: null, open: async () => {} };
const output = { name: "FM-1", state: "connected", open: async () => {}, send: (b) => { inq.push(...packets(Array.from(b))); } };
onFrame = (f) => { if (input.onmidimessage) input.onmidimessage({ data: f }); };
const access = { inputs: new Map([["i", input]]), outputs: new Map([["o", output]]) };
const sleepMs = (n) => new Promise((r) => setTimeout(r, n));
// the player's STATUS (fizz_sx.c: 42 .. MY presets used 14-bit at body 7..8)
async function status() {
  let got = null;
  const prev = input.onmidimessage;
  input.onmidimessage = (ev) => { const r = W.parseEg(Array.from(ev.data)); if (r && r.cmd === 0x42) got = r.body; else if (prev) prev(ev); };
  output.send(W.egFrame(0x02));
  for (let t = 0; t < 200 && !got; t++) await sleepMs(5);
  input.onmidimessage = prev;
  return got && { presets: got[6] << 7 | got[7], projects: got[5] };
}

// ---------------------------------------------------------------- the manager
const link = await findUnit(access, { log: () => {} });
check(link && link.id.startsWith("FM-1_45"), `the handshake: ${link && link.id}`);
const ver = await link.version();
check(ver && ver.startsWith("EVILGENIUS"), `IDENTITY: ${ver}`);

const info = await link.info();
check(info && info.lo === S.LAYOUT.region && info.size === S.LAYOUT.size, `FZBI: 0x${info && info.lo.toString(16)}, ${info && info.size} bytes, CRC ${info && W.hex8(info.crc)}`);
let t0 = performance.now();
const b1 = await link.backup();
check(W.crc32(b1.image) === b1.crc, `a backup: ${b1.image.length} bytes in ${Math.round(performance.now() - t0)} ms, its CRC-32 FZBI's`);
const r1 = S.readImage(b1.image);
check(r1.magic === "EGB2" && r1.projects.length >= 1 && r1.format === 2, `egstore.js reads it: ${r1.magic}, projects ${r1.projects.map((p) => p.name).join(", ")}, ${r1.presets.length} presets`);
const lib1 = await link.library();
check(lib1.bytes.length === S.LIB_BYTES && S.readLibrary(lib1.bytes).presets.length === r1.presets.length, "MY PRESETS' sectors (link.library)");

// a restore of an image the page's writer made: three presets added to the backup
const blob = (seed) => { const b = new Uint8Array(S.BLOB); b[0] = 0x53; b[1] = 2; b[40] = seed & 3; return b; };
const snd = (name, seed) => ({ name, blob: blob(seed), tags: 1 << seed, pan: seed - 2, chorus: seed, delay: 3, reverb: 9 });
const add = S.addPresets(b1.image, [snd("RFM1 ONE", 1), snd("RFM1 TWO", 2), snd("RFM1 THREE", 3)]);
check(add.added.length === 3, `the page's writer: ${add.added.map((a) => `${a.slot} ${a.name}`).join(", ")}`);
const st0 = await status();
let phases = [];
t0 = performance.now();
const rs = await link.restore(add.image, { onPhase: (p) => phases.push(p) });
check(rs.ok && phases.join() === "check,write" && rs.served === 2 * S.LAYOUT.size / 512,
  `FZSR: FZOK after ${rs.served} reads (${phases.join(" then ")}), ${Math.round(performance.now() - t0)} ms`);
const st1 = await status();
check(st0 && st1 && st1.presets === st0.presets + 3, `the player's app sees them: MY presets used ${st0 && st0.presets} -> ${st1 && st1.presets}`);
const b2 = await link.backup();
const r2 = S.readImage(b2.image);
check(["RFM1 ONE", "RFM1 TWO", "RFM1 THREE"].every((n) => r2.presets.some((p) => p.name === n)) &&
  same(r2.presets.find((p) => p.name === "RFM1 TWO").blob, blob(2)), "a backup after it reads them back, the patch byte for byte");
check(same(b2.image.subarray(0, S.LIB_BYTES), add.image.subarray(0, S.LIB_BYTES)), "MY PRESETS' sectors are the image's byte for byte");

// a unit's own backup into the player
if (unitBak) {
  const unit = new Uint8Array(fs.readFileSync(unitBak));
  const ru = S.readImage(unit);
  const r = await link.restore(unit);
  const b3 = await link.backup();
  const r3 = S.readImage(b3.image);
  const st = await status();
  check(r.ok && r3.presets.map((p) => p.name).join() === ru.presets.map((p) => p.name).join() &&
    r3.projects.map((p) => p.name).join() === ru.projects.map((p) => p.name).join() && st && st.presets === ru.presets.length,
    `a unit's backup (${unitBak.split("/").pop()}: ${ru.presets.length} presets, projects ${ru.projects.map((p) => p.name).join(", ")}) restored and read back; the app's STATUS ${st && st.presets}`);
  check(same(b3.image.subarray(0, S.LIB_BYTES), unit.subarray(0, S.LIB_BYTES)), "its MY PRESETS' sectors byte for byte");
  check(st && st.projects === ru.projects.length, `the app sees its ${st && st.projects} projects`);
  const ua = S.addPresets(unit, [snd("UNIT PLUS", 4), snd("UNIT PLUS 2", 5)]);
  const r4 = await link.restore(ua.image);
  const st4 = await status();
  check(r4.ok && st4 && st4.presets === ru.presets.length + 2 && st4.projects === ru.projects.length,
    `the unit's backup with two presets added by the page: restored, the app sees ${st4 && st4.presets} presets`);
}

// refused while playing (MIDI START: the sequencer plays, waiting for the clock)
output.send([0xFA]);
await sleepMs(20);
try { await link.restore(add.image); check(false, "a restore while playing: refused"); }
catch (e) { check(e.code === "fzer" && e.fzer === 10 && !e.written, `a restore while playing: ${e.code} ${e.fzer} "${e.message}"`); }
output.send([0xFC]);
await sleepMs(50);

running = false;
link.close();
console.log(`manager_rfm1: ${checks} checks, ${fails} failed (device ${ms} ms)`);
process.exit(fails ? 1 : 0);
