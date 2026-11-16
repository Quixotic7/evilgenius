// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Charles Vestal (fm1-base's web/emu/worklet.js); EvilGenius's additions 2026-11-15
// EvilGenius in an AudioWorklet: app.wasm is the whole firmware (fm1-base web/emu/emu_web.c, the Bluetooth package's
// layout). Each render quantum asks it for 128 frames, which runs the device's clock forward; between quanta the page's
// input goes in and, about 30 times a second, the screen, the lights and any saved objects go out.
// EvilGenius's additions, for the manager's virtual FM-1 (site/manager/egvirtual.js):
//   - the store: the load message's `egStore` (the store's bytes, as a backup holds them) is written to the store's
//     flash before boot (firmware/app/fz_port.c eg_web_store); when its writes stop moving for half a second the
//     store goes out ({type: "eg-store", bytes}), so the page keeps it; {type: "eg-store-get"} asks for it now;
//   - MIDI: {type: "eg-midi", pkts: [USB-MIDI packets], sysex: [whole F0..F7 frames]} in: the packets (notes, the
//     clock) on the USB port as a cable's, the frames to app_sysex as the unit's USB device hands them (firmware/app/
//     fz_port.c eg_web_sysex); what the firmware sends comes back {type: "eg-midi", pkts, replies} after each quantum
//     (pkts: its MIDI packets; replies: its SysEx replies, whole F0..F7 frames back to back, fz_port.c eg_web_reply);
//   - {type: "eg-reboot", egStore}: the store replaced (a project sent, a backup restored) and the unit started again.
// fm1-base's own messages (load, buttons, keys, enc, master, sysex) are as its worklet's.

const clock = globalThis.performance ? () => globalThis.performance.now() : () => Date.now();
const PORT_USB = 0;

