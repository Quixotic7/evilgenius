// SPDX-License-Identifier: MPL-2.0
// EvilGenius's manager against a real FM-1, from Node: the page's own modules (site/manager/eglink.js, egstore.js,
// egfiles.js) over a MIDI port that tools/eg/manager_midi_bridge.py opens (mido, python-rtmidi). READ ONLY: it finds
// the unit, asks who it is, reads MY PRESETS' sectors, takes a backup and reads it; it never restores and never
// writes a preset. Then EvilGenius's own SysEx, read only too (egsysex.js): STATUS, PROJECTS, LIST (MY PRESETS, the
// factory's, the pool), every factory preset and each track's sound DUMPed, and each sound's blob unpacked and packed
// again by egsound.js (the JS packer against the core's own bytes).
//
// --steps: the open pattern read (PATTERN INFO, every track's STEPS and LOCKS: docs/SEQ-SYSEX-PLAN.md phase 1), read
// only; a firmware without them says so.
//
// --write-track6 (WRITES, only with the owner's go-ahead): on track 6 of the open pattern, never in Project 2: a chord, a
// lock, a paste through the manager's commands (phase 2), each read back; then the unit's own UNDO until track 6 is
// byte for byte as it was (if undo cannot, its steps and locks are written back as they were read).
//
// --phase3-track6 (WRITES, only with the owner's go-ahead; stopped, never in Project 2): track 6's settings changed
// (TRACK SET: transpose, a loop page) and put back; the SEQUENCE tab's editing model (egseqedit.js) draws on track 6
// and it is written back; the unit sent to the next pattern and back (GO TO PATTERN).
//
//   node tools/eg/manager_hw.mjs [--out FILE.egbak] [--sounds FILE.egsnds] [--sysex-only] [--steps] [--write-track6]
//     [--phase3-track6]
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
import * as Q from "../../site/manager/egseq.js";

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

// the open pattern, read: what the piano roll would show
async function steps(link) {
  const info = await link.patternInfo();
  if (!info || info.old) { console.log(`PATTERN INFO: ${info ? "this firmware has no PATTERN INFO (BAD COMMAND)" : "no answer"}`); return info && info.old ? 0 : 1; }
  console.log(`PATTERN INFO: pattern ${info.pattern + 1}, revision ${info.rev}, ${info.bpm} BPM, swing ${info.swing}, ${info.nlock} locks`);
  const pat = Q.patternOf(info);
  let bad = 0;
  for (let t = 0; t < pat.tracks.length; t++) {
    const tr = pat.tracks[t], r = await link.steps(t, { locks: true });
    if (!r || r.old || r.steps.some((w) => !w)) { console.log(`FAIL: track ${t + 1}: ${r ? r.statusName || "steps missing" : "no answer"}`); bad = 1; continue; }
    Q.putSteps(pat, t, 0, r.steps); Q.putLocks(pat, t, r.locks);
    const loop = Q.loopSteps(tr.set), on = tr.steps.filter((s) => s.on).length;
    const notes = loop.filter((s) => tr.steps[s].on).slice(0, 8).map((s) => `${s + 1}:${Q.played(tr.steps[s], tr.set).notes.join("+")}`);
    console.log(`  track ${t + 1} ${tr.name.padEnd(12)} ${Q.rateName(tr.set.rate).padEnd(5)} loop ${loop.length} steps, ${on} trigs, ${r.locks.length} locks  ${notes.join(" ")}`);
  }
  const lockSum = pat.tracks.reduce((n, t) => n + (t.locks ? t.locks.length : 0), 0);
  if (lockSum !== info.nlock) { console.log(`FAIL: the tracks' locks (${lockSum}) are not PATTERN INFO's ${info.nlock}`); bad = 1; }
  else console.log(`STEPS: all six tracks read, their ${lockSum} locks = PATTERN INFO's`);
  return bad;
}

