// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// REMOTE MODE: THE HARDWARE AS THE PANEL of the FM-1 in this browser: an FM-1 running RemoteFM1, or EVILGENIUS itself
// in its REMOTE MODE (firmware/app/app.c fz_rm_*: the same messages, no screen), plays the firmware in the page. Its
// keys, buttons and knobs go in as the page's own panel does (egvirtual.js vu.keys / vu.buttons / vu.enc / vu.master),
// and the page's screen and lights go out to it, so the unit in the hand shows and plays what the browser runs.
// This file is a host of RemoteFM1's protocol, version 2, written from its specification (RemoteFM1 docs/PROTOCOL.md,
// proto/rfm1.h, MPL-2.0): SysEx F0 7D 52 46 <cmd> <body, 7-in-8> F7 over Web MIDI; HELLO finds the unit, SESSION takes
// it over, the panel comes as plain MIDI (keys: notes on channel 16; buttons: notes on channel 15; knobs: CC 16.. on
// channel 15; MASTER: CC 7 / 39) with PANEL_R twice a second to set straight what was lost, LEDS and TILES go out.
// The names here are fm1-base's (include/plat.h: B_*, EN_*; device/panel.c: the matrix ids).
//   const r = await findRemote(access, { log })  -> { input, output, hello } or null
//   const s = new RemoteSession(r, vu, { log, onLost })  ; await s.start() ; s.stop()
//   pack7 / unpack7 / frame / tilesOf / ledsOf (no DOM: the tests)
//   screenOf(view) -> the manager's screen for where the firmware's panel is (the worklet's frame.view); GOTO: the
//   unit's button that takes it to a screen picked here
const HEAD = [0xF0, 0x7D, 0x52, 0x46];
export const CMD = { HELLO: 0x01, SESSION: 0x10, LEDS: 0x11, TILES: 0x12, PANEL_REQ: 0x13, HELLO_R: 0x41, ACK: 0x46, FRAME_ACK: 0x52, PANEL_R: 0x53 };
const BODY_MAX = 1024, KEEPALIVE_MS = 3000, T = 16, W = 240, H = 240;
// the matrix: a button's id per label (B_FX .. B_OCTUP), an encoder per role (EN_SELECT .. EN_K4), and where each
// button's and key's LED is (fm1-base bsp/boards/fm1/fm1_input.h FM1_KEYMAP: rows PA5..PA8 are bits 1..4, 11 columns)
const BTN_ID = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1], ENC_ID = [0, 1, 6, 2, 3, 4, 5];
const KEYMAP = [null, [5, 11, 4, 10, 3, 9, 2, 8, -1, -1, -1], [34, 35, 36, 37, 38, 40, 39, 13, 7, 6, 12],
  [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33], [0, 1, 15, 14, 17, 16, 19, 18, 20, 21, 22]];
const LED_AT = [];                                          // matrix id -> [column, row bit]
for (let r = 1; r <= 4; r++) KEYMAP[r].forEach((id, c) => { if (id >= 0) LED_AT[id] = [c, r]; });
const B_PLAY = 10, PLAY_GREEN = 1 << 14, NB = 14, NKEYS = 27;

// Where the firmware's panel is (fz_port.c eg_web_view: the mode, the view << 4, the latched menu << 8, SEQ's page + 1
// << 12, the selected track << 16, the first value of the sound editor's page << 20; core/app/ctl.h QD_MODE_*,
// QD_VIEW_*, QD_LATCH_*, QD_SEQ_*) as the manager's screen, so the two move as one: every page of the unit has its
// screen here. The sequencer's views (STEPS, EDIT, the PIANO ROLL, OVERVIEW) are SEQUENCE in its matching view; MIX is
// MIX; EDIT is SOUND on the selected track, on the page that holds the unit's page's first value; PRESETS' browser and
// SAVE PRESET are LIBRARY; the projects and the name editor PROJECTS; MIDI FX and TOOLS their own screens (egmfx.js,
// egtools.js); GEEK OUT is HOME. A page the manager has no screen of its own for yet (PATTERNS, EFFECTS, the settings,
// the keyboard ..) is the FM-1 screen
// (egpanel.js): the unit's own page with every control's job written on it. title: the unit's name for where it is.
const LATCHES = [null, ["fm1", "F3 MENU"], ["fm1", "RECORD SETTINGS"], ["fm1", "SETTINGS"], ["edit", "SOUND EDITOR"], ["fm1", "TRACK SETTINGS"],
  ["mix", "MIX"], ["fm1", "EFFECTS"], ["library", "PRESETS"], ["projects", "NAME"], ["projects", "PROJECTS"], ["library", "SAVE PRESET"],
  ["mfx", "MIDI FX"], ["tools", "TOOLS"]];
