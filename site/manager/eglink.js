// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's manager: the link to an FM-1 running EvilGenius, over Web MIDI (or anything shaped like it: the tests'
// simulated FM-1, tools/eg/manager_test.mjs; a real one through tools/eg/manager_hw.mjs). No DOM.
// Adapted from FIZZ's site/manager/fizzlink.js and fm1-base's installer (fm1lib.js), MPL-2.0.
//
// One thing at a time: the unit keeps few inbound SysEx frames and drops one that arrives while they are held, so a
// request waits for its answer, is sent again when none comes, and two sends are never closer than GAP_MS.
//
//   await findUnit(access, {log}) -> EgLink | throws Error {code: "noport" | "ble" | "silent" | "update" | "other"}
//   link.id ("FM-1_4500"), link.port (the MIDI port's name)
//   link.version()               -> EvilGenius's own IDENTITY text | null (it does not answer)
//   link.info()                  -> {lo, size, crc} | null: the store's flash offset, size, CRC-32 now
//   link.read(from, to, onProgress) -> the store's bytes [from, to)
//   link.backup(onProgress)      -> {image, lo, size, crc}: the store whole, its CRC-32 the unit's (throws "changed")
//   link.library(onProgress)     -> MY PRESETS' sectors (egstore.js LIB_BYTES), read while the store did not change
//   link.restore(image, {onProgress, onPhase}) -> {ok: true} | throws {code: "fzer", fzer, written}
//   link.close(); link.lost
// EvilGenius's own SysEx (egsysex.js: FIZZ's protocol under 7D 45 47; the unit answers it since 0.1.0, app.c's gate):
//   link.status() -> parseStatus | null          link.list({factory, pool}) -> [entries] (every part; read again if short)
//   link.dump(source, slot) -> a DUMP frame | null  link.dumpAll(source, total, onProgress) -> [frames]
//   link.dumpTrack(slot) -> a track's DUMP frame | null (slot 1..6, 0 the selected one)
//   link.store(frame) -> {kind: "store", status, slot, pool} | {kind: "error", ..}   (a STORE6: storeSound)
//   link.tags / rename / remove / swap / poolRef / users / projects / project / flush / param / browse -> the ACK
//     ({status, statusName, a, b}) or the reply asked for; {old: true} when this EVILGENIUS has no such command
//   link.note(ch, n, vel)  a note (no reply);  link.button(b, down) / await link.press(b, ms): a panel button, as the
//     remote presses it (BUTTON.PLAY, BUTTON.REC: no reply; STATUS says what it did)
//   link.patternInfo() -> parsePinfo | {old: true} (a firmware without it) | null;  link.steps(track, {first, count,
//     locks}) -> {pattern, rev, first, steps: [20-byte wire], locks: [{step, id, value}] | null} | {old: true} | null
//     (docs/SEQ-SYSEX-PLAN.md phase 1: the pattern open on the unit, read)
//   link.stepSet({pattern, track, steps, fields}), link.lockSet({pattern, track, steps, entries}),
//   link.stepsPut({pattern, track, first, wires}), link.undo(redo) -> the ACK {status, statusName, a, b} | {old}
//     (phase 2: one at a time, each its ACK; a run within half a second is one undo level on the unit)
//   link.trackSet({pattern, track, fields: [[TFIELD.LOOP, 3], ..]}), link.gotoPattern(p) -> the ACK (phase 3)
// Every failure is an Error with a code: "lost" (unplugged), "timeout", "nobulk", "changed", "fzer", "badreq".
import { HS_QUERY, CHUNK, PULL, FZER, crc32, rd32, bulkFrame, parseBulk, parseRequest, response, parseIdentity,
  firmwareName, egIdentityRequest, parseEgIdentity } from "./egwire.js";
import { LIB_BYTES } from "./egstore.js";
import { CMD, CMD1, parseReply, parseList, parseDump, statusRequest, flushRequest, listRequest, dumpRequest, tagsRequest,
  renameRequest, deleteRequest, swapRequest, poolRefRequest, usersRequest, projectsRequest, projectRequest, paramRequest,
  browseRequest, CMD_SEQ, pinfoRequest, stepsRequest, parsePinfo, parseSteps, parseLocks, stepSetRequest, lockSetRequest,
  stepsPutRequest, undoRequest, trackSetRequest, gotoRequest } from "./egsysex.js";
