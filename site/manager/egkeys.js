// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Every key of the manager, in one table: HELP (?) shows it, and the screens' own handlers are the ones it names (this
// file handles the global ones: the screens, HELP). No key fights the browser's own (CMD + W, CMD + R, ..); F1..F8 are
// taken where the browser lets a page have them, ALT + 1..8 always.
//   KEYS: [{screen, rows: [[keys, what]]}]; mountKeys({ $, tab(name), current(), tabs }) -> { help(open) }
export const KEYS = [
  { screen: "EVERYWHERE", rows: [["F1 .. F8", "HOME LIBRARY SOUND SEQUENCE MIX POOL PROJECTS CABINET"], ["ALT + 1 .. 8", "the same, on any keyboard"],
    ["?", "this screen"], ["ESC", "close it, let go of what is held"], ["TAB", "the next control"]] },
  { screen: "HOME", rows: [["1 .. 6", "a track"], ["ENTER", "its sound in SOUND"], ["S", "its steps in SEQUENCE"], ["R", "read the FM-1 again"]] },
  { screen: "LIBRARY", rows: [["TAB", "the find box, the filters, a sound's keys"], ["ENTER", "on EDIT: the sound into SOUND"]] },
  { screen: "SOUND", rows: [["TAB", "the next value"], ["UP / DOWN", "turn it (SHIFT: fine)"], ["PAGE UP / DOWN", "a big step"],
    ["HOME / END", "its ends"], ["ENTER", "its list"], ["DELETE", "its default"], ["A W S .. ;", "play the track (Z / X the octave)"], ["ESC", "let go of a source"]] },
  { screen: "SEQUENCE", rows: [["LEFT / RIGHT", "the step (SHIFT: add steps)"], ["DELETE", "clear the steps"], ["[ ]", "length"], ["- =", "velocity"],
    ["PAGE UP / DOWN", "the pages shown"], ["Z / X", "the octave shown"], ["CMD + C / V", "copy / paste steps and their locks"],
    ["CMD + Z", "undo on the FM-1 (SHIFT: redo)"], ["CLICK", "a note; on a note: its step"], ["ALT + CLICK", "take a note away; clear a lock"]] },
  { screen: "MIX", rows: [["1 .. 6", "a track"], ["UP / DOWN", "the value under the cursor"], ["LEFT / RIGHT", "the next value"]] },
  { screen: "POOL", rows: [["ARROWS", "a place"], ["ENTER", "to the sounds (ENTER on one: put it there)"], ["DELETE", "clear the place"], ["M", "move it (then a place, ENTER)"],
    ["U", "who uses it"], ["/", "find a sound"], ["R", "read the pool again"]] },
  { screen: "PROJECTS", rows: [["UP / DOWN", "a slot"], ["ENTER", "load it"], ["N", "a new project (an empty slot)"], ["R", "rename it"], ["C", "copy it to a slot"],
    ["DELETE", "delete it (its name typed first)"]] },
  { screen: "CABINET", rows: [["TAB", "BACK UP, PRESETS ONLY, RESTORE, the kept backups, IMPORT"]] },
];
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