const VIEWS = [["seq", "PIANO ROLL", "roll"], ["seq", "STEPS", "steps"], ["seq", "EDIT", "steps"], ["home", "GEEK OUT"], ["home", "GEEK OUT"],
  ["home", "GEEK OUT"], ["home", "GEEK OUT"], ["home", "GEEK OUT"], ["seq", "OVERVIEW", "tracks"]];
export function screenOf(v) {
  if (v == null || v < 0) return null;
  const mode = v & 15, view = (v >> 4) & 15, latch = (v >> 8) & 15, seq = ((v >> 12) & 15) - 1, track = (v >> 16) & 15, value = (v >> 20) & 255;
  if (LATCHES[latch]) return { tab: LATCHES[latch][0], title: LATCHES[latch][1], track, ...(latch === 4 ? { value } : {}) };
  if (seq === 0) return { tab: "tools", title: "TOOLS", track };
  if (seq === 1) return { tab: "fm1", title: "PATTERNS", track };
  if (seq === 2) return { tab: "seq", title: "PIANO ROLL", track, seqView: "roll" };
  if (mode === 0) return { tab: null, title: "ASLEEP", track };          // (the idle screen: the manager stays where it is)
  if (mode === 2) return { tab: "fm1", title: "KEYBOARD", track };
  if (mode === 3) return { tab: "fm1", title: "TRACKS", track };
  const w = VIEWS[view];
  return w ? { tab: w[0], title: w[1], track, seqView: w[2] } : null;
}
// the other way: a screen picked in the manager takes the unit there. Each: the unit's button to tap (its bit, B_*)
// and how the view says it is there; tapped again until it is (the idle screen eats a press, HOME and SEQ cycle), three
// times at most. A screen with no page on the unit (LIBRARY's list, POOL, PROJECTS, CABINET) takes it nowhere.
const lat = (v) => (v >> 8) & 15, sq = (v) => ((v >> 12) & 15) - 1;
export const GOTO = {
  mix: { btn: 2, there: (v) => lat(v) === 6 },
  edit: { btn: 4, there: (v) => lat(v) === 4 },
  seq: { btn: 6, there: (v) => !lat(v) && sq(v) < 0 && (v & 15) === 1 && [1, 2].includes((v >> 4) & 15) },
  mfx: { btn: 8, there: (v) => lat(v) === 12 },
  tools: { btn: 9, there: (v) => lat(v) === 13 || sq(v) === 0 },
  fx: { btn: 0, there: (v) => lat(v) === 7 },
};

export function pack7(body) {
  const out = [];
  for (let i = 0; i < body.length; i += 7) {
    const g = Math.min(7, body.length - i);
    let msb = 0;
    for (let k = 0; k < g; k++) msb |= (body[i + k] >> 7) << k;
    out.push(msb);
    for (let k = 0; k < g; k++) out.push(body[i + k] & 0x7F);
  }
  return out;
}
export function unpack7(bytes) {
  const out = [];
  let g = 0, msb = 0;
  for (const b of bytes) {
    if (!g) { msb = b; g = 1; continue; }
    out.push((b & 0x7F) | (((msb >> (g - 1)) & 1) << 7));
    g = g === 7 ? 0 : g + 1;
  }
  return out;
}
export const frame = (cmd, body = []) => [...HEAD, cmd, ...pack7(body), 0xF7];
// a SysEx message of RemoteFM1's: { cmd, body } or null
export function parse(d) {
  if (!d || d.length < 6 || d[0] !== 0xF0 || d[1] !== 0x7D || d[2] !== 0x52 || d[3] !== 0x46 || d[d.length - 1] !== 0xF7) return null;
  return { cmd: d[4], body: unpack7(Array.prototype.slice.call(d, 5, d.length - 1)) };
}
const text = (b, o, n) => String.fromCharCode(...b.slice(o, o + n).filter((c) => c >= 32 && c < 127)).trim();
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
export function helloOf(b) {
  if (b.length < 51) return null;
  const transports = b[25], sxq = u16(b, 29), long = b.length >= 67;
  return { name: text(b, 0, 16), proto: b[16], version: text(b, long ? 59 : 17, 8), identity: text(b, 43, 8), transports, sxq,
    screen: long && u16(b, 51) > 0 && u16(b, 53) > 0, caps: long ? u16(b, 55) : 0, inflight: long ? b[57] || 1 : 1, bluetooth: !!(transports & 16) && sxq <= 256 };
}

