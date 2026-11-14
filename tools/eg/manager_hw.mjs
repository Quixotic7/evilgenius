// SPDX-License-Identifier: MPL-2.0
// EvilGenius's manager against a real FM-1, from Node: the page's own modules (site/manager/eglink.js, egstore.js,
// egfiles.js) over a MIDI port that tools/eg/manager_midi_bridge.py opens (mido, python-rtmidi). READ ONLY: it finds
// the unit, asks who it is, reads MY PRESETS' sectors, takes a backup and reads it; it never restores and never
// writes a preset.
//
//   node tools/eg/manager_hw.mjs [--out FILE.egbak] [--sounds FILE.egsnds]
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { findUnit } from "../../site/manager/eglink.js";
import { readImage, readLibrary, LAYOUT, tagNames } from "../../site/manager/egstore.js";
import { soundsFile, readSounds } from "../../site/manager/egfiles.js";
import { crc32, hex8 } from "../../site/manager/egwire.js";

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

const acc = access();
let rc = 0;
try {
  console.log("ports:", [...acc.inputs.keys()].join(", ") || "(none)");
  const link = await findUnit(acc, { log: (l) => console.log("  " + l) });
  console.log(`found ${link.id} on ${link.port}`);
  console.log("EvilGenius's own IDENTITY:", (await link.version()) ?? "no answer");
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
  link.close();
} catch (e) {
  console.log(`FAIL: ${e.code || ""} ${e.message}`);
  rc = 1;
} finally {
  acc.close();
}
process.exit(rc);
