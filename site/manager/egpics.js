// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SOUND's pictures, drawn from the sound's values as the unit draws its pages (core/ui/ui_snd.c, the 240 x 240 screen
// they echo): the oscillators' waves (the SID's combined waves, sync and ring), the three envelopes with the chip's own
// attack / decay / release times, the filter's response (its mode, cutoff and resonance), the LFOs' waves with the
// arrow to what they move, the word, the modulation slots. Each a small SVG's markup (pixel-crisp lines, the C64's
// colours). No DOM: the tests run it in Node.
//   picture(key, values) -> SVG markup | ""   (key: the editor's sections: osc env filter amp vox lfo mod voice)
import { ID, lfo, mod, destName, MOD_SOURCES } from "./egsound.js";
import { VALUES } from "./egvalues.js";

const C = { blue: "#2e2c9b", lb: "#706deb", lg: "#a9ff9f", lr: "#c46c71", cy: "#75cec8", ye: "#edf171", wh: "#ffffff", gr: "#7b7b7b", dg: "#4a4a4a", pu: "#8e3c97" };
const W = 300, H = 120;
const svg = (body, h = H, label = "") => `<svg viewBox="0 0 ${W} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="${label}" style="display:block;shape-rendering:crispEdges">${body}</svg>`;
const poly = (pts, col, w = 2, extra = "") => `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="${w}" ${extra}/>`;
const text = (x, y, s, col = C.wh, size = 12, anchor = "start") => `<text x="${x}" y="${y}" fill="${col}" font-family="ui-monospace, Menlo, monospace" font-size="${size}" text-anchor="${anchor}">${s}</text>`;
const frac = (x) => x - Math.floor(x);
const hash = (n) => frac(Math.sin(n * 12.9898) * 43758.5453);