// the lights as LEDS takes them (45 bytes: lit, mid, dim, faint per column, flags): the app's lit and dim buttons
// (bit B_*; bit 14: PLAY's green LED) and keys (bit k)
export function ledsOf(buttons, keys, dimButtons = 0, dimKeys = 0) {
  const out = new Array(45).fill(0);
  const put = (base, id) => { const q = LED_AT[id]; if (q) out[base + q[0]] |= 1 << q[1]; };
  for (let i = 0; i < NB; i++) { if ((buttons >>> i) & 1) put(0, BTN_ID[i]); else if ((dimButtons >>> i) & 1) put(22, BTN_ID[i]); }
  for (let k = 0; k < NKEYS; k++) { if ((keys >>> k) & 1) put(0, 14 + k); else if ((dimKeys >>> k) & 1) put(22, 14 + k); }
  if (buttons & PLAY_GREEN) out[44] |= 1;
  return out;
}

// the screen's changes as TILES bodies: the 16 x 16 tiles of fb (240 x 240, each pixel's two bytes in the LCD's order,
// as the firmware's frame buffer holds them) that differ from model (the same, or null: everything), each coded the
// shortest way (FILL, PAL of 2 / 4 / 16 colours, RLE, RAW), packed into bodies of at most 1024 bytes; the last has END.
// model is brought up to fb. -> [body, ..] (empty: nothing changed)
export function tilesOf(fb, model, frameNo) {
  const bodies = [];
  let cur = null, n = 0;
  const open = () => { cur = [frameNo & 255, (frameNo >> 8) & 255, 0, 0]; n = 0; };
  const shut = () => { if (cur && n) { cur[3] = n; bodies.push(cur); } cur = null; };
  const hi = (v) => v & 255, lo = (v) => v >> 8;            // (the bytes as they lie in memory: the LCD's high byte first)
  for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) {
    let diff = !model;
    for (let y = 0; y < T && !diff; y++) { const o = (ty + y) * W + tx; for (let x = 0; x < T; x++) if (fb[o + x] !== model[o + x]) { diff = true; break; } }
    if (!diff) continue;
    const px = new Array(T * T), cols = [];
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const v = fb[(ty + y) * W + tx + x]; px[y * T + x] = v; if (cols.length <= 16 && !cols.includes(v)) cols.push(v); }
    let enc, pay;
    if (cols.length === 1) { enc = 1; pay = [hi(cols[0]), lo(cols[0])]; }
    else {
      const rle = [];
      for (let i = 0; i < px.length;) { let j = i + 1; while (j < px.length && px[j] === px[i] && j - i < 256) j++; rle.push(j - i - 1, hi(px[i]), lo(px[i])); i = j; }
      let pal = null;
      if (cols.length <= 16) {
        const bpp = cols.length <= 2 ? 1 : cols.length <= 4 ? 2 : 4;
        pal = [cols.length, ...cols.flatMap((c) => [hi(c), lo(c)])];
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x += 8 / bpp) {      // (16 pixels: every row ends on a byte)
          let byte = 0;
          for (let k = 0; k < 8 / bpp; k++) byte = (byte << bpp) | cols.indexOf(px[y * T + x + k]);
          pal.push(byte);
        }
      }
      if (pal && pal.length <= rle.length) { enc = 2; pay = pal; }
      else if (rle.length < T * T * 2) { enc = 3; pay = rle; }
      else { enc = 0; pay = px.flatMap((v) => [hi(v), lo(v)]); }
    }
    if (!cur || cur.length + 5 + pay.length > BODY_MAX) { shut(); open(); }
    cur.push(tx, ty, T, T, enc, ...pay);
    n++;
  }
  shut();
  if (bodies.length) bodies[bodies.length - 1][2] |= 1;     // END
  if (model) model.set(fb);
  return bodies;
}

