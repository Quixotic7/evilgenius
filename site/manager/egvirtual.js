// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// THE VIRTUAL FM-1 (docs/BROWSER-FM1-PLAN.md phase 4): EvilGenius's own firmware, the Bluetooth package's build for the
// browser (firmware/build.py --web --ble: vfm1/app.wasm), running in an AudioWorklet (vfm1/worklet.js: the firmware's
// own, firmware/app/web/emu/worklet.js). It sounds through the computer, and the manager talks to it as to an FM-1 on
// USB: the same SysEx, the same link (eglink.js EgLink), every screen unchanged. What differs is the store: the page
// holds it, so a backup is a copy, a restore a copy back and a restart, and the store is kept in this browser
// (IndexedDB "evilgenius-virtual") whenever the firmware writes it, so the jam is there next time.
//   const vu = await startVirtual({ base, log, onWait }); (onWait: the browser wants a key or a click first) vu.access (requestMIDIAccess's shape); vu.link (a VirtualLink);
//   vu.onFrame(fn): the unit's screen (fb: 240 x 240 RGB565) and lights as they change; vu.stop()
//   vu.storeNow() -> the store's bytes now; await vu.replaceStore(bytes) (and restart)
//   vu.buttons(mask), vu.keys(mask), vu.enc(role, n), vu.master(0..4096): the unit's panel, as its scanner reads it (egpanel.js)
//   await vu.call("eg_web_mfx" | "eg_web_tools" | .., ..numbers) -> the firmware's answer (MIDI FX, TOOLS: egmfx.js, egtools.js);
//   await vu.knob(role, n): a knob turned n slow detents (eg_web_knob)
import { EgLink, Port } from "./eglink.js";
import { crc32 } from "./egwire.js";
import { LAYOUT, LIB_BYTES } from "./egstore.js";

export const VIRTUAL_NAME = "VIRTUAL FM-1";
const DB = "evilgenius-virtual", KEY = "unit";

// ---- the store kept in this browser
function db() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("no IndexedDB")); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("units");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error("IndexedDB"));
  });
}
async function kept(op, value) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction("units", op === "get" ? "readonly" : "readwrite"), s = t.objectStore("units");
      const r = op === "get" ? s.get(KEY) : op === "put" ? s.put(value, KEY) : s.delete(KEY);
      t.oncomplete = () => { d.close(); res(r.result); };
      t.onerror = () => { d.close(); rej(t.error); };
    });
  } catch (_) { return null; }
}
export const virtualStore = { load: () => kept("get"), save: (v) => kept("put", v), forget: () => kept("delete") };

// a channel message (1..3 bytes) as a USB-MIDI packet on cable 0 (CIN: the status's high nibble)
const packet = (b) => (((b[0] >> 4) & 15) | (b[0] << 8) | ((b[1] || 0) << 16) | ((b[2] || 0) << 24)) >>> 0;
// a USB-MIDI packet back to its bytes (channel messages and real time; SysEx comes whole, as replies)
function unpacket(p) {
  const cin = p & 15, b = [(p >> 8) & 255, (p >> 16) & 255, (p >>> 24) & 255];
  if (cin >= 8 && cin <= 14) return b.slice(0, cin === 12 || cin === 13 ? 2 : 3);
  if (cin === 15) return b.slice(0, 1);
  return null;
}