// one oscillator's wave (QD_SW_*: OFF TRI SAW PULSE NOISE T+S P+T P+S P+T+S): the SID's combined waves sound as the AND
// of their parts; drawn as such (a sketch of it)
export function wave(kind, phase, pw = 0.5, seed = 1) {
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2, saw = phase, pul = phase < pw ? 1 : 0;
  switch (kind) {
    case 1: return tri;
    case 2: return saw;
    case 3: return pul;
    case 4: return hash(Math.floor(phase * 16) + seed * 97);
    case 5: return tri * saw;
    case 6: return pul * tri;
    case 7: return pul * saw;
    case 8: return pul * tri * saw;
    default: return 0.5;
  }
}
function oscPic(v) {
  const ks = [0, 1, 2], ratio = (k) => 2 ** ((v[ID.C1 + 5 * k] + (v[ID.F1 + 5 * k] - 64) / 64) / 12);
  const on = ks.filter((k) => v[ID.W1 + 5 * k]);
  let body = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="${C.lb}" stroke-width="2"/>`;
  if (!on.length) return svg(body + text(W / 2, H / 2 + 4, "ALL THREE OFF", C.gr, 12, "middle"), H, "Every oscillator off");
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240 * 3;
    let y = 0;
    for (const k of on) {
      let ph = frac(t * ratio(k));
      const m = v[ID.M1 + 5 * k], src = (k + 2) % 3;                      // (1 by 3, 2 by 1, 3 by 2)
      if ((m === 1 || m === 3) && v[ID.W1 + 5 * src]) ph = frac(frac(t * ratio(src)) * ratio(k) / ratio(src) * 1.7);   // sync
      let w = wave(v[ID.W1 + 5 * k], ph, v[ID.PW1 + 5 * k] / 128, k + 1);
      if ((m === 2 || m === 3) && v[ID.W1 + 5 * src]) w = w * (wave(1, frac(t * ratio(src))) * 2 - 1) * 0.5 + 0.5;   // ring
      y += w;
    }
    pts.push([6 + i * (W - 12) / 240, H - 10 - (y / on.length) * (H - 20)]);
  }
  body += poly(pts, C.lb, 2);
  ks.forEach((k) => { body += text(10 + k * 34, 16, `${k + 1}`, v[ID.W1 + 5 * k] ? C.ye : C.dg, 12); });
  return svg(body, H, `The oscillators: ${on.map((k) => VALUES[ID.W1][5][v[ID.W1 + 5 * k]]).join(", ")}`);
}

// the SID's envelope rates (ms): attack 2 .. 8000; decay and release three times as long; sustain 0..15 of 15
const ATK = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
export const sidTimes = (a, d, r) => ({ atk: ATK[a], dec: ATK[d] * 3, rel: ATK[r] * 3 });
function envLine(a, d, s, r, x0, w, h, y0) {
  const T = sidTimes(a, d, r), scale = (ms) => Math.log10(1 + ms) / Math.log10(1 + 24000);
  const xa = x0 + w * 0.3 * scale(T.atk), xd = xa + w * 0.3 * scale(T.dec), xs = Math.max(xd + 20, x0 + w * 0.68), xr = xs + w * 0.3 * scale(T.rel);
  const top = y0 + 4, bot = y0 + h - 4, sl = bot - (bot - top) * s / 15;
  const curve = (xa1, ya, xb, yb) => Array.from({ length: 9 }, (_, i) => { const f = i / 8; return [xa1 + (xb - xa1) * f, yb + (ya - yb) * Math.exp(-4 * f)]; });
  return [[x0, bot], [xa, top], ...curve(xa, top, xd, sl), [xs, sl], ...curve(xs, sl, xr, bot), [x0 + w, bot]];
}
function envPic(v) {
  let body = "";
  const rows = [[ID.EATK, null, C.lg, "ENV 1 AMP"], [ID.E2A, ID.E2LINK, C.cy, "ENV 2"], [ID.E3A, ID.E3LINK, C.lr, "ENV 3"]];
  rows.forEach(([a0, link, col, name], k) => {
    const linked = link !== null && v[link];
    const src = linked ? ID.EATK : a0;
    body += poly(envLine(v[src], v[src + 1], v[src + 2], v[src + 3], 4, W - 8, 34, 4 + k * 38), linked ? C.dg : col, linked ? 1 : 2, linked ? 'stroke-dasharray="4 3"' : "");
    body += text(W - 6, 16 + k * 38, `${name}${linked ? " = 1" : ""}`, linked ? C.gr : col, 11, "end");
  });
  const T = sidTimes(v[ID.EATK], v[ID.EDEC], v[ID.EREL]);
  return svg(body, H, `ENV 1: attack ${T.atk} ms, decay ${T.dec} ms, sustain ${v[ID.ESUS]} of 15, release ${T.rel} ms`);
}

// the filter's response: its mode's shape (LP BP HP and their sums), the cutoff on a log axis, the resonance a peak
function filterPic(v) {
  const mode = v[ID.FTYPE], fc = v[ID.FREQ] / 2047, q = v[ID.RESO] / 15;
  const lp = mode === 1 || mode === 5 || mode === 7, bp = mode === 2 || mode === 5 || mode === 6 || mode === 7, hp = mode === 3 || mode === 6 || mode === 7 || mode === 4;
  const pts = [];
  for (let i = 0; i <= 150; i++) {
    const x = i / 150, d = (x - fc) * 9;
    let g = mode === 0 ? 1 : 0;
    if (lp) g = Math.max(g, 1 / (1 + Math.exp(d * 1.6)));
    if (hp) g = Math.max(g, 1 / (1 + Math.exp(-d * 1.6)));
    if (bp) g = Math.max(g, Math.exp(-d * d * 0.8));
    if (mode === 4) g = 1 - Math.exp(-d * d * 1.2);
    if (mode) g += q * 0.7 * Math.exp(-d * d * 6);
    pts.push([4 + x * (W - 8), H - 6 - Math.min(1.25, g) * (H - 30)]);
  }
  const cx = 4 + fc * (W - 8);
  const body = `<polygon points="4,${H - 6} ${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} ${W - 4},${H - 6}" fill="${C.blue}"/>` +
    poly(pts, C.cy, 2) + `<line x1="${cx}" y1="8" x2="${cx}" y2="${H - 6}" stroke="${C.ye}" stroke-width="2" stroke-dasharray="4 4"/>` +
    text(8, 16, ["OFF", "LP", "BP", "HP", "NOTCH", "LP+BP", "BP+HP", "ALL"][mode], C.wh, 12) +
    text(W - 6, 16, v[ID.CHIP] ? "8580" : "6581", C.gr, 11, "end");
  return svg(body, H, `The filter: ${["off", "low pass", "band pass", "high pass", "notch", "LP + BP", "BP + HP", "all"][mode]}, cutoff ${v[ID.FREQ]}, resonance ${v[ID.RESO]}`);
}

// DRIVE and CRUSH: a sine through them (BITS: the steps, SRR: each value held)
function ampPic(v) {
  const bits = v[ID.BITS], srr = v[ID.SRR], drv = v[ID.DRIVE] / 127;
  const steps = bits ? Math.max(2, 2 ** Math.max(1, 16 - Math.round(bits * 14 / 127)) / 512) : 0, hold = 1 + Math.floor(srr / 3);
  const pts = [];
  let held = 0;
  for (let i = 0; i <= 200; i++) {
    if (i % hold === 0) {
      let y = Math.sin(i / 200 * Math.PI * 4);
      y = Math.tanh(y * (1 + drv * 6)) / Math.tanh(1 + drv * 6);
      held = steps ? Math.round(y * steps) / steps : y;
    }
    pts.push([4 + i * (W - 8) / 200, H / 2 - held * (H / 2 - 14)]);
  }
  return svg(poly(pts, C.lr, 2) + text(8, 16, `LEVEL ${v[ID.LEVEL]}`, C.wh, 11), H, `Drive ${v[ID.DRIVE]}, bits ${bits}, sample rate reduction ${srr}`);
}

// the LFOs: each wave (its WAVE, the ARP waves a staircase), its depth, an arrow to its destination's name
export function lfoWave(kind, ph) {
  switch (kind) {
    case 0: return ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
    case 1: return Math.sin(ph * Math.PI * 2);
    case 2: return ph * 2 - 1;
    case 3: return ph < 0.5 ? 1 : -1;
    case 4: return hash(Math.floor(ph * 8) + 3) * 2 - 1;
    case 5: return (Math.exp(ph * 3) - 1) / (Math.exp(3) - 1) * 2 - 1;
    case 6: return 1 - ph * 2;
    default: { const n = [2, 2, 3, 3, 3, 4, 4, 4, 3][kind - 7] || 3; return Math.floor(ph * n * 2) % n / (n - 1) * 2 - 1; }   // (an arpeggio: its notes)
  }
}
function lfoPic(v) {
  let body = "";
  for (let k = 0; k < 3; k++) {
    const dest = v[lfo(k, "DEST")], depth = (v[lfo(k, "DEPTH")] - 64) / 64, kind = v[lfo(k, "WAVE")], y0 = 6 + k * 38, col = [C.cy, C.ye, C.lr][k];
    const pts = Array.from({ length: 81 }, (_, i) => [8 + i * 1.6, y0 + 16 - lfoWave(kind, frac(i / 40)) * 14 * (dest ? Math.max(0.15, Math.abs(depth)) : 0.15)]);
    body += text(4, y0 + 10, `${k + 1}`, col, 11) + poly(pts.map(([x, y]) => [x + 10, y]), dest ? col : C.dg, 2);
    if (dest) body += `<path d="M150 ${y0 + 16} L188 ${y0 + 16} M182 ${y0 + 11} L188 ${y0 + 16} L182 ${y0 + 21}" stroke="${C.wh}" stroke-width="2" fill="none"/>` +
      text(194, y0 + 20, `${destName(dest)} ${depth > 0 ? "+" : ""}${Math.round(depth * 64)}`, C.wh, 11);
    else body += text(194, y0 + 20, "OFF", C.dg, 11);
  }
  return svg(body, H, "The three LFOs and what they move");
}

// the word: its name over a waveform (the sample's look, from the word's own number), START and END marked; SAY under
function voxPic(v) {
  const word = v[ID.WORD], names = VALUES[ID.WORD][5], say = VALUES[ID.SAY][5][v[ID.SAY]] || "OFF";
  let body = text(W / 2, 18, word ? names[word] : "NO WORD", word ? C.wh : C.gr, 14, "middle");
  if (word) {
    for (let i = 0; i < 70; i++) {
      const gap = hash(word * 31 + Math.floor(i / 9)) < 0.18, h = gap ? 2 : 8 + hash(word * 7 + i) * 52;
      body += `<rect x="${12 + i * 4}" y="${62 - h / 2}" width="3" height="${h}" fill="${C.lg}"/>`;
    }
    const xs = 12 + v[ID.VSTART] / 127 * 280, xe = 12 + v[ID.VEND] / 127 * 280;
    body += `<rect x="${xs}" y="26" width="3" height="72" fill="${C.wh}"/><rect x="${xe}" y="26" width="3" height="72" fill="${C.lr}"/>`;
  }
  body += text(8, H - 6, `SAY: ${say}`, v[ID.SAY] ? C.cy : C.gr, 11);
  return svg(body, H, `The word ${word ? names[word] : "none"}; SAY ${say}`);
}

// the modulation slots: each its source, destination, depth as a bar from the middle
function modPic(v) {
  let body = `<line x1="${W * 0.62}" y1="2" x2="${W * 0.62}" y2="${H - 2}" stroke="${C.dg}" stroke-width="2"/>`;
  for (let k = 0; k < 8; k++) {
    const src = v[mod(k, 0)], dst = v[mod(k, 1)], d = v[mod(k, 2)] / 127, y = 6 + k * 14, on = src && dst;
    body += text(4, y + 9, on ? MOD_SOURCES[src] : "-", on ? C.lg : C.dg, 10) + text(56, y + 9, on ? destName(dst) : "", C.gr, 10);
    if (on) body += `<rect x="${d >= 0 ? W * 0.62 : W * 0.62 + d * W * 0.36}" y="${y}" width="${Math.abs(d) * W * 0.36}" height="9" fill="${C.lg}"/>`;
  }
  return svg(body, H, "The eight modulation slots");
}

const PICS = { osc: oscPic, env: envPic, filter: filterPic, amp: ampPic, vox: voxPic, lfo: lfoPic, mod: modPic };
export function picture(key, values) {
  const f = PICS[key];
  if (!f || !values) return "";
  try { return f(values); } catch (_) { return ""; }
}
