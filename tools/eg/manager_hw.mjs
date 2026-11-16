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
// --pool-projects (WRITES, only with the owner's go-ahead; stopped, never in or onto Project 2, slots 3 and 4 empty):
// POOL, PROJECTS and the IMPORT of the manager's screens, all in a scratch project: NEW in slot 4; POOL REF, USERS, SWAP,
// the SORT BY TAG plan, CLEAR there; a STORE6 into its pool (a MY preset, deleted again); RENAME it, COPY it to slot 3;
// LOAD the project worked on before (its pool compared with the one read first); DELETE slots 3 and 4. Anything left
// half done is put back the same way.
//
//   node tools/eg/manager_hw.mjs [--out FILE.egbak] [--sounds FILE.egsnds] [--sysex-only] [--steps] [--write-track6]
//     [--phase3-track6] [--pool-projects] [--transport] [--sim]
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

async function poolProjects(link) {
  const X = await import("../../site/manager/egsysex.js"), { sortPlan } = await import("../../site/manager/egpool.js");
  let bad = 0;
  const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) bad = 1; return c; };
  const st0 = await link.status(), pj0 = await link.projects();
  if (!st0 || !pj0) { console.log("pool: no STATUS / PROJECTS: nothing written"); return 1; }
  if (st0.playing) { console.log("pool: the FM-1 is playing: stop it first; nothing written"); return 1; }
  if (st0.project === 2) { console.log("pool: Project 2 is open: nothing written"); return 1; }
  if (pj0.list.length < 4 || pj0.list[2].there || pj0.list[3].there) { console.log("pool: slots 3 and 4 are not both empty: nothing written"); return 1; }
  const home = st0.project;
  const poolOf = async () => (await link.list({ factory: true, pool: true }));
  const rows0 = await poolOf();
  const pool0 = JSON.stringify(rows0.filter((r) => r.source === "pool").map((r) => [r.slot, r.id]));
  const fac = rows0.filter((r) => r.source === "factory");
  const pk = (rows) => rows.filter((r) => r.source === "pool").map((r) => `${r.slot}:${r.name}`).join(" ");
  console.log(`pool: project ${home} worked on, its pool ${rows0.filter((r) => r.source === "pool").length} sounds, MY PRESETS ${st0.mine}; scratch project in slot 4`);
  let made = false, copied = false, mine = 0;
  try {
    let a = await link.project("new", 4);
    made = a && a.status === 0;
    let st = await link.status();
    if (!ok(made && st.project === 4 && st.pool === 0, `NEW in slot 4: worked on (${st.project}), its pool empty (${st.pool})`)) return bad;
    const put = [[1, fac[4]], [2, fac[10]], [3, fac[20]], [10, fac[30]]];
    for (const [k, f] of put) { a = await link.poolRef(k, f.id); ok(a.status === 0 && a.a === k, `POOL REF ${f.name} into place ${k}`); }
    let rows = await poolOf();
    ok(pk(rows) === put.map(([k, f]) => `${k}:${f.name}`).join(" "), `LIST: the pool is ${pk(rows)}`);
    const u = await link.users("pool", 10);
    ok(u && u.kind === "users", `USERS of place 10: ${u ? `${u.projects.map((p) => `project ${p.project} ${p.steps} steps`).join(", ") || "no projects"}, tracks ${u.tracks}` : "no answer"}`);
    a = await link.swap("pool", 10, 5);
    rows = await poolOf();
    ok(a.status === 0 && rows.some((r) => r.source === "pool" && r.slot === 5 && r.id === fac[30].id) && !rows.some((r) => r.source === "pool" && r.slot === 10), "SWAP place 10 with 5: the sound at 5, 10 empty");
    const places = new Array(128).fill(null);
    for (const r of rows) if (r.source === "pool") places[r.slot - 1] = r;
    const plan = sortPlan(places);
    for (const [x, y] of plan) { a = await link.swap("pool", x, y); if (a.status) break; }
    rows = await poolOf();
    const want = places.filter(Boolean).sort((p, q) => { const t = (m) => { for (let k = 0; k < 7; k++) if ((m >> k) & 1) return k; return 7; }; return t(p.tags) - t(q.tags) || p.name.localeCompare(q.name) || p.slot - q.slot; }).map((p, i) => `${i + 1}:${p.name}`).join(" ");
    ok(a.status === 0 && pk(rows) === want, `SORT BY TAG (${plan.length} swaps): ${pk(rows)}`);
    a = await link.poolRef(1, 0);
    rows = await poolOf();
    ok(a.status === 0 && !rows.some((r) => r.source === "pool" && r.slot === 1), "CLEAR place 1 (POOL REF 0)");
    // IMPORT into the pool: a MY preset at a pool place; deleted again
    const f = await link.dump("factory", fac[7].slot), d = parseDump(f);
    const r = await link.store(X.storeSound({ name: "EG TEST SND", blob: Uint8Array.from(d.blob), tags: 1, pan: 0, chorus: 0, delay: 0, reverb: 0, pool: true }));
    rows = await poolOf();
    const m = rows.find((x) => x.source === "mine" && x.name === "EG TEST SND");
    mine = m ? m.slot : 0;
    ok(r && r.kind === "store" && r.status === 0 && r.pool && m && rows.some((x) => x.source === "pool" && x.slot === r.slot && x.id === m.id),
      `STORE6 with POOL: EG TEST SND in MY PRESETS ${mine}, at pool place ${r && r.slot}`);
    if (mine) {
      a = await link.remove("mine", mine);
      if (a && a.statusName === "IN USE") a = await link.remove("mine", mine, { confirm: true });
      rows = await poolOf();
      ok(a.status === 0 && !rows.some((x) => x.source === "mine" && x.name === "EG TEST SND") && !rows.some((x) => x.source === "pool" && x.slot === r.slot),
        "DELETE it from MY PRESETS (in use: confirmed): gone, its pool place too");
      if (a.status === 0) mine = 0;
    }
    const names = (pj) => pj.list.map((p) => `${p.slot}${p.current ? "*" : ""}:${p.there ? p.name || "(no name)" : "-"}`).join(" ");
    a = await link.rename("project", 4, "EG TEST");
    let pj = await link.projects();
    ok(a.status === 0 && pj.list[3].name === "EG TEST", `RENAME 4 (worked on) to EG TEST: ${a.statusName}; PROJECTS ${names(pj)}`);
    a = await link.project("copy", 4, 3);
    copied = a && a.status === 0;
    pj = await link.projects();
    ok(copied && pj.list[2].there && pj.list[1].there, `COPY 4 to slot 3: ${a.statusName}; PROJECTS ${names(pj)}`);
    ok(pj.list[2].name === "EG TEST" && pj.list[3].name === "EG TEST", "the copy and the original keep the name EG TEST");
    a = await link.rename("project", 3, "EG COPY");
    pj = await link.projects();
    ok(a.status === 0 && pj.list[2].name === "EG COPY", `RENAME 3 (not worked on) to EG COPY: ${a.statusName}; PROJECTS ${names(pj)}`);
  } finally {
    // put back: the project worked on before, the scratch projects and the test preset gone
    if (mine) { let a = await link.remove("mine", mine); if (a && a.statusName === "IN USE") await link.remove("mine", mine, { confirm: true }); }
    let a = await link.project("load", home);
    let st = await link.status();
    ok(a && a.status === 0 && st.project === home, `LOAD ${home}: worked on again`);
    const rows = await link.list({ factory: true, pool: true });
    ok(JSON.stringify(rows.filter((r) => r.source === "pool").map((r) => [r.slot, r.id])) === pool0, `project ${home}'s pool: as read first`);
    if (copied) { a = await link.project("delete", 3); ok(a && a.status === 0, "DELETE slot 3"); }
    if (made) { a = await link.project("delete", 4); ok(a && a.status === 0, "DELETE slot 4"); }
    const pj = await link.projects();
    st = await link.status();
    ok(pj && !pj.list[2].there && !pj.list[3].there && pj.list[1].there && pj.current === home && st.mine === st0.mine,
      `PROJECTS back: ${pj.list.map((p) => `${p.slot}${p.current ? "*" : ""}:${p.there ? p.name || "(no name)" : "-"}`).join(" ")}; MY PRESETS ${st.mine}`);
  }
  return bad;
}