const MORE = Symbol("more");

export const GAP_MS = 3;
export const BUTTON = { PLAY: 10, REC: 11 }, HOLD_MS = 400;   // (core/app/app.h QD_B_*, ctl.h QD_PLAY_HOLD_MS / QD_REC_HOLD_MS)
const PORT_RE = /fm-?1|evil\s*genius|felucca/i;            // never ask other gear who it is
export const isBlePort = (name) => /bluetooth/i.test(String(name || ""));
const err = (code, msg, extra = {}) => Object.assign(new Error(msg), { code }, extra);
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// one MIDI in/out pair with a queue of the SysEx frames that came (a frame the browser delivers in parts is joined)
export class Port {
  constructor(input, output) {
    this.input = input; this.output = output; this.q = []; this.waiter = null; this.part = null;
    input.onmidimessage = (ev) => {
      const d = ev.data;
      if (!d || !d.length) return;
      if (d[0] === 0xF0) this.part = Array.from(d);
      else if (this.part && d[0] < 0x80) this.part.push(...d);
      else { if (d[0] < 0xF8) this.part = null; return; }
      if (this.part[this.part.length - 1] !== 0xF7) return;
      this.q.push(this.part);
      this.part = null;
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(); }
    };
  }
  get lost() { return this.input.state === "disconnected" || this.output.state === "disconnected"; }
  send(bytes) { try { this.output.send(bytes); return true; } catch (_) { return false; } }
  drain() { this.q.length = 0; }
  async read(ms) {
    if (!this.q.length && ms > 0) {
      let tm;
      await Promise.race([new Promise((r) => { this.waiter = r; }), new Promise((r) => { tm = setTimeout(r, ms); })]);
      clearTimeout(tm);
      this.waiter = null;
    }
    return this.q.shift() || null;
  }
  close() { this.input.onmidimessage = null; }
}

async function handshake(port, tries = 2, ms = 800) {
  port.drain();
  for (let t = 0; t < tries; t++) {
    if (!port.send(HS_QUERY)) return null;
    const end = now() + ms;
    while (now() < end) {
      const p = await port.read(end - now());
      if (!p) break;
      const id = parseIdentity(p);
      if (id) return id;
    }
  }
  return null;
}

// the FM-1 running EvilGenius on a USB port. A Bluetooth MIDI port is never used: a restore pulls over USB only
export async function findUnit(access, { log = () => {} } = {}) {
  const live = (m) => [...m.values()].filter((p) => p.state !== "disconnected");
  const outs = live(access.outputs), ins = live(access.inputs).filter((i) => PORT_RE.test(i.name || ""));
  const usb = ins.filter((i) => !isBlePort(i.name));
  let other = null;
  for (const input of usb) {
    const output = outs.find((o) => o.name === input.name);
    if (!output) continue;
    try { await input.open(); await output.open(); } catch (_) { log(`${input.name}: could not be opened`); continue; }
    const port = new Port(input, output);
    const id = await handshake(port);
    log(`${input.name}: ${id ? id.text : "no answer"}`);
    if (id && id.evilgenius) return new EgLink(port, id.text, input.name, log);
    port.close();
    if (id) other = other || id;
  }
  if (other && other.loader) throw err("update", `the FM-1 is in update mode (${other.text}). Finish the install first`, { detail: other.text });
  if (other) throw err("other", `this FM-1 runs ${firmwareName(other)} (${other.text}), not EVILGENIUS`, { detail: other.text });
  if (!usb.length && ins.length) throw err("ble", "the FM-1 is here over Bluetooth only. Plug in its USB cable: a backup and a restore need it");
  if (!usb.length) throw err("noport", "no FM-1 is plugged in. Use a USB data cable, straight to the computer");
  throw err("silent", "an FM-1 is plugged in but did not answer. Close other apps and tabs that use MIDI, then try again");
}

