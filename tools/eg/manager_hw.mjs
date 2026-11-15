// SPDX-License-Identifier: MPL-2.0
// EvilGenius's manager against a real FM-1, from Node: the page's own modules (site/manager/eglink.js, egstore.js,
// egfiles.js) over a MIDI port that tools/eg/manager_midi_bridge.py opens (mido, python-rtmidi). READ ONLY: it finds
// the unit, asks who it is, reads MY PRESETS' sectors, takes a backup and reads it; it never restores and never
// writes a preset. Then EvilGenius's own SysEx, read only too (egsysex.js): STATUS, PROJECTS, LIST (MY PRESETS, the
// factory's, the pool), every factory preset and each track's sound DUMPed, and each sound's blob unpacked and packed
// again by egsound.js (the JS packer against the core's own bytes).
//
//   node tools/eg/manager_hw.mjs [--out FILE.egbak] [--sounds FILE.egsnds] [--sysex-only]
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { findUnit } from "../../site/manager/eglink.js";
import { readImage, readLibrary, LAYOUT, tagNames } from "../../site/manager/egstore.js";
import { soundsFile, readSounds } from "../../site/manager/egfiles.js";
import { crc32, hex8 } from "../../site/manager/egwire.js";
import { parseDump } from "../../site/manager/egsysex.js";
import { soundFromDump, blobOf, valuesOf } from "../../site/manager/egsound.js";

const here = dirname(fileURLToPath(import.meta.url)), bridge = join(here, "manager_midi_bridge.py");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

// a Web MIDI access made of the bridge's ports (each opened when asked for)
function access() {
  const names = execFileSync("python3", [bridge, "--list"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const inputs = new Map(), outputs = new Map(), procs = [];
  for (const name of names) {
    let proc = null;
    const input = { name, state: "connected", onmidimessage: null };
    const output = { name, state: "connected" };
    const open = async () => {
      if (proc) return;
      proc = spawn("python3", [bridge, name], { stdio: ["pipe", "pipe", "inherit"] });
      procs.push(proc);
      proc.on("exit", () => { input.state = output.state = "disconnected"; });
      createInterface({ input: proc.stdout }).on("line", (l) => { if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from(Buffer.from(l.trim(), "hex")) }); });
      await new Promise((r) => setTimeout(r, 600));          // (the ports open)
    };
    input.open = open; output.open = open;
    output.send = (bytes) => { if (!proc || output.state !== "connected") throw new Error("closed"); proc.stdin.write(Buffer.from(bytes).toString("hex") + "\n"); };
    inputs.set(name, input); outputs.set(name, output);
  }
  return { inputs, outputs, close: () => procs.forEach((p) => p.stdin.end()) };
}

// a DUMP's blob unpacked and packed again: the same 128 bytes as the core packed them
function same(frame, what) {
  const d = parseDump(frame), snd = soundFromDump(d);
  if (!snd) return `${what}: not a SID TONE sound (${d ? String.fromCharCode(d.blob[0]) + d.blob[1] : "no DUMP"})`;
  if (snd.midi) return null;
  const again = blobOf(valuesOf(d.blob));
  const k = again.findIndex((x, i) => x !== d.blob[i]);
  return k < 0 ? null : `${what} (${snd.name}): byte ${k} packs to ${again[k]}, the unit's ${d.blob[k]}`;
}
async function semantic(link) {
  let bad = 0;
  const st = await link.status();
  if (!st) { console.log("FAIL: STATUS: no answer"); return 1; }
  console.log(`STATUS: ${st.tracks} tracks, project ${st.project}, pattern ${st.pattern + 1}, ${st.playing ? "playing" : "stopped"}, package ${st.package} ` +
    `(${st.nproj} projects, ${st.nlib} presets), MY PRESETS ${st.mine}, pool ${st.pool}, store ${st.lib.join("/")} + ${st.prj.join("/")} pages${st.noStore ? ", NO STORE" : ""}`);
  const pj = await link.projects();
  console.log(`PROJECTS: ${pj ? pj.list.map((p) => `${p.slot}${p.current ? "*" : ""}:${p.there ? p.name || "(no name)" : "-"}`).join(" ") : "no answer"}`);
  if (!pj) bad = 1;
  const rows = await link.list({ factory: true, pool: true });
  const by = (k) => rows.filter((r) => r.source === k);
  console.log(`LIST: ${by("mine").length} MY PRESETS, ${by("factory").length} factory, ${by("pool").length} pool`);
  let n = 0, fails = [];
  for (const r of by("factory")) {
    const f = await link.dump("factory", r.slot);
    const e = f ? same(f, `factory ${r.slot}`) : `factory ${r.slot}: no DUMP`;
    if (e) fails.push(e); else n++;
  }
  for (let t = 1; t <= st.tracks; t++) {
    const f = await link.dumpTrack(t);
    const e = f ? same(f, `track ${t}`) : `track ${t}: no DUMP`;
    if (e) fails.push(e); else { n++; const d = parseDump(f); console.log(`  track ${t}: ${d.name || "(no name)"} id ${d.extras ? d.extras.id : "?"}${d.extras && d.extras.edited ? " edited" : ""}`); }
  }
  for (const e of fails.slice(0, 10)) console.log("FAIL: " + e);
  console.log(`DUMP: ${n} sounds pack back to the unit's own bytes, ${fails.length} do not`);
  return bad || fails.length ? 1 : 0;
}