// --sim: the simulated unit (site/manager/egsim.js) instead of the bridge: a dry run of a writing test
// --transport: PLAY tapped as the remote taps it (the page's SPACE), STATUS read, PLAY again: playing, then stopped. Only
// if stopped first; no REC, nothing written
async function transport(link) {
  const { BUTTON } = await import("../../site/manager/eglink.js");
  if (process.argv.includes("--stop")) {                     // (--stop: a PLAY tap if it plays, and nothing else)
    const st = await link.status();
    if (st && st.playing) { await link.press(BUTTON.PLAY, 60); await new Promise((r) => setTimeout(r, 400)); }
    const after = await link.status();
    console.log(`stop: ${after && !after.playing ? "stopped" : "STILL PLAYING"}`);
    return after && !after.playing ? 0 : 1;
  }
  const st0 = await link.status();
  if (!st0 || st0.playing) { console.log("transport: the FM-1 is playing (or silent): left alone"); return 1; }
  let bad = 0;
  const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) bad = 1; };
  const tap = async (want) => {                               // (the press that wakes the idle screen does nothing: again)
    for (let k = 0; k < 2; k++) {
      await link.press(BUTTON.PLAY, 60);
      await new Promise((r) => setTimeout(r, 400));
      const st = await link.status();
      if (st && st.playing === want) { if (k) console.log("     (the first press woke the unit's screen)"); return st; }
    }
    return link.status();
  };
  const st1 = await tap(true);
  ok(st1 && st1.playing, `PLAY (channel 16, CC 30): playing pattern ${st1 ? st1.pattern + 1 : "?"}`);
  const st2 = await tap(false);
  ok(st2 && !st2.playing && !st2.rec, "PLAY again: stopped, not recording");
  return bad;
}

const acc = process.argv.includes("--sim") ? { ...new (await import("../../site/manager/egsim.js")).SimUnit().access, close() {} } : access();
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
  if (process.argv.includes("--pool-projects")) rc |= await poolProjects(link);
  if (process.argv.includes("--transport")) rc |= await transport(link);
  link.close();
} catch (e) {
  console.log(`FAIL: ${e.code || ""} ${e.message}`);
  rc = 1;
} finally {
  acc.close();
}
process.exit(rc);