export class EgLink {
  constructor(port, id, name, log = () => {}) {
    Object.assign(this, { io: port, id, port: name, log, closed: false, q: Promise.resolve(), nextAt: 0, rto: 500, gap: GAP_MS });   // (rto: a read asked again after this long)
  }
  get lost() { return this.closed || this.io.lost; }
  close() { this.closed = true; this.io.close(); }
  // fn in the link's turn: nothing else of the link's in flight meanwhile
  turn(fn) {
    const p = this.q.then(fn, fn);
    this.q = p.catch(() => {});
    return p;
  }
  async send(bytes) {
    const wait = this.nextAt - now();
    if (wait > 0) await sleep(wait);
    this.nextAt = now() + this.gap;
    if (this.closed || !this.io.send(Array.from(bytes))) throw err("lost", "the FM-1 was unplugged");
  }
  // a request, sent again until `match` (a frame -> its result, or undefined: not it) gives one; null: no answer
  async ask(bytes, match, { timeout = 800, tries = 3 } = {}) {
    for (let t = 0; t < tries; t++) {
      if (t) this.log(`no answer in ${timeout} ms: asked again (${t})`);
      await this.send(bytes);
      const end = now() + timeout;
      while (now() < end) {
        const p = await this.io.read(end - now());
        if (!p) { if (this.lost) throw err("lost", "the FM-1 was unplugged"); break; }
        this.lastRx = now();
        const r = match(p);
        if (r !== undefined) return r;
      }
    }
    return null;
  }
  // a request whose answer comes in parts: onFrame gives MORE (another part: the wait starts again), the result, or
  // undefined (not it); a quiet `timeout` with parts read: partial() (what was read), none: sent again
  async askMany(bytes, onFrame, { timeout = 1500, tries = 2, partial = null } = {}) {
    for (let t = 0; t < tries; t++) {
      await this.send(bytes);
      let got = false, end = now() + timeout;
      while (now() < end) {
        const p = await this.io.read(end - now());
        if (!p) { if (this.lost) throw err("lost", "the FM-1 was unplugged"); break; }
        this.lastRx = now();
        const r = onFrame(p);
        if (r === MORE) { got = true; end = now() + timeout; continue; }
        if (r !== undefined) return r;
      }
      if (got && partial) return partial();
    }
    return partial ? partial() : null;
  }