const acc = access();
let rc = 0;
try {
  console.log("ports:", [...acc.inputs.keys()].join(", ") || "(none)");
  const link = await findUnit(acc, { log: (l) => console.log("  " + l) });
  console.log(`found ${link.id} on ${link.port}`);
  console.log("EvilGenius's own IDENTITY:", (await link.version()) ?? "no answer");
  if (!process.argv.includes("--sysex-only")) {
  const info = await link.info();
  console.log(`store: flash ${info.lo.toString(16)}, ${info.size} B, CRC-32 ${hex8(info.crc)}` +
    (info.lo === LAYOUT.region && info.size === LAYOUT.size ? " (the layout the page knows)" : " (NOT the layout the page knows)"));
  let t = Date.now();
  const lib = await link.library();
  const l = readLibrary(lib.bytes);
  console.log(`MY PRESETS' sectors: ${lib.bytes.length} B in ${Date.now() - t} ms${lib.moving ? " (the store kept changing)" : ""}; magic ${l.magic || "(blank)"}, ` +
    `${l.presets.length} presets, next id ${l.idNext}, ${l.used.lib[0]} of ${l.used.lib[1]} pages`);
  for (const p of l.presets) console.log(`  ${String(p.slot).padStart(3)} ${p.name.padEnd(12)} id ${p.id} tags ${tagNames(p.tags).join("+") || "-"} patch ${String.fromCharCode(p.blob[0])}${p.blob[1]}`);
  t = Date.now();
  const b = await link.backup();
  const s = readImage(b.image);
  console.log(`backup: ${b.image.length} B in ${Date.now() - t} ms, CRC-32 ${hex8(crc32(b.image))} = the unit's ${hex8(b.crc)}; magic ${s.magic}, format ${s.format}, ` +
    `projects ${s.projects.map((p) => `${p.slot}:${p.name || "(no name)"}`).join(", ") || "none"}, ${s.presets.length} presets`);
  if (s.presets.length !== l.presets.length) { console.log("FAIL: the backup and MY PRESETS' sectors disagree"); rc = 1; }
  const back = readSounds(soundsFile(s.presets, { firmware: link.id, store: s.magic }), "export");
  if (back.length !== s.presets.length || back.some((x, i) => x.name !== s.presets[i].name || Buffer.compare(Buffer.from(x.blob), Buffer.from(s.presets[i].blob))))
    { console.log("FAIL: the presets did not come back from their file"); rc = 1; }
  else console.log(`presets file: ${back.length} written and read back the same`);
  if (arg("--out")) { writeFileSync(arg("--out"), b.image); console.log("wrote", arg("--out")); }
  if (arg("--sounds")) { writeFileSync(arg("--sounds"), soundsFile(s.presets, { firmware: link.id, store: s.magic })); console.log("wrote", arg("--sounds")); }
  }
  rc |= await semantic(link);
  link.close();
} catch (e) {
  console.log(`FAIL: ${e.code || ""} ${e.message}`);
  rc = 1;
} finally {
  acc.close();
}
process.exit(rc);