export async function startVirtual({ base = "./vfm1/", log = () => {}, master = 2800, onWait = () => {} } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.AudioWorkletNode) throw new Error("this browser cannot run the virtual FM-1 (no AudioWorklet)");
  const ac = new AC({ sampleRate: 44100, latencyHint: "interactive" });
  // a browser lets a page sound only after a key or a click, and the firmware runs on the sound's clock: wait for one
  if (ac.state !== "running") await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 300))]).catch(() => {});
  if (ac.state !== "running") {
    onWait();
    await new Promise((res) => {
      const go = () => ac.resume().then(() => { for (const t of ["pointerdown", "keydown"]) removeEventListener(t, go, true); res(); }, () => {});
      for (const t of ["pointerdown", "keydown"]) addEventListener(t, go, true);
    });
  }
  await ac.audioWorklet.addModule(`${base}worklet.js`);
  const node = new AudioWorkletNode(ac, "fm1", { numberOfInputs: 0, outputChannelCount: [2] });
  node.connect(ac.destination);
  const [wasm, saved] = await Promise.all([fetch(`${base}app.wasm`).then((r) => { if (!r.ok) throw new Error("the virtual FM-1's firmware is missing (vfm1/app.wasm)"); return r.arrayBuffer(); }), virtualStore.load()]);
  const input = { name: VIRTUAL_NAME, state: "connected", onmidimessage: null, open: async () => {}, close: async () => {} };
  const output = { name: VIRTUAL_NAME, state: "connected", open: async () => {}, close: async () => {},
    send: (bytes) => {
      const b = Array.from(bytes);
      if (b[0] === 0xF0) node.port.postMessage({ type: "eg-midi", sysex: [b] });
      else if (b[0] >= 0x80) node.port.postMessage({ type: "eg-midi", pkts: [packet(b)] });
    } };
  const access = { inputs: new Map([[VIRTUAL_NAME, input]]), outputs: new Map([[VIRTUAL_NAME, output]]), onstatechange: null, sysexEnabled: true };
  const frames = new Set(), waiters = [], calls = new Map();
  let callId = 0;
  const vu = { ac, node, access, store: saved && saved.store ? new Uint8Array(saved.store) : null, objs: (saved && saved.objs) || {},
    savedAt: saved ? saved.at : null, log, stopped: false };
  const wait = (type) => new Promise((r) => waiters.push({ type, r }));
  // the worklet's messages: the firmware's replies and MIDI, its store, its screen
  node.port.onmessage = (e) => {
    const m = e.data;
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].type === m.type) { waiters[i].r(m); waiters.splice(i, 1); }
    if (m.type === "eg-midi") {
      const deliver = (d) => { if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from(d) }); };
      if (m.replies && m.replies.length) { let st = 0; for (let i = 0; i < m.replies.length; i++) if (m.replies[i] === 0xF7) { deliver(m.replies.subarray(st, i + 1)); st = i + 1; } }
      for (const p of m.pkts || []) { const d = unpacket(p); if (d) deliver(d); }
    } else if (m.type === "eg-called") {
      const r = calls.get(m.id);
      if (r) { calls.delete(m.id); let j = null; try { j = JSON.parse(m.text); } catch (_) { /* (an older build: nothing) */ } r(j); }
    } else if (m.type === "eg-store") {
      vu.store = m.bytes;
      vu.savedAt = new Date().toISOString();
      virtualStore.save({ store: m.bytes, objs: vu.objs, at: vu.savedAt }).catch(() => {});
    } else if (m.type === "frame") {
      if (m.store) { vu.objs = m.store; if (vu.store) virtualStore.save({ store: vu.store, objs: vu.objs, at: new Date().toISOString() }).catch(() => {}); }
      for (const f of frames) f(m);
    }
  };
  node.port.postMessage({ type: "load", wasm, store: vu.objs, egStore: vu.store, master });
  const ready = await wait("ready");
  if (!ready.store) throw new Error("this virtual FM-1's firmware has no store for the page (an older build)");
  log(`virtual FM-1: started${vu.store ? `, its store from this browser (${vu.savedAt})` : ", a new store"}`);
  vu.onFrame = (fn) => { frames.add(fn); return () => frames.delete(fn); };
  vu.storeNow = async () => { node.port.postMessage({ type: "eg-store-get" }); const m = await wait("eg-store"); return m.bytes; };
  vu.replaceStore = async (bytes) => {
    node.port.postMessage({ type: "eg-reboot", egStore: bytes });
    await wait("eg-rebooted");
    vu.store = bytes;
    await virtualStore.save({ store: bytes, objs: vu.objs, at: new Date().toISOString() });
  };
  // what is held, from each hand on it (who: the page's panel, a unit as the panel: egremote.js): the firmware reads all
  const held = { buttons: new Map(), keys: new Map() };
  const hold = (type, mask, who) => { held[type].set(who, mask >>> 0); let m = 0; for (const v of held[type].values()) m |= v; node.port.postMessage({ type, mask: m >>> 0 }); };
  vu.buttons = (mask, who = "page") => hold("buttons", mask, who);
  vu.keys = (mask, who = "page") => hold("keys", mask, who);
  vu.enc = (role, n) => node.port.postMessage({ type: "enc", role, n });
  // a call of the firmware's own (the browser build's exports, fz_port.c: eg_web_mfx, eg_web_tools): its answer, parsed
  vu.call = (fn, ...args) => new Promise((res) => {
    const id = ++callId;
    calls.set(id, res);
    node.port.postMessage({ type: "eg-call", id, fn, args });
    setTimeout(() => { if (calls.delete(id)) res(null); }, 1000);
  });
  // a knob of the unit's turned n slow detents (eg_web_knob: its answer a number, where the panel is, not text)
  vu.knob = (role, n) => new Promise((res) => {
    const id = ++callId;
    calls.set(id, res);
    node.port.postMessage({ type: "eg-call", id, fn: "eg_web_knob", args: [role, n], raw: true });
    setTimeout(() => { if (calls.delete(id)) res(null); }, 1000);
  });
  vu.nav = (what, v) => node.port.postMessage({ type: "eg-call", id: 0, fn: "eg_web_nav", args: [what, v], raw: true });   // (the unit goes where the manager went)
  vu.master = (value) => node.port.postMessage({ type: "master", value });   // (the volume: 0..4096)
  vu.stop = async () => {
    vu.stopped = true;
    input.state = output.state = "disconnected";
    try { node.disconnect(); await ac.close(); } catch (_) { /* (closed) */ }
  };
  vu.link = new VirtualLink(new Port(input, output), vu, log);
  return vu;
}