  // ---- EvilGenius's own SysEx (egsysex.js). One command at a time, in the link's turn
  // (a quiet link is woken by a STATUS first: the first frame after a pause is the one most often lost, FIZZ's finding)
  async wake1() { if (!this.lastRx || now() - this.lastRx > 1000) await this.status1(); }
  async status1() {
    const r = await this.ask(statusRequest(), (p) => { const x = parseReply(p); return x && x.kind === "status" ? x : undefined; }, { timeout: 800, tries: 3 });
    return r || null;
  }
  status() { return this.turn(() => { this.io.drain(); return this.status1(); }); }
  // one command and its reply: `want` (its ACK by default), or the unit's error for that command ({old}: BAD COMMAND)
  cmd(f, cmd, { want = (r) => r.kind === "ack" && r.command === cmd, timeout = 15000, tries = 1, wake = true } = {}) {
    return this.turn(async () => {
      this.io.drain();
      if (wake) await this.wake1();
      return this.ask(f, (p) => {
        const r = parseReply(p);
        if (!r) return undefined;
        if (want(r)) return r;
        if (r.kind === "ack" && r.command === cmd) return r;
        return r.kind === "error" && r.command === cmd ? { status: r.status, statusName: r.statusName, old: r.status === 7 } : undefined;
      }, { timeout, tries });
    });
  }
  // every row of LIST (its parts); a part lost: read again, twice at most, then the rows read
  list({ factory = false, pool = false } = {}) {
    return this.turn(async () => {
      let short = null;
      for (let k = 0; k < 3; k++) {
        this.io.drain();
        const rows = [];
        const r = await this.askMany(listRequest({ factory, pool }), (p) => {
          const l = parseList(p);
          if (!l) return undefined;
          rows.push(...l.entries);
          return l.last ? { rows, total: l.total } : MORE;
        }, { partial: () => ({ rows, total: -1 }) });
        if (r && r.rows.length === r.total) return r.rows;
        if (r) { short = r.rows; this.log(`LIST: ${r.rows.length} of ${r.total} rows: read again`); }
      }
      return short || [];
    });
  }
  dump(source, slot) {
    return this.turn(() => { this.io.drain(); return this.ask(dumpRequest({ source, slot }), (p) => {
      const d = parseDump(p);
      if (d && (d.slot === slot || (source === "factory" && d.slot === 0))) return d.frame;
      const r = parseReply(p);
      return r && r.kind === "error" && r.command === CMD.DUMP ? null : undefined;
    }, { timeout: 1000, tries: 3 }); });
  }
  // every preset of a source (DUMP slot 0), as many as LIST counted, paced by the unit's reply ring
  dumpAll(source, total, onProgress = () => {}) {
    if (!total) return Promise.resolve([]);
    return this.turn(() => {
      this.io.drain();
      const out = [];
      return this.askMany(dumpRequest({ source, slot: 0 }), (p) => {
        const d = parseDump(p);
        if (!d || (source !== "factory" && d.source !== source)) return undefined;
        out.push(d.frame);
        onProgress(out.length, total);
        return out.length >= total ? out : MORE;
      }, { timeout: 4000, tries: 1, partial: () => out });
    });
  }
  dumpTrack(slot = 0) {
    return this.turn(() => { this.io.drain(); return this.ask(dumpRequest({ source: "track", slot }), (p) => {
      const d = parseDump(p);
      if (d && d.source === "track" && (!slot || d.track === slot - 1)) return d.frame;
      const r = parseReply(p);
      return r && r.kind === "error" && r.command === CMD.DUMP ? null : undefined;
    }, { timeout: 800, tries: 2 }); });
  }
  store(f) {
    return this.cmd(f, CMD.STORE6, { want: (r) => r.kind === "store", timeout: 15000, tries: 1 });   // (over a used place: a job on the unit)
  }
  flush() { return this.cmd(flushRequest(), CMD1.FLUSH, { want: (r) => r.kind === "status" }); }
  tags(source, slot, tags) { return this.cmd(tagsRequest({ source, slot, tags }), CMD1.TAGS, { timeout: 4000 }); }
  rename(source, slot, name) { return this.cmd(renameRequest({ source, slot, name }), CMD1.RENAME, { timeout: 4000 }); }
  remove(source, slot, { confirm = false } = {}) { return this.cmd(deleteRequest({ source, slot, confirm }), CMD1.DELETE); }
  swap(source, a, b) { return this.cmd(swapRequest({ source, a, b }), CMD1.SWAP, { timeout: source === "mine" ? 4000 : 15000 }); }
  poolRef(slot, id) { return this.cmd(poolRefRequest({ slot, id }), CMD1.POOLREF, { timeout: id ? 4000 : 15000 }); }
  users(source, slot) { return this.cmd(usersRequest({ source, slot }), CMD1.USERS, { want: (r) => r.kind === "users", timeout: 5000, tries: 2 }); }
  async projects() {
    const r = await this.cmd(projectsRequest(), CMD1.PROJECTS, { want: (x) => x.kind === "projects", timeout: 800, tries: 3 }).catch((e) => { if (e.code === "lost") throw e; return null; });
    return r && r.kind === "projects" ? r : null;
  }
  project(op, p, q = 0) { return this.cmd(projectRequest({ op, p, q }), CMD1.PROJECT, { timeout: 30000 }); }
  // a value of a track's sound, as a knob turned on the unit; with its ACK (the unit holds one frame: one at a time;
  // a value set sent again is harmless)
  param(track, id, value) { return this.cmd(paramRequest({ track, id, value, ack: true }), CMD.PARAM, { timeout: 1000, tries: 2, wake: false }); }
  browse(track, id) { return this.cmd(browseRequest({ track, id }), CMD.BROWSE, { timeout: 3000 }); }
  // ---- the open pattern, read (2026-11-15)
  patternInfo() {
    return this.turn(async () => {
      this.io.drain();
      await this.wake1();
      return this.ask(pinfoRequest(), (p) => {
        const r = parseReply(p);
        if (r && r.kind === "pinfo") return r;
        return r && r.kind === "error" && r.command === CMD_SEQ.PINFO ? { old: r.status === 7, status: r.status, statusName: r.statusName } : undefined;
      }, { timeout: 1000, tries: 3 });
    });
  }
  steps(track, { first = 0, count = 0, locks = false } = {}) {
    const want = count || 128 - first;
    return this.turn(async () => {
      this.io.drain();
      await this.wake1();
      const out = { pattern: -1, rev: -1, first, steps: new Array(want).fill(null), locks: locks ? [] : null };
      let got = 0, done = false;
      return this.askMany(stepsRequest({ track, first, count, locks }), (p) => {
        const st = parseSteps(p);
        if (st) {
          out.pattern = st.pattern; out.rev = st.rev; out.track = st.track;
          st.steps.forEach((w, k) => { if (st.first + k - first < want) out.steps[st.first + k - first] = w; });
          got += st.steps.length;
          return got >= want && !locks ? out : MORE;
        }
        const lk = parseLocks(p);
        if (lk && locks) { out.locks.push(...lk.locks); done = lk.last; return done ? out : MORE; }
        const r = parseReply(p);
        return r && r.kind === "error" && r.command === CMD_SEQ.STEPS ? { old: r.status === 7, status: r.status, statusName: r.statusName } : undefined;
      }, { timeout: 1500, tries: 2, partial: () => (got >= want && (!locks || done) ? out : null) });
    });
  }
  // ---- the open pattern, written (2026-11-15, phase 2): no wake STATUS before each (a drag's run stays quick)
  stepSet(o) { return this.cmd(stepSetRequest(o), CMD_SEQ.STEPSET, { timeout: 1500, tries: 2, wake: false }); }   // (a value set: sent again is harmless)
  lockSet(o) { return this.cmd(lockSetRequest(o), CMD_SEQ.LOCKSET, { timeout: 1500, tries: 2, wake: false }); }
  stepsPut(o) { return this.cmd(stepsPutRequest(o), CMD_SEQ.STEPSPUT, { timeout: 2000, tries: 2 }); }
  undo(redo = false) { return this.cmd(undoRequest(redo), CMD_SEQ.UNDO, { timeout: 2000, tries: 1 }); }
  // phase 3: a track's settings; the pattern the unit goes to
  trackSet(o) { return this.cmd(trackSetRequest(o), CMD_SEQ.TRACKSET, { timeout: 1500, tries: 2, wake: false }); }
  gotoPattern(p) { return this.cmd(gotoRequest(p), CMD_SEQ.GOTO, { timeout: 2000, tries: 1 }); }
  note(ch, n, vel) { this.io.send(vel ? [0x90 | (ch & 15), n & 127, vel & 127] : [0x80 | (ch & 15), n & 127, 0]); }
  // the panel's buttons, as the remote presses them (channel 16, CC 20 + the button: core/app/midi_map.h; app.h QD_B_*:
  // PLAY 10, REC 11): down, then up after ms (a tap: under the unit's 400 ms hold; a hold: over it)
  button(b, down) { this.io.send([0xBF, (20 + b) & 127, down ? 127 : 0]); }
  async press(b, ms = 60) { this.button(b, true); await sleep(ms); this.button(b, false); }

