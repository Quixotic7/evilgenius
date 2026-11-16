// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The manager loads as a program on a C64 would: the BASIC screen in its blue, LOAD"MANAGER",8,1, the border's stripes
// while the bytes come (the tape loaders' raster bars), then the title: the SID-chip brain in its jar, EVIL GENIUS,
// PRESS SPACE. EVILGENIUS's own words throughout (a homage: no other company's name or logo). Any key or a click skips
// it; it plays once a session (sessionStorage) and not at all with ?sim (the tests) or reduced motion's short form.
//   await runBoot({ $, units: () => [ids of the FM-1s found, or none] })
const LINES = [
  "    **** EVIL GENIUS SID OS V2 ****",
  " 64K RAM SYSTEM  ONE SID 6581  38911 EVIL BYTES FREE",
  "",
  "READY.",
  'LOAD"MANAGER",8,1',
  "",
  "SEARCHING FOR MANAGER",
  "LOADING",
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runBoot({ $, sim = false }) {
  let seen = false;
  try { seen = sessionStorage.getItem("eg-booted") === "1"; } catch (_) { /* (no storage: play it) */ }
  if (seen || sim) return;
  try { sessionStorage.setItem("eg-booted", "1"); } catch (_) { /* (none) */ }
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const boot = $("boot"), title = $("title"), lines = $("boot-lines");
  let skip = false;
  const go = () => { skip = true; };
  const keys = (e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); go(); } };
  document.addEventListener("keydown", keys, true);
  boot.addEventListener("click", go);
  boot.hidden = false;
  const step = still ? 0 : 1;
  for (const l of LINES) {
    if (skip) break;
    const p = document.createElement("p");
    p.textContent = l;
    lines.append(p);
    await wait(step * (l.startsWith("LOAD") ? 420 : l ? 160 : 60));
  }
  const ready = document.createElement("p");
  ready.innerHTML = 'READY.<br>RUN <span class="cur"></span>';
  lines.append(ready);
  if (!skip) await wait(step * 500);
  boot.hidden = true;
  title.hidden = false;
  const tgo = $("title-go");
  tgo.addEventListener("click", go);
  title.addEventListener("click", go);
  skip = false;
  tgo.focus();
  for (let t = 0; t < (still ? 20 : 60) && !skip; t++) await wait(100);   // (six seconds, or a key)
  title.hidden = true;
  document.removeEventListener("keydown", keys, true);
}