// the manager's link to the virtual FM-1: EvilGenius's SysEx as on the unit (EgLink), the store from the page
export class VirtualLink extends EgLink {
  constructor(port, vu, log) {
    super(port, "VIRTUAL", VIRTUAL_NAME, log);
    this.vu = vu;
    this.gap = 0;
    this.virtual = true;
  }
  async image() { return this.vu.storeNow(); }
  info() { return this.turn(async () => { const s = await this.image(); return { lo: LAYOUT.region, size: s.length, crc: crc32(s) >>> 0 }; }); }
  info1() { return this.image().then((s) => ({ lo: LAYOUT.region, size: s.length, crc: crc32(s) >>> 0 })); }
  read(from, to, onProgress = () => {}) { return this.turn(async () => { const s = await this.image(); onProgress(1); return s.slice(from, to); }); }
  backup(onProgress = () => {}) { return this.turn(async () => { const image = await this.image(); onProgress(1); return { image, lo: LAYOUT.region, size: image.length, crc: crc32(image) >>> 0 }; }); }
  library(onProgress = () => {}) { return this.turn(async () => { const s = await this.image(); onProgress(1); return { bytes: s.slice(0, LIB_BYTES), lo: LAYOUT.region, size: s.length, crc: crc32(s) >>> 0 }; }); }
  restore(image, { onProgress = () => {}, onPhase = () => {} } = {}) {
    return this.turn(async () => {
      if (image.length !== LAYOUT.size) throw Object.assign(new Error(`a store of ${image.length} bytes is not this FM-1's (${LAYOUT.size})`), { code: "fzer" });
      onPhase("write");
      await this.vu.replaceStore(Uint8Array.from(image));
      onProgress(1, 2);
      return { ok: true, served: 0 };
    });
  }
}
