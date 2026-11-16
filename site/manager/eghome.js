// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// HOME (F1): the Evil Genius's console. The SID-chip brain in its jar, big (the owner's own art, the unit's GENIUS_BIG),
// awake while an FM-1 is linked; what it says (the page's news, in its voice); THE CHIP: the picked track's sound as
// the SID's three voices (each oscillator's wave, its pitch and width); THE TRACKS: the open pattern's six tracks, each
// its sound's name and wave, its first page of steps, muted or not. A track: 1..6 or a click; ENTER its sound in SOUND,
// S its steps in SEQUENCE, R reads the FM-1 again. The virtual FM-1's screen stands in the jar's place: a click opens
// its panel (F9, egpanel.js).
//   mountHome({ $, link(), busy(), job(fn), say, refuse, toSound(track), toSeq(track), panel() }) -> { show(on), load(), says(text), gone(), render() }
import { parseDump } from "./egsysex.js";
import { soundFromDump, ID } from "./egsound.js";
import { stepOf } from "./egseq.js";
import { wave } from "./egpics.js";
import { VALUES } from "./egvalues.js";
import { paint } from "./egpanel.js";

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const px = (s, font = "small", scale = 2, color = "white") => { const t = document.createElement("px-text"); t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", color); t.textContent = s; return t; };
const QUIPS = ["CONNECT AN FM-1. I WILL TAKE IT FROM THERE.", "NO FM-1. I AM A BRAIN IN A JAR WITH NOTHING TO RULE.",
  "PLUG IT IN. USB. A DATA CABLE, NOT ONE OF YOUR CHEAP ONES."];
const WAVES = VALUES[ID.W1][5];

function scope(kind, pw, seed, col) {
  const pts = [];
  for (let i = 0; i <= 120; i++) pts.push(`${(i * 2).toFixed(0)},${(52 - wave(kind, (i / 40) % 1, pw, seed) * 44).toFixed(1)}`);
  return `<svg viewBox="0 0 240 60" width="100%" height="60" aria-hidden="true" style="display:block;shape-rendering:crispEdges"><polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="3"/></svg>`;
}

export function mountHome(ctx) {
  const { $ } = ctx;
  const S = { tracks: null, sounds: [], sel: 0, shown: false, said: QUIPS[0], loading: false, pattern: -1 };
  const root = $("tab-home");
  root.innerHTML = `
    <div class="homegrid">
      <section class="hbrain" aria-label="The Evil Genius">
        <div class="jar box" id="h-jar"><px-sprite name="GENIUS_BIG" scale="4"></px-sprite>
          <canvas id="h-unit" class="vscreen" width="240" height="240" hidden aria-label="The virtual FM-1's screen"></canvas>
          <p class="awake" id="h-awake"></p></div>
        <div class="box hsays"><p class="lab">THE GENIUS SAYS</p><p id="h-says" class="says" aria-live="polite"></p></div>
      </section>
      <section class="hright">
        <div class="box"><div class="hhead"><span class="lab" id="h-chipname">THE CHIP</span><span class="dim" id="h-chipnote"></span></div>
          <div class="voices" id="h-voices"></div></div>
        <div class="box"><div class="hhead"><span class="lab">THE TRACKS</span><span class="dim">1..6 PICK · ENTER SOUND · S STEPS</span></div>
          <div id="h-tracks" class="htracks" role="listbox" aria-label="The open pattern's tracks"></div></div>
      </section>
    </div>`;

  function says(t) {
    S.said = String(t || "").toUpperCase();
    const n = $("h-says");
    n.textContent = S.said;
    n.append(el("span", "cur"));
  }
  async function load(quiet = false) {
    const l = ctx.link();
    if (!l || S.loading) return;
    S.loading = true;
    try {
      const info = await l.patternInfo();
      const tracks = [];
      for (let t = 0; t < 6; t++) {
        const r = info && !info.old ? await l.steps(t, { first: 0, count: 16 }) : null;
        const f = await l.dumpTrack(t + 1);
        const d = f && parseDump(f);
        S.sounds[t] = d ? soundFromDump(d) : null;
        tracks.push({ name: (d && d.name) || (info && info.tracks ? info.tracks[t].name : `TRACK ${t + 1}`),
          steps: r && !r.old ? r.steps.map(stepOf) : null, mute: info && info.tracks ? info.tracks[t].tset[20] : 0 });
      }
      S.tracks = tracks;
      S.pattern = info && !info.old ? info.pattern : -1;
    } finally { S.loading = false; }
    // (followed every second on the FM-1 in this page: drawn again only when something changed)
    const snap = JSON.stringify([S.pattern, S.tracks, S.sounds.map((x) => x && [x.name, Array.from(x.blob || [])])]);
    if (quiet && snap === S.snap) return;
    S.snap = snap;
    render();
  }
  function render() {
    const l = ctx.link();
    $("h-awake").textContent = l ? `AWAKE · ${l.virtual ? "THE FM-1 IN THIS BROWSER · F9 ITS PANEL" : `${l.id} ON USB`}${S.pattern >= 0 ? ` · PATTERN ${"ABCD"[S.pattern >> 4]}${String((S.pattern & 15) + 1).padStart(2, "0")}` : ""}` : "ASLEEP · NO FM-1";
    $("h-awake").classList.toggle("on", !!l);
    if (!$("h-says").textContent) says(S.said);
    // the chip: the picked track's sound as three voices
    const v = $("h-voices"), snd = S.sounds[S.sel];
    v.textContent = "";
    $("h-chipname").textContent = `THE CHIP · TRACK ${S.sel + 1}${snd ? ` · ${snd.name}` : ""}`;
    $("h-chipnote").textContent = snd ? `FILTER ${["OFF", "LP", "BP", "HP", "NOTCH", "LP+BP", "BP+HP", "ALL"][snd.values[ID.FTYPE]]} ${snd.values[ID.FREQ]} · ${snd.values[ID.CHIP] ? "8580" : "6581"}` : "";
    for (let k = 0; k < 3; k++) {
      const box = el("div", "voice"), kind = snd ? snd.values[ID.W1 + 5 * k] : 0, col = ["#706deb", "#a9ff9f", "#c46c71"][k];
      box.append(px(`VOICE ${k + 1} · ${snd ? WAVES[kind] : "-"}`, "small", 2, kind ? "white" : "grey"));
      const sc = el("div"); sc.innerHTML = scope(kind, snd ? snd.values[ID.PW1 + 5 * k] / 128 : 0.5, k + 1, kind ? col : "#4a4a4a");
      box.append(sc, el("p", "dim", snd ? `COARSE ${snd.values[ID.C1 + 5 * k]} · PW ${snd.values[ID.PW1 + 5 * k]} · ${["", "SYNC", "RING", "S+R"][snd.values[ID.M1 + 5 * k]] || "FREE"}` : ""));
      v.append(box);
    }
    // the tracks
    const tl = $("h-tracks");
    tl.textContent = "";
    if (!S.tracks) { tl.append(el("p", "dim", l ? "Reading the FM-1 .." : "Connect an FM-1 to see its tracks.")); return; }
    S.tracks.forEach((t, k) => {
      const row = el("button", `htrack${k === S.sel ? " on" : ""}`);
      row.type = "button"; row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(k === S.sel));
      row.append(el("span", "hn", String(k + 1)), el("span", "hname", `${t.name}${t.mute ? " (MUTED)" : ""}`));
      const w = el("span", "hwave"); const s0 = S.sounds[k];
      w.innerHTML = scope(s0 ? s0.values[ID.W1] : 0, 0.5, k, "#706deb");
      const steps = el("span", "hsteps");
      for (let s = 0; s < 16; s++) { const c = el("i"); if (t.steps && t.steps[s].on) c.className = "on"; steps.append(c); }
      row.append(w, steps);
      row.addEventListener("click", () => { S.sel = k; render(); });
      row.addEventListener("dblclick", () => ctx.toSound(k));
      tl.append(row);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (!S.shown || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    if (/^[1-6]$/.test(e.key)) { S.sel = Number(e.key) - 1; render(); e.preventDefault(); }
    else if (e.key === "Enter" && S.tracks) { ctx.toSound(S.sel); e.preventDefault(); }
    else if (e.key.toLowerCase() === "s" && S.tracks) { ctx.toSeq(S.sel); e.preventDefault(); }
    else if (e.key.toLowerCase() === "r" && ctx.link()) { ctx.job(() => load()); e.preventDefault(); }
  });
  says(QUIPS[0]);
  // the virtual FM-1's own screen in the jar's place (its frames: 240 x 240 RGB565, as the unit draws them)
  let unsub = null;
  const img = $("h-unit").getContext("2d").createImageData(240, 240);
  $("h-unit").addEventListener("click", () => ctx.panel());
  function unit(vu) {
    if (unsub) { unsub(); unsub = null; }
    $("h-unit").hidden = !vu;
    $("h-jar").classList.toggle("virtual", !!vu);
    if (!vu) return;
    unsub = vu.onFrame((m) => {
      if (!m.fb) return;
      $("h-unit").getContext("2d").putImageData(paint(img, m.fb), 0, 0);
    });
  }
  return {
    load, render, says, unit,
    async follow() { if (S.shown && S.tracks) await load(true); },
    show(on) { S.shown = on; if (on && ctx.link() && !S.tracks) ctx.job(() => load()); render(); },
    gone() { S.tracks = null; S.sounds = []; S.pattern = -1; says(QUIPS[1 + Math.floor(Math.random() * 2)]); render(); },
    stale() { S.tracks = null; S.sounds = []; S.pattern = -1; },
    get sel() { return S.sel; },
  };
}