  version() {
    return this.turn(() => { this.io.drain(); return this.ask(egIdentityRequest(), (p) => parseEgIdentity(p) ?? undefined, { timeout: 400, tries: 2 }); });
  }

  info() { return this.turn(() => this.info1()); }
  async info1() {
    this.io.drain();
    const r = await this.ask(bulkFrame("FZBI"), (p) => { const b = parseBulk(p); return b && (b.tag === "FZBI" || b.tag === "FZER") ? b : undefined; },
      { timeout: 2500, tries: 4 });                        // (the unit's CRC of its whole store first)
    if (!r || r.tag !== "FZBI" || r.data.length < 12) return null;
    return { lo: rd32(r.data, 0), size: rd32(r.data, 4), crc: rd32(r.data, 8) };
  }

  read(from, to, onProgress = () => {}) { return this.turn(() => this.read1(from, to, onProgress)); }
  async read1(from, to, onProgress) {
    const out = new Uint8Array(to - from);
    this.io.drain();
    for (let off = from; off < to; ) {
      const n = Math.min(CHUNK, to - off);
      const r = await this.ask(bulkFrame("FZBR", [off, n]), (p) => {
        const b = parseBulk(p);
        if (!b) return undefined;
        if (b.tag === "FZER") throw err("fzer", `the FM-1 refused a read (code ${rd32(b.data, 0)})`, { fzer: rd32(b.data, 0) });
        return b.tag === "FZBD" && b.data.length === 4 + n && rd32(b.data, 0) === off ? b.data.subarray(4) : undefined;   // (else: a late duplicate)
      }, { timeout: this.rto, tries: 10 });
      if (!r) throw err("timeout", `the FM-1 stopped answering at ${off.toString(16)}`);
      out.set(r, off - from);
      off += n;
      onProgress((off - from) / (to - from));
    }
    return out;
  }