// HELLO to every port pair; the one that answers as RemoteFM1 (found by its answer, never by its name)
export async function findRemote(access, { log = () => {}, ms = 350 } = {}) {
  const live = (m) => [...m.values()].filter((p) => p.state !== "disconnected");
  for (const input of live(access.inputs)) {
    const output = live(access.outputs).find((o) => o.name === input.name);
    if (!output) continue;
    try { await input.open(); await output.open(); } catch (_) { continue; }
    const was = input.onmidimessage;
    const hello = await new Promise((res) => {
      const tm = setTimeout(() => res(null), ms);
      input.onmidimessage = (e) => { const m = parse(e.data); if (m && m.cmd === CMD.HELLO_R) { clearTimeout(tm); res(helloOf(m.body)); } };
      try { output.send(frame(CMD.HELLO, [...new TextEncoder().encode("EVILGENIUS")])); } catch (_) { clearTimeout(tm); res(null); }
    });
    input.onmidimessage = was;
    if (hello && /^(RemoteFM1|EVILGENIUS)/.test(hello.name) && hello.proto === 2) { log(`${input.name}: ${hello.name} ${hello.version} can be the panel`); return { input, output, hello }; }
  }
  return null;
}

export class RemoteSession {
  constructor({ input, output, hello }, vu, { log = () => {}, onLost = () => {} } = {}) {
    Object.assign(this, { input, output, hello, vu, log, onLost, on: false, keys: 0, buttons: 0, enc: null, model: null, frameNo: 0, flying: 0,
      next: null, lastFb: null, leds: "", ledsAt: 0, seenAt: 0, masterHi: 0, timer: null, unsub: null, sentAt: 0 });
    this.id = `${hello.name} ${hello.version}`.trim();
    this.screen = hello.screen && !hello.bluetooth;         // (EVILGENIUS takes no screen; Bluetooth carries no moving one)
  }
  send(cmd, body) { try { this.output.send(frame(cmd, body)); return true; } catch (_) { return false; } }
  async start() {
    // (the port may be a link's too, EVILGENIUS's own SysEx: what is not this protocol's goes on to it)
    this.prev = this.input.onmidimessage;
    this.input.onmidimessage = (e) => { if (this.prev && !(e.data && e.data[0] === 0xF0 && parse(e.data))) this.prev(e); this.take(e.data); };
    this.on = true;
    this.seenAt = Date.now();
    this.send(CMD.SESSION, [1, KEEPALIVE_MS & 255, KEEPALIVE_MS >> 8]);
    this.unsub = this.vu.onFrame((m) => this.frame(m));
    // the heartbeat: the lights at least once a second (the unit ends a session it hears nothing in), the unit's own
    // every half second (none for 1.6 s: it is gone), a frame never acknowledged sent again whole
    this.timer = setInterval(() => {
      if (!this.on) return;
      const now = Date.now();
      if (now - this.seenAt > 1600 || this.input.state === "disconnected") { this.stop(true); return; }
      if (now - this.ledsAt > 900) this.sendLeds(true);
      if (this.flying && now - this.sentAt > 2000) { this.flying = 0; this.model = null; this.push(); }
    }, 250);
    this.log(`remote: ${this.id} is the panel${this.screen ? "" : " (over Bluetooth: no screen)"}`);
  }
  stop(lost = false) {
    if (!this.on) return;
    this.on = false;
    clearInterval(this.timer);
    if (this.unsub) this.unsub();
    if (!lost) this.send(CMD.SESSION, [0, 0, 0]);
    this.input.onmidimessage = this.prev || null;
    this.vu.buttons(0, "remote"); this.vu.keys(0, "remote");
    if (lost) this.onLost();
  }
  // ---- the unit's panel in
  take(d) {
    if (!this.on || !d || !d.length) return;
    const st = d[0], vu = this.vu;
    if (st === 0x9F || st === 0x8F) {                       // a key: note 53 + k on channel 16
      const k = d[1] - 53;
      if (k < 0 || k >= NKEYS) return;
      this.keys = (st === 0x9F && d[2] ? this.keys | (1 << k) : this.keys & ~(1 << k)) >>> 0;
      vu.keys(this.keys, "remote");
    } else if (st === 0x9E || st === 0x8E) {                // a button: note = its matrix id on channel 15
      const i = BTN_ID.indexOf(d[1]);
      if (i < 0) return;
      this.buttons = (st === 0x9E && d[2] ? this.buttons | (1 << i) : this.buttons & ~(1 << i)) >>> 0;
      vu.buttons(this.buttons, "remote");
    } else if (st === 0xBE) {
      const role = ENC_ID.indexOf(d[1] - 16);
      if (d[1] >= 16 && d[1] < 23 && role >= 0) { const n = d[2] - 64; if (n) { vu.enc(role, n); if (this.enc) this.enc[d[1] - 16] = (this.enc[d[1] - 16] + n) & 0xFFFF; } }
      else if (d[1] === 7) this.masterHi = d[2];
      else if (d[1] === 39) vu.master(Math.round((((this.masterHi << 7) | d[2]) >> 4) * 4096 / 1023));
    } else if (st === 0xF0) {
      const m = parse(d);
      if (!m) return;
      this.seenAt = Date.now();
      if (m.cmd === CMD.PANEL_R && m.body.length >= 25) this.panel(m.body);
      else if (m.cmd === CMD.FRAME_ACK && m.body.length >= 3) {
        this.flying = Math.max(0, this.flying - 1);
        if (m.body[2] & 2) this.model = null;               // (the unit's screen was reset: everything again)
        if (this.next || !this.model) this.push();
      }
    }
  }
  // the whole panel, twice a second: what the events told is set straight by it
  panel(b) {
    if (!(b[24] & 1)) { this.stop(true); return; }          // (no session any more)
    const k32 = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0, b16 = u16(b, 4);
    let btn = 0;
    for (let i = 0; i < NB; i++) if ((b16 >> BTN_ID[i]) & 1) btn |= 1 << i;
    if (k32 !== this.keys) { this.keys = k32; this.vu.keys(k32, "remote"); }
    if (btn !== this.buttons) { this.buttons = btn; this.vu.buttons(btn, "remote"); }
    const now = Array.from({ length: 7 }, (_, e) => u16(b, 6 + 2 * e));
    if (this.enc) now.forEach((c, e) => { const d = ((c - this.enc[e] + 0x8000) & 0xFFFF) - 0x8000; if (d) this.vu.enc(ENC_ID.indexOf(e), d); });
    else this.vu.master(Math.round(u16(b, 20) * 4096 / 1023));   // (the first one: where MASTER stands)
    this.enc = now;
  }
  // ---- the page's screen and lights out
  frame(m) {
    if (!this.on) return;
    this.lit = [m.buttons >>> 0, m.keys >>> 0, (m.dimButtons || 0) >>> 0, (m.dimKeys || 0) >>> 0];
    this.sendLeds(false);
    if (m.fb && this.screen) { this.next = m.fb; this.push(); }
  }
  sendLeds(always) {
    const l = ledsOf(...(this.lit || [0, 0, 0, 0])), s = l.join();
    if (!always && s === this.leds) return;
    this.leds = s; this.ledsAt = Date.now();
    this.send(CMD.LEDS, l);
  }
  push() {
    if (!this.on || !this.screen || this.flying >= this.hello.inflight) return;
    const fb = this.next || this.lastFb;
    if (!fb) return;
    this.next = null; this.lastFb = fb;
    const bodies = tilesOf(fb, this.model, ++this.frameNo);
    if (!this.model) this.model = Uint16Array.from(fb);     // (what the unit shows once this frame is in)
    if (!bodies.length) return;
    this.flying++;
    this.sentAt = Date.now();
    for (const b of bodies) this.send(CMD.TILES, b);
  }
}