// track 6 written and put back (phase 2 on the unit)
async function writeTrack6(link) {
  const T = 5, X = await import("../../site/manager/egsysex.js");
  const st = await link.status();
  if (!st || st.project === 2) { console.log(`write: ${st ? "Project 2 is open: nothing written" : "no STATUS"}`); return 1; }
  if (st.playing) { console.log("write: the FM-1 is playing: stop it first; nothing written"); return 1; }
  const info = await link.patternInfo();
  if (!info || info.old) { console.log("write: no PATTERN INFO: nothing written"); return 1; }
  const P = info.pattern, read6 = async () => link.steps(T, { locks: true });
  const before = await read6();
  const others = [];
  for (let t = 0; t < 5; t++) others.push(await link.steps(t, { locks: true }));
  const key = (r) => JSON.stringify({ s: r.steps.map((w) => Array.from(w)), l: r.locks });
  console.log(`write: project ${st.project}, pattern ${P + 1}, track 6 (${info.tracks[T].name}): ${before.steps.filter((w) => w[2] & 1).length} trigs, ${before.locks.length} locks before`);
  let bad = 0;
  const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) bad = 1; };
  const quiet = () => new Promise((r) => setTimeout(r, 700));       // (the unit's undo: a gesture closes after 500 ms)
  try {
    let a = await link.stepSet({ pattern: P, track: T, steps: [2, 6, 10], fields: [[X.FIELD.TRIG, X.TRIG_ON], [X.FIELD.NOTES, [48, 52, 55]], [X.FIELD.VEL, 99]] });
    let r = await read6();
    ok(a && a.status === 0 && a.b === 3 && Q.stepOf(r.steps[6]).slots.slice(0, 3).join() === "48,52,55" && Q.stepOf(r.steps[6]).vel === 99, "STEP SET: a chord on steps 3, 7, 11, read back");
    await quiet();
    a = await link.lockSet({ pattern: P, track: T, steps: [6], entries: [{ op: "set", id: 31, value: 1600 }] });
    r = await read6();
    ok(a && a.status === 0 && r.locks.some((l) => l.step === 6 && l.id === 31 && l.value === 1600), "LOCK SET: CUTOFF 1600 on step 7, read back");
    await quiet();
    a = await link.stepsPut({ pattern: P, track: T, first: 12, wires: [r.steps[2], r.steps[6]] });
    r = await read6();
    ok(a && a.status === 0 && Q.stepOf(r.steps[13]).slots[0] === 48, "STEPS PUT: two steps pasted onto 13, 14, read back");
    a = await link.stepSet({ pattern: P + 1 > 63 ? 0 : P + 1, track: T, steps: [0], fields: [[X.FIELD.VEL, 10]] });
    ok(a && a.statusName === "BAD PATTERN" && a.b === P + 1, "STEP SET for another pattern: BAD PATTERN (nothing changed)");
    await quiet();
    // UNDO, once, of the last edit only (the earlier edits' levels lie between it and the owner's own history)
    a = await link.stepSet({ pattern: P, track: T, steps: [2], fields: [[X.FIELD.VEL, 50]] });
    await quiet();
    const u = await link.undo();
    r = await read6();
    ok(u && u.status === 0 && Q.stepOf(r.steps[2]).vel === 99, `UNDO: the last edit (velocity 50) undone, 99 again (level kind ${u ? u.b - 1 : "?"})`);
  } finally {
    // track 6 written back exactly as it was read (steps, then its locks), then compared; the other tracks untouched
    for (let s = 0; s < 128; s += 24) await link.stepsPut({ pattern: P, track: T, first: s, wires: before.steps.slice(s, s + 24) });
    for (const l of before.locks) await link.lockSet({ pattern: P, track: T, steps: [l.step], entries: [{ op: "set", id: l.id, value: l.value }] });
    const r = await read6();
    ok(key(r) === key(before), "track 6 written back: byte for byte as it was read");
    let same = 0;
    for (let t = 0; t < 5; t++) same += key(others[t]) === key(await link.steps(t, { locks: true }));
    ok(same === 5, `tracks 1..5 as they were (${same} of 5)`);
  }
  return bad;
}