class Fm1 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ex = null;
    this.sentBlits = -1;
    this.sentWrites = -1;
    this.lastFrame = 0;
    this.busy = 0;
    this.frames = 0;
    this.eg = { writes: 0, changedAt: 0, sent: 0 };
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  putStore(bytes) {
    const ex = this.ex;
    if (!bytes || !ex.eg_web_store) return false;
    const n = Math.min(bytes.length, ex.eg_web_store_len());
    new Uint8Array(this.mem.buffer, ex.eg_web_store(), n).set(new Uint8Array(bytes).subarray(0, n));
    return true;
  }
  sendStore() {
    const ex = this.ex;
    if (!ex.eg_web_store) return;
    const bytes = new Uint8Array(this.mem.buffer, ex.eg_web_store(), ex.eg_web_store_len()).slice();
    this.eg.sent = ex.eg_web_store_writes();
    this.port.postMessage({ type: "eg-store", bytes, off: ex.eg_web_store_off() }, [bytes.buffer]);
  }

  async onMessage(m) {
    if (m.type === "load") {
      const now = () => BigInt(Math.round(currentTime * 1e9));
      const wasi = {
        clock_time_get: (id, prec, out) => { new DataView(this.mem.buffer).setBigUint64(out, now(), true); return 0; },
        fd_write: (fd, iov, n, out) => { new DataView(this.mem.buffer).setUint32(out, 0, true); return 0; },
        proc_exit: () => {},
      };
      const stub = new Proxy(wasi, { get: (t, k) => (k in t ? t[k] : () => 0) });
      const env = new Proxy({}, { get: () => () => 0 });
      const { instance } = await WebAssembly.instantiate(m.wasm, { wasi_snapshot_preview1: stub, env });
      this.ex = instance.exports;
      this.mem = this.ex.memory;
      if (this.ex._initialize) this.ex._initialize();
      const max = this.ex.web_store_max();
      for (const [obj, bytes] of Object.entries(m.store || {})) {
        const b = new Uint8Array(bytes).subarray(0, max);
        new Uint8Array(this.mem.buffer, this.ex.web_store(+obj), b.length).set(b);
        this.ex.web_store_set_len(+obj, b.length);
      }
      this.sentWrites = this.ex.web_store_writes();
      if (m.egStore) this.putStore(m.egStore);
      this.ex.web_master(m.master ?? 2800);
      this.ex.web_boot();
      this.eg.writes = this.eg.sent = this.ex.eg_web_store_writes ? this.ex.eg_web_store_writes() : 0;
      this.port.postMessage({ type: "ready", store: !!this.ex.eg_web_store, storeLen: this.ex.eg_web_store ? this.ex.eg_web_store_len() : 0 });
    } else if (!this.ex) {
      return;
    } else if (m.type === "eg-midi") {                // MIDI from the page: packets (notes, the clock) and SysEx frames
      for (const p of m.pkts || []) this.ex.web_midi_in(PORT_USB, p >>> 0);
      for (const f of m.sysex || []) {                // (whole frames, F0 .. F7: to app_sysex, as the unit's USB device does)
        const b = Uint8Array.from(f);
        if (b.length < 2 || b[0] !== 0xF0 || b[b.length - 1] !== 0xF7 || !this.ex.eg_web_sysex) continue;
        const body = b.subarray(1, b.length - 1);
        new Uint8Array(this.mem.buffer, this.ex.eg_web_sx_buf(), body.length).set(body);
        this.ex.eg_web_sysex(body.length);
      }
    } else if (m.type === "eg-store-get") {
      this.sendStore();
    } else if (m.type === "eg-reboot") {
      if (m.egStore) this.putStore(m.egStore);
      this.ex.web_boot();
      this.eg.writes = this.eg.sent = this.ex.eg_web_store_writes();
      this.port.postMessage({ type: "eg-rebooted" });
    } else if (m.type === "eg-call") {                // a call of the firmware's own (fz_port.c eg_web_mfx, eg_web_tools): its text back
      const f = this.ex[m.fn];
      let text = "";
      if (f) {
        const at = f(...(m.args || [])) >>> 0, mem = new Uint8Array(this.mem.buffer);
        let end = at;
        while (mem[end]) end++;
        text = String.fromCharCode(...mem.subarray(at, Math.min(end, at + 49152)));
      }
      this.port.postMessage({ type: "eg-called", id: m.id, text });
    } else if (m.type === "buttons") {
      this.ex.web_buttons(m.mask >>> 0);
    } else if (m.type === "keys") {
      this.ex.web_keys(m.mask >>> 0);
    } else if (m.type === "enc") {
      this.ex.web_enc(m.role, m.n | 0);
    } else if (m.type === "master") {
      this.ex.web_master(m.value | 0);
    } else if (m.type === "sysex") {                  // a screen reader's frame: the bytes between F0 and F7
      const b = Uint8Array.from(m.bytes).subarray(0, 64);
      new Uint8Array(this.mem.buffer, this.ex.web_sysex_buf(), b.length).set(b);
      this.ex.web_sysex(b.length);
    }
  }

  publish() {
    const ex = this.ex;
    const blits = ex.web_blits();
    const msg = { type: "frame", buttons: ex.web_lit_buttons() >>> 0, keys: ex.web_lit_keys() >>> 0,
      dimButtons: ex.web_dim_buttons ? ex.web_dim_buttons() >>> 0 : 0, dimKeys: ex.web_dim_keys ? ex.web_dim_keys() >>> 0 : 0,
      view: ex.eg_web_view ? ex.eg_web_view() >>> 0 : -1 };          // (where the panel is: fz_port.c eg_web_view)
    if (this.frames >= 44100) {                       // the share of real time spent running the device
      msg.load = Math.round(100 * this.busy / (this.frames / 44.1));
      this.busy = this.frames = 0;
    }
    const transfer = [];
    const said = ex.web_said_len();
    if (said) {
      msg.said = new Uint8Array(this.mem.buffer, ex.web_said_buf(), said).slice();
      ex.web_said_clear();
      transfer.push(msg.said.buffer);
    }
    if (blits !== this.sentBlits) {
      this.sentBlits = blits;
      msg.fb = new Uint16Array(this.mem.buffer, ex.web_fb(), 240 * 240).slice();
      transfer.push(msg.fb.buffer);
    }
    const writes = ex.web_store_writes();
    if (writes !== this.sentWrites) {
      this.sentWrites = writes;
      msg.store = {};
      for (let o = 0; o < ex.web_nobj(); o++) {
        const n = ex.web_store_len(o);
        if (n >= 0) msg.store[o] = new Uint8Array(this.mem.buffer, ex.web_store(o), n).slice();
      }
    }
    this.port.postMessage(msg, transfer);
    // the store: out once its writes have stopped moving for half a second
    if (ex.eg_web_store_writes) {
      const w = ex.eg_web_store_writes();
      if (w !== this.eg.writes) { this.eg.writes = w; this.eg.changedAt = currentTime; }
      else if (w !== this.eg.sent && currentTime - this.eg.changedAt > 0.5) this.sendStore();
    }
  }

  process(inputs, outputs) {
    if (!this.ex) return true;
    const out = outputs[0];
    const n = out[0].length;
    const t0 = clock();
    this.ex.web_render(n);
    this.busy += clock() - t0;
    this.frames += n;
    out[0].set(new Float32Array(this.mem.buffer, this.ex.web_out_l(), n));
    if (out[1]) out[1].set(new Float32Array(this.mem.buffer, this.ex.web_out_r(), n));
    const k = this.ex.web_out_n();                    // what the firmware sent: to the page
    const r = this.ex.eg_web_out_n ? this.ex.eg_web_out_n() : 0;   // (its SysEx replies, whole frames: fz_port.c)
    if (k || r) {
      const pkts = k ? new Uint32Array(this.mem.buffer, this.ex.web_out_pkts(), k).slice() : new Uint32Array(0);
      const replies = r ? new Uint8Array(this.mem.buffer, this.ex.eg_web_out_buf(), r).slice() : new Uint8Array(0);
      if (k) this.ex.web_out_clear();
      if (r) this.ex.eg_web_out_clear();
      this.port.postMessage({ type: "eg-midi", pkts, replies }, [pkts.buffer, replies.buffer]);
    }
    if (currentTime - this.lastFrame >= 1 / 30) {
      this.lastFrame = currentTime;
      this.publish();
    }
    return true;
  }
}

registerProcessor("fm1", Fm1);