  // the store whole; its CRC-32 against the unit's, and once more from the start when they differ (the unit wrote
  // something while it was read)
  backup(onProgress = () => {}) {
    return this.turn(async () => {
      for (let attempt = 1; ; attempt++) {
        const info = await this.info1();
        if (!info) throw err("nobulk", "this FM-1 did not say where its store is");
        const image = await this.read1(0, info.size, onProgress);
        if (crc32(image) === info.crc) return { image, ...info };
        if (attempt >= 2) throw err("changed", "the FM-1 changed its store while it was read. Stop it, leave it alone, and try again");
        this.log("the store changed while it was read: reading it again");
      }
    });
  }

  // MY PRESETS' sectors, read while the store's CRC-32 stayed the same (the pages' own CRCs check the bytes)
  library(onProgress = () => {}) {
    return this.turn(async () => {
      for (let attempt = 1; ; attempt++) {
        const a = await this.info1();
        if (!a) throw err("nobulk", "this FM-1 did not say where its store is");
        if (a.size < LIB_BYTES) throw err("nobulk", "this FM-1's store is not the one this page knows");
        const bytes = await this.read1(0, LIB_BYTES, onProgress);
        const b = await this.info1();
        if (b && b.crc === a.crc) return { bytes, ...a };
        if (attempt >= 3) return { bytes, ...a, moving: true };   // (it keeps writing: what was read, said so)
      }
    });
  }

  // the store put back. The unit reads the image twice, 512 bytes a request: all of it first, to check its CRC-32
  // before anything is erased (phase "check"), then again while it erases and writes each sector (phase "write").
  // e.written: the unit had begun to write when it failed
  restore(image, { onProgress = () => {}, onPhase = () => {}, idleMs = 30000 } = {}) {
    return this.turn(async () => {
      const len = image.length, crc = crc32(image), t0 = now();
      let pass = 1, last = -1, served = 0, sends = 0, sentAt = 0, heard = now();
      const done = [0, 0];
      const go = async () => { sends++; await this.send(bulkFrame("FZSR", [len, crc])); sentAt = now(); };
      this.io.drain();
      onPhase("check");
      try {
        await go();
        for (;;) {
          const p = await this.io.read(500);
          if (!p) {
            if (this.lost) throw err("lost", "the FM-1 was unplugged");
            // (FZSR lost on the way: sent again; the unit starts on one it heard, and erases nothing before its check)
            if (!served && sends < 3 && now() - sentAt > 3000) { this.log(`the restore was not taken up: asked again (${sends})`); await go(); }
            if (now() - heard > idleMs) throw err("timeout", "the FM-1 stopped answering");
            continue;
          }
          const q = parseRequest(p);
          if (q) {
            heard = now();
            if (q.len > PULL || q.addr + q.len > len) throw err("badreq", `the FM-1 asked for ${q.addr.toString(16)}+${q.len}, outside the backup`);
            if (pass === 1 && q.addr < last) { pass = 2; onPhase("write"); }
            last = q.addr;
            await this.send(response(q.addr, image.subarray(q.addr, q.addr + q.len), q.fl));
            served++;
            done[pass - 1] = Math.max(done[pass - 1], q.addr + q.len);
            onProgress((done[0] + done[1]) / (2 * len), pass);
            continue;
          }
          const r = parseBulk(p);
          if (!r || (r.tag !== "FZOK" && r.tag !== "FZER")) continue;
          const code = r.data.length >= 4 ? rd32(r.data, 0) : 0;
          this.log(`restore: ${r.tag} ${code} after ${served} reads, ${Math.round(now() - t0)} ms`);
          if (r.tag === "FZOK") return { ok: true, served };
          throw err("fzer", FZER[code] || `the FM-1 refused (code ${code})`, { fzer: code });
        }
      } catch (e) {
        if (e.written === undefined) e.written = pass === 2;
        throw e;
      }
    });
  }
}