// phase 3 on the unit: track 6's settings, the editing model, another pattern and back
async function phase3Track6(link) {
  const T = 5, X = await import("../../site/manager/egsysex.js"), { SeqEditor } = await import("../../site/manager/egseqedit.js");
  const st = await link.status();
  if (!st || st.project === 2) { console.log(`phase 3: ${st ? "Project 2 is open: nothing written" : "no STATUS"}`); return 1; }
  if (st.playing) { console.log("phase 3: the FM-1 is playing: stop it first; nothing written"); return 1; }
  let bad = 0;
  const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) bad = 1; };
  const info0 = await link.patternInfo(), P = info0.pattern, set0 = Q.tsetOf(info0.tracks[T].tset);
  const steps0 = await link.steps(T, { locks: true });
  const key = (r) => JSON.stringify({ s: r.steps.map((w) => Array.from(w)), l: r.locks });
  console.log(`phase 3: project ${st.project}, pattern ${P + 1}, track 6: transpose ${set0.transpose}, loop ${set0.loop}`);
  try {
    let a = await link.trackSet({ pattern: P, track: T, fields: [[X.TFIELD.TRANSPOSE, set0.transpose === 5 ? 6 : 5], [X.TFIELD.LOOP, set0.loop ^ 2]] });
    let t = Q.tsetOf((await link.patternInfo()).tracks[T].tset);
    ok(a && a.status === 0 && a.b === 2 && t.transpose === (set0.transpose === 5 ? 6 : 5) && t.loop === (set0.loop ^ 2), "TRACK SET: transpose and a loop page, read back");
    // (only the bad field: a valid one beside it is taken, as it should be; 2026-11-15's run changed page 1's end that way)
    a = await link.trackSet({ pattern: P, track: T, fields: [[X.TFIELD.PSTART, (0 << 4) | 15]] });
    const t1 = Q.tsetOf((await link.patternInfo()).tracks[T].tset);
    ok(a && a.statusName === "BAD VALUE" && t1.pstart[0] === set0.pstart[0] && t1.pend[0] === set0.pend[0], "TRACK SET: a page's start past its end: BAD VALUE, nothing changed");
    // the SEQUENCE tab's model: a note, a velocity drag, a lock
    const ed = new SeqEditor({ link, onError: (m) => console.log("  (editor: " + m + ")") });
    await ed.load();
    ed.track = T;
    ed.addNote(4, 60); ed.addNote(4, 63);
    for (let v = 20; v <= 110; v += 15) ed.setField([4], X.FIELD.VEL, v);
    ed.setLock([4], 31, 900);
    await ed.idle();
    const r = await link.steps(T, { first: 4, count: 1, locks: true }), s4 = Q.stepOf(r.steps[0]);
    ok(s4.slots.filter(Boolean).join() === "60,63" && s4.vel === 110 && r.locks.some((l) => l.id === 31 && l.value === 900), "the SEQUENCE tab's model on the unit: a chord, a velocity drag ending on 110, CUTOFF 900");
  } finally {
    // track 6 put back: its steps and locks as read, its settings as they were
    for (let s = 0; s < 128; s += 24) await link.stepsPut({ pattern: P, track: T, first: s, wires: steps0.steps.slice(s, s + 24) });
    await link.lockSet({ pattern: P, track: T, steps: Array.from({ length: 128 }, (_, k) => k), entries: [{ op: "clearAll" }] });
    for (const l of steps0.locks) await link.lockSet({ pattern: P, track: T, steps: [l.step], entries: [{ op: "set", id: l.id, value: l.value }] });
    // the settings: transpose, loop, and every page's start and end (ends first where they grow, so start <= end holds)
    await link.trackSet({ pattern: P, track: T, fields: [[X.TFIELD.TRANSPOSE, set0.transpose], [X.TFIELD.LOOP, set0.loop]] });
    for (let pg = 0; pg < 8; pg++) {
      await link.trackSet({ pattern: P, track: T, fields: [[X.TFIELD.PEND, (pg << 4) | 15]] });
      await link.trackSet({ pattern: P, track: T, fields: [[X.TFIELD.PSTART, (pg << 4) | set0.pstart[pg]], [X.TFIELD.PEND, (pg << 4) | set0.pend[pg]]] });
    }
    const back = await link.steps(T, { locks: true }), t = Q.tsetOf((await link.patternInfo()).tracks[T].tset);
    ok(key(back) === key(steps0) && JSON.stringify(t) === JSON.stringify(set0), "track 6 put back: its steps, locks and settings as they were");
  }
  // another pattern and back (stopped: at once)
  const q = P === 63 ? 62 : P + 1;
  let a = await link.gotoPattern(q);
  await new Promise((r) => setTimeout(r, 400));
  let s2 = await link.status();
  ok(a && a.status === 0 && s2.pattern === q, `GO TO PATTERN ${q + 1}: the unit is on it`);
  a = await link.gotoPattern(P);
  await new Promise((r) => setTimeout(r, 400));
  s2 = await link.status();
  ok(a && a.status === 0 && s2.pattern === P, `GO TO PATTERN ${P + 1}: back where it was`);
  return bad;
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
  if (process.argv.includes("--steps")) rc |= await steps(link);
  if (process.argv.includes("--write-track6")) rc |= await writeTrack6(link);
  if (process.argv.includes("--phase3-track6")) rc |= await phase3Track6(link);
  link.close();
} catch (e) {
  console.log(`FAIL: ${e.code || ""} ${e.message}`);
  rc = 1;
} finally {
  acc.close();
}
process.exit(rc);
