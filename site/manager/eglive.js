// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EDIT's live link to a track of the FM-1 and its routes (no DOM: the tests run them in Node).
//
// Live: the values a drag changes go to the unit as PARAMs, one at a time with its ACK (the unit holds one SysEx frame:
// a second sent while it waits is dropped), only the latest value of each id (a fast drag sends what it ends on, not
// every step). A sound that is not the track's (a preset, a file) goes whole as an AUDITION instead: onto the track,
// nothing stored, the latest one only.
//   const live = new Live({ link, track, log, onError(ack), onIdle() });  live.set(id, v); live.sound(frame);
//   live.busy, live.quietFor() (ms since the last send: the read-back waits), await live.idle()
//
// Routes: a source (an LFO, or a MOD slot's source) dropped on a value (egsound.js DEST_ID: the destination that moves
// it) or on a destination with no value of its own (PITCH, PAN ..):
//   destOf(id) -> the destination that moves value id | -1;  routesTo(values, dest) -> [routes]
//   plan(values, src, dest) -> { changes: [[id, v]], route } | { existing: route } | { full: true } | { none: true }
//   src: { kind: "lfo", k: 0..2 } | { kind: "mod", src: 1..8 }
import { lfo, mod, NLFO, NMOD, routes } from "./egsound.js";
import { DEST_ID } from "./egvalues.js";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class Live {
  constructor({ link, track = "selected", log = () => {}, onError = () => {}, onIdle = () => {} }) {
    Object.assign(this, { link, track, log, onError, onIdle, q: new Map(), whole: null, running: false, lastAt: 0, sent: 0 });
    this.waiters = [];
  }
  get busy() { return this.running || this.q.size > 0 || !!this.whole; }
  quietFor() { return this.busy ? 0 : now() - this.lastAt; }
  set(id, value) { this.q.delete(id); this.q.set(id, value); this.pump(); }
  sound(frame) { this.whole = frame; this.q.clear(); this.pump(); }
  idle() { return this.busy ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.whole || this.q.size) {
        if (this.whole) {
          const f = this.whole;
          this.whole = null;
          const r = await this.link.store(f);
          this.sent++;
          if (!r || r.status) this.onError(r || { statusName: "no answer" });
        } else {
          const [id, v] = this.q.entries().next().value;
          this.q.delete(id);
          const r = await this.link.param(this.track, id, v);
          this.sent++;
          if (!r || r.status) this.onError({ ...(r || { statusName: "no answer" }), id });
        }
        this.lastAt = now();
      }
    } catch (e) {
      this.q.clear(); this.whole = null;
      this.onError({ statusName: e.message, error: e });
    } finally {
      this.running = false;
      this.lastAt = now();
      const w = this.waiters; this.waiters = [];
      w.forEach((r) => r());
      this.onIdle();
    }
  }
}

// the destination whose movement is value id's (DEST_ID inverted: each value at most one)
const DEST_OF = new Map(DEST_ID.map((v, d) => [v, d]).filter(([v]) => v >= 0));
export const destOf = (id) => (DEST_OF.has(id) ? DEST_OF.get(id) : -1);
// the destinations with no value of their own: a drop target of their own on the panel
export const PADS = DEST_ID.map((v, d) => (d && v < 0 ? d : -1)).filter((d) => d > 0);

export const routesTo = (values, dest) => routes(values).filter((r) => r.dest === dest);

export function plan(values, src, dest) {
  if (!(dest > 0)) return { none: true };
  if (src.kind === "lfo") {
    const k = src.k, dId = lfo(k, "DEST"), depId = lfo(k, "DEPTH");
    if (values[dId] === dest && values[depId] !== 64) return { existing: { kind: "lfo", k, dest } };
    const changes = [[dId, dest]];
    if (values[depId] === 64) changes.push([depId, 64 + 24]);       // (none at the centre: a route that moves)
    return { changes, route: { kind: "lfo", k, dest } };
  }
  for (let k = 0; k < NMOD; k++)
    if (values[mod(k, 0)] === src.src && values[mod(k, 1)] === dest) return { existing: { kind: "mod", k, src: src.src, dest } };
  for (let k = 0; k < NMOD; k++)
    if (!values[mod(k, 0)] || !values[mod(k, 1)])
      return { changes: [[mod(k, 0), src.src], [mod(k, 1), dest], [mod(k, 2), 40]], route: { kind: "mod", k, src: src.src, dest } };
  return { full: true };
}
// a route taken off: an LFO's DEST to OFF, a slot's SOURCE to OFF
export const unroute = (r) => (r.kind === "lfo" ? [[lfo(r.k, "DEST"), 0]] : [[mod(r.k, 0), 0]]);
export { NLFO };
