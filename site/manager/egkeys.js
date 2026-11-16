// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Every key of the manager, in one table: HELP (?) shows it, and the screens' own handlers are the ones it names (this
// file handles the global ones: the screens, HELP). No key fights the browser's own (CMD + W, CMD + R, ..); F1..F8 are
// taken where the browser lets a page have them, ALT + 1..8 always.
//   KEYS: [{screen, rows: [[keys, what]]}]; mountKeys({ $, tab(name), current(), tabs }) -> { help(open) }
export const KEYS = [
  { screen: "EVERYWHERE", rows: [["F1 .. F8", "HOME LIBRARY SOUND SEQUENCE MIX POOL PROJECTS CABINET"], ["ALT + 1 .. 8", "the same, on any keyboard"],
    ["SPACE", "PLAY / STOP the FM-1"], ["SHIFT + SPACE", "REC: arm, or stop recording"], ["?", "this screen"], ["ESC", "close, let go"],
    ["TAB / ENTER", "the next control / press it"]] },
  { screen: "HOME", rows: [["1 .. 6", "a track"], ["ENTER", "its sound in SOUND"], ["S", "its steps in SEQUENCE"], ["R", "read the FM-1 again"]] },
  { screen: "LIBRARY", rows: [["UP / DOWN", "a sound (PAGE, HOME, END)"], ["/", "find"], ["A M F", "all, mine, factory"], ["1 .. 7", "a tag filter"],
    ["ENTER", "edit it in SOUND"], ["L", "load it on the FM-1 (K: the track)"], ["E", "export it"], ["N / T", "rename / tags (MY PRESETS)"],
    ["U", "used by"], ["[ ]", "move it up / down"], ["DELETE", "delete it"], ["R", "read again"]] },
  { screen: "SOUND", rows: [["1 .. 9", "a page"], ["LEFT / RIGHT", "the value beside"], ["UP / DOWN", "turn it (PAGE: big, HOME / END)"],
    ["ENTER / DELETE", "its list / its default"], ["SHIFT + M", "modulate it"], ["A W S .. ;", "play the track (Z / X octave)"],
    ["SHIFT + R / 1..6", "read the track / a track"], ["SHIFT + L", "LIVE"], ["SHIFT + S / P", "save as new / replace"],
    ["SHIFT + T / B", "send to track / put it back"], ["SHIFT + V / E", "revert / export"], ["SHIFT + I / O", "INIT / open a file"], ["SHIFT + N / G", "the name / the tags"]] },
  { screen: "SEQUENCE", rows: [["SHIFT + V", "TRACKS / STEPS / PIANO ROLL"], ["1 .. 6", "a track"], ["CLICK", "pick a step (CMD / CTRL: add, SHIFT: a run)"],
    ["DOUBLE-CLICK / ALT", "a step on / off"], ["DRAG UP / DOWN", "the EDIT mode's value"], ["TAB, SHIFT + 1 .. =", "the EDIT mode (3 locks: any value)"],
    ["ARROWS", "the cursor (SHIFT: pick more)"], ["ENTER", "a step on / off"], ["[ ]  - =", "length, velocity"], [", .", "the page's first / last step"],
    ["A W S .. ;", "the keyboard (Z / X octave)"], ["DELETE / ESC", "clear / pick none"], ["SHIFT + L M N", "loop page, mute, names"],
    ["SHIFT + P R I", "patterns, read again, inspect"], ["SCROLL", "ROLL: pitch (SHIFT: time); TRACKS: time"], ["CMD + SCROLL", "zoom time (ALT: pitch)"],
    ["CMD + C / V / Z", "copy, paste, undo (SHIFT: redo)"]] },
  { screen: "MIX", rows: [["1 .. 6", "a track"], ["LEFT / RIGHT", "the value"], ["UP / DOWN", "turn it (SHIFT: big)"]] },
  { screen: "POOL", rows: [["ARROWS", "a place"], ["ENTER", "to the sounds (UP / DOWN, ENTER puts one there, ESC back)"], ["DELETE", "clear the place"],
    ["M", "move it (a place, ENTER)"], ["U", "who uses it"], ["/", "find a sound"], ["R", "read again"]] },
  { screen: "PROJECTS", rows: [["UP / DOWN", "a slot"], ["ENTER", "load it"], ["N", "new (an empty slot)"], ["R", "rename it"], ["C / M", "copy / move it (then 1..8)"],
    ["DELETE", "delete it (its name typed)"], ["P", "read its patterns"], ["B", "save the slot's project in this browser"],
    ["U", "send the browser's picked project to the slot (replaces it)"], ["SHIFT + UP / DOWN", "pick in this browser"],
    ["E / I", "export / import a .egprj file"]] },
  { screen: "CABINET", rows: [["B", "back up"], ["P", "presets only"], ["R", "restore a file"], ["K", "the kept backups"], ["I", "import sound files"],
    ["D / T", "where they go / the track"], ["S / C", "send / clear them"]] },
];
// the status line's hint: the screen's main keys
export const HINTS = {
  home: "1..6 TRACK · ENTER SOUND · S STEPS · SPACE PLAY · ? KEYS",
  library: "UP/DOWN · / FIND · ENTER EDIT · L LOAD · E EXPORT · ? KEYS",
  edit: "1..9 PAGE · ARROWS · SHIFT+M MOD · SHIFT+L LIVE · ? KEYS",
  seq: "SHIFT+V VIEW · CLICK PICK · DRAG ↑↓ VALUE · TAB MODE · ? KEYS",
  mix: "1..6 TRACK · ARROWS · SPACE PLAY · ? KEYS",
  pool: "ARROWS · ENTER SOUNDS · M MOVE · DEL CLEAR · ? KEYS",
  projects: "UP/DOWN · ENTER LOAD · N NEW · C COPY · ? KEYS",
  cabinet: "B BACK UP · R RESTORE · I IMPORT · S SEND · ? KEYS",
};
export const SCREENS = ["home", "library", "edit", "seq", "mix", "pool", "projects", "cabinet"];

export function mountKeys({ $, tab, current }) {
  const grid = $("help-grid");
  grid.textContent = "";
  for (const g of KEYS) {
    const sec = document.createElement("section"), h = document.createElement("h3"), dl = document.createElement("dl");
    h.textContent = g.screen;
    for (const [k, w] of g.rows) {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = k; dd.textContent = w;
      dl.append(dt, dd);
    }
    sec.append(h, dl);
    grid.append(sec);
  }
  const help = (open) => {
    $("help").hidden = !open;
    if (open) $("help-close").focus();
  };
  $("helpkey").addEventListener("click", () => help(true));
  $("help-close").addEventListener("click", () => help(false));
  const typing = (e) => e.target.closest && e.target.closest("input, select, textarea");
  document.addEventListener("keydown", (e) => {
    if (!$("help").hidden) { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); help(false); } return; }
    if (!$("boot").hidden || !$("title").hidden) return;
    const f = /^F([1-8])$/.exec(e.key);
    const alt = e.altKey && /^Digit([1-8])$/.exec(e.code);
    if ((f && !e.metaKey && !e.ctrlKey) || alt) {
      e.preventDefault();
      tab(SCREENS[Number((f || alt)[1]) - 1]);
      return;
    }
    if (typing(e) || e.metaKey || e.ctrlKey) return;
    if (e.key === "?") { e.preventDefault(); help(true); }
  });
  return { help, current };
}
