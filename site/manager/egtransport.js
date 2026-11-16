// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The transport, in the top bar on every screen: PLAY / STOP and REC, the pattern playing and its tempo, a light while
// it plays. The keys are the panel's own, pressed as the remote presses them (eglink.js press: channel 16, CC 30 PLAY,
// CC 31 REC), so they do what the unit's buttons do: PLAY tapped plays or stops; REC held arms the recording (stopped:
// PLAY then starts it) or latches it (playing), REC tapped while it records stops it. STATUS tells what happened (read
// again after each press, and every second while nothing else is going on); PATTERN INFO the pattern and its tempo.
// The unit's idle screen eats the press that wakes it (ctl.c qd_ctl_button): a press that changed nothing is made again,
// once.
//   SPACE play / stop, SHIFT + SPACE rec (not while typing).
//   mountTransport({ $, say, refuse, link(), busy(), job(fn) }) -> { poll(), gone(), render(), play(), rec() }
import { BUTTON, HOLD_MS } from "./eglink.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const patName = (k) => `${"ABCD"[(k >> 4) & 3]}${String((k & 15) + 1).padStart(2, "0")}`;

export function mountTransport(ctx) {
  const { $, say } = ctx;
  const S = { st: null, bpm: 0, pattern: -1, last: 0, info: 0, pressing: false };
  const box = $("transport");
  box.innerHTML = `<button id="tr-play" class="key plain trk" type="button" aria-keyshortcuts="Space" title="PLAY / STOP (SPACE)"><span class="trg" aria-hidden="true">▶</span><px-text font="big" scale="2" color="white">PLAY</px-text></button>
    <button id="tr-rec" class="key plain trk" type="button" aria-keyshortcuts="Shift+Space" title="REC (SHIFT + SPACE): held on the unit, it arms the recording; tapped, it stops it"><span class="trr" aria-hidden="true">●</span><px-text font="big" scale="2" color="white">REC</px-text></button>
    <span id="tr-info" class="pill trinfo" aria-live="polite">-- · --- BPM</span>`;
  const refresh = async () => {
    const l = ctx.link();
    if (!l) return;
    S.st = await l.status();
    S.last = performance.now();
    if (S.st && (S.st.pattern !== S.pattern || performance.now() - S.info > 5000)) {
      const p = await l.patternInfo().catch(() => null);
      if (p && !p.old) { S.bpm = p.bpm; S.pattern = p.pattern; }
      else S.pattern = S.st.pattern;
      S.info = performance.now();
    }
    render();
  };
  // a press of the panel's button (no job: the transport goes while a screen works too; the unit takes the CC between
  // the SysEx frames), then STATUS when the page is free
  async function press(b, ms) {
    const l = ctx.link();
    if (!l || S.pressing) return;
    S.pressing = true;
    try {
      await l.press(b, ms);
      await sleep(120);
      if (!ctx.busy()) await refresh();
    } catch (e) { if (e.code === "lost") throw e; }
    finally { S.pressing = false; }
  }
  // the state now, a press, and the press again if the first only woke the unit's screen
  async function pressFor(b, ms, moved) {
    const l = ctx.link();
    if (!l || S.pressing) return;
    const before = await l.status().catch(() => null);
    if (!before) return;
    S.st = before;
    await press(b, ms);
    if (S.st && !moved(before, S.st)) await press(b, ms);
  }
  async function play() {
    await pressFor(BUTTON.PLAY, 60, (a, z) => a.playing !== z.playing);
    if (S.st) say(S.st.playing ? `Playing ${patName(S.pattern)}.` : "Stopped.");
  }
  async function rec() {
    const st = ctx.link() && await ctx.link().status().catch(() => null);
    await pressFor(BUTTON.REC, st && st.rec ? 60 : HOLD_MS + 150, (a, z) => a.rec !== z.rec);
    if (S.st) say(S.st.rec ? (S.st.playing ? "Recording." : "Recording armed: PLAY (SPACE) starts it.") : "Not recording.");
  }
  function render() {
    const l = ctx.link(), st = l ? S.st : null;
    $("tr-play").disabled = !l;
    $("tr-rec").disabled = !l;
    $("tr-play").classList.toggle("on", !!(st && st.playing));
    $("tr-play").querySelector("px-text").text = st && st.playing ? "STOP" : "PLAY";
    $("tr-play").querySelector(".trg").textContent = st && st.playing ? "■" : "▶";
    $("tr-play").setAttribute("aria-label", st && st.playing ? "Stop (Space)" : "Play (Space)");
    $("tr-rec").classList.toggle("on", !!(st && st.rec));
    $("tr-rec").setAttribute("aria-pressed", String(!!(st && st.rec)));
    $("tr-info").textContent = st ? `${patName(S.pattern >= 0 ? S.pattern : st.pattern)} · ${S.bpm ? `${S.bpm} BPM` : "--- BPM"}${st.playing ? " · ▶" : ""}` : "-- · --- BPM";
    $("tr-info").classList.toggle("on", !!(st && st.playing));
  }
  $("tr-play").addEventListener("click", () => play());
  $("tr-rec").addEventListener("click", () => rec());
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    if (!$("boot").hidden || !$("title").hidden || !$("help").hidden || !ctx.link()) return;
    e.preventDefault();
    if (e.shiftKey) rec(); else play();
  });
  render();
  return {
    play, rec, render,
    // (from the manager's read-back, never during a job: STATUS a second at most)
    async poll() { if (ctx.link() && !S.pressing && performance.now() - S.last > 1000) await refresh(); },
    gone() { S.st = null; S.bpm = 0; S.pattern = -1; render(); },
    get state() { return S; },
  };
}
