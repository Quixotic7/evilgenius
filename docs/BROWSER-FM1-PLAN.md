# The manager as an FM-1 in the browser: the plan

2026-11-15. The owner's brief: solo and a moving playhead; a better mixer and FX page; MIDI FX and the tools in the
editor; and the whole thing usable offline: make a jam on the computer, keep projects in the browser or export them,
then send them to the FM-1. "Not a sidecar manager, but a fully working version of the firmware that runs in the
browser and uses the computer's interface."

## The idea: one manager, two FM-1s

The manager already edits the unit through EvilGenius's own SysEx (`core/app/fizz_sx.c`). The browser can run the
**same firmware** too: `firmware/build.py --web` compiles the whole app (sequencer, sound, store, screen, keys) to
WebAssembly, as `site/try/` does. So:

- **The real FM-1** over USB (Web MIDI), as today.
- **The virtual FM-1**: the firmware's WebAssembly in the page, its sound in an AudioWorklet, its MIDI in and out
  (`web_midi_in`, `web_out_pkts`) behind a Web MIDI look-alike (as `egsim.js` already is). The manager's link,
  every screen and every command work on it unchanged, with no unit plugged in.

Every feature below is then built once, in the firmware's commands and the manager's screens, and works on both.
Nothing is emulated in JavaScript: the virtual FM-1 *is* the firmware, so its jam sounds as the unit plays it.

## What exists, what is missing

| Wanted | The firmware has it | The manager can reach it | Missing |
|---|---|---|---|
| Solo | yes (`seq.solo`, the MIX page's double tap) | no | a TRACK SET field (SOLO) |
| Playhead | yes (each track's step) | no | the play steps in STATUS (or a stream) |
| Mixer | level, pan, sends, the five rooms, DRY / WET (`mix.h`, the project header) | pan and three sends (PARAM) | LEVEL, the rooms (ids 124..128 are past PARAM's 7 bits), DRY |
| FX | DELAY, DELAY 2, REVERB, REVERB 2, CHORUS, MASTER, ROUTING (`qd_fx_get` / `qd_fx_set`, the settings record) | no | an FX GET / SET |
| MIDI FX | 5 groups x 8 slots x 12 values, 10 types (`seq/mfx.h`), each track's group | no | a read / write of the groups; the track's group in TRACK SET |
| Tools | ROTATE, EUCLID, GRIDS, HUMANIZE, QUANTIZE, CLIP (`ctl_tools.c`) | no | a TOOL command running the firmware's own tool |
| Offline | `site/try` runs the firmware | no | the virtual FM-1 in the manager; its store kept in the browser |
| Projects to the FM-1 | the store's records (`egstore.js` reads and writes them) | whole stores only (RESTORE) | a project's records moved between stores |

## The flash, first

The Bluetooth package (your FM-1) has about **2 KB** of app slot left after phases 1-3 of the pattern SysEx. The
firmware side of this plan needs roughly 1.5-3 KB. So phase 1 starts by measuring and, if needed, moving
`fizz_sx.c`'s handlers (main loop only, `FZ_COLD`) into the second flash blob, as `build.py` already does for other
main-loop code (BLE_X2_FN). The USB package has ~6 KB free. Each phase is measured on both before it is installed.

## Phases

### 1. Live state: playhead and solo (small firmware change)
- STATUS gains each track's play step (6 bytes) and the solo mask. The manager polls it about 15 times a second while
  the unit plays (USB MIDI carries it easily), and draws the playhead in TRACKS, STEPS (the playing step lit) and
  PIANO ROLL, and HOME.
- TRACK SET gains SOLO (a track's bit in `seq.solo`); TRACKS, SEQUENCE's track buttons and MIX get S beside M.
- PARAM gains a 14-bit id form, so the rooms (124..128) are reachable.

### 2. MIXER and FX (firmware: FX GET / SET, the header's mix in a reply)
- One command reads the six tracks' whole mix (LEVEL, PAN, CHORUS, DELAY, REVERB, the five rooms, DRY) and the FX
  parameters; one sets an FX parameter (`qd_fx_set`, as the unit's knobs).
- The MIX screen becomes a mixing desk: six channel strips (fader, pan, the three sends, the five room sends,
  DRY / WET, M / S, a meter if the firmware can spare one), and an FX section with every page the unit has: DELAY,
  REVERB, CHORUS with their second pages, MASTER (the filter), ROUTING (PARALLEL / CHAIN). Pictures where the unit has
  them. The value names and ranges generated from the core (`tools/gen_values.c --fx`), as egvalues.js is.

### 3. MIDI FX and TOOLS (firmware: MFX GET / SET, TOOL)
- MIDI FX: the project's five groups as chains of eight slots, each slot's type and twelve values (ARP's rate, mode,
  octaves .. as the unit names them, generated from `seq/mfx.h`), each track's group; edited live.
- TOOLS: a TOOL command runs the firmware's own tool on a scope (PAGE, PATTERN, the picked steps) with its values,
  as one undo level, so ROTATE, EUCLID, GRIDS, HUMANIZE and QUANTIZE give exactly what the unit gives. The manager
  shows each tool's values and a preview (the steps drawn before you apply).

### 4. The virtual FM-1 (no change to the unit; a small one to the browser build)
- **The Bluetooth package is the target, in the browser too** (the owner, 2026-11-15): the virtual FM-1 is built with
  the unit's own layout (QD_PKG_BLE: 4 project slots, 128 MY presets, the same store), so what plays in the browser
  plays the same on the unit. (`build.py --web` builds the USB package today; the host tests already build the
  Bluetooth profile at device sizes, so a web build of it is the first thing to prove.)
- The manager loads the firmware's WebAssembly on a VIRTUAL switch, or when no FM-1 is plugged in: sound through an
  AudioWorklet, the computer's keyboard and the manager's screens playing it, the unit's own screen and buttons in a
  panel (from `site/try`). Its MIDI in and out sit behind a Web MIDI look-alike, so the manager's link, every screen
  and every command work on it as on the unit.
- The browser build gains an export of its data area (the store) and a write counter, so the page can keep the
  virtual unit's store and give it back before boot.
- Offline: a service worker caches the page and the WebAssembly (an installable app).

### 5. The project library and sync (no firmware change)
The owner's model: **make a project on the FM-1 or in the browser, and move it either way at any time.**
- **THE LIBRARY: unlimited projects in the browser** (IndexedDB), each a project file (below) with its name, when it
  was saved and where it came from. The FM-1 has 4 slots; the library has no limit.
- **FM-1 -> LIBRARY: always a new entry**, nothing in the library overwritten. The unit's store is read (FLUSH first,
  so the project worked on is in it), the slot's records taken out with the MY PRESETS its pool uses.
- **LIBRARY -> FM-1: onto a slot you pick, which is replaced** ("flash over an existing project, no problem"). The
  unit's store is read and kept as a backup in the browser first; the slot's records are replaced with the project's;
  the presets its pool uses are added to MY PRESETS if the unit does not have them (the same sound already there: its
  id used), the pool's references rewritten to the ids they get; the store written back (RESTORE's path, checked
  first as IMPORT was). A project open on the unit is saved first; the slot replaced while it is the one worked on is
  loaded again after.
- **The virtual FM-1 is the same:** its 4 slots, filled from and saved to the library the same way, only faster (its
  store is in the page).
- EXPORT / IMPORT a library project as a file, to keep, to share, or for another tool.

### The project file (`.egprj`): portable, for a VST or a native app later
One JSON file, written and read by any tool, that a VST or native app linking EvilGenius's core can load as the unit
does, because it carries the store's own records, not a translation:
- `format: "evilgenius-project"`, `version`, the store's formats it was made with (the settings record's 'G' version,
  each record kind's version byte), `name`, `saved`, `from` (an FM-1's id and slot, the browser, a tool);
- `records`: the project's records exactly as the store keeps them, each `{kind, index, data (base64)}`: the header
  (`H`: name, key, record settings, the tracks' mix and names), the 64 patterns (`P`: steps, locks, track settings),
  the pool (`S`: a sound, or `R`: a MY preset's id), the MIDI FX groups;
- `presets`: every MY preset the pool refers to, whole (`{id, name, tags, patch}`, as `.egsnd`), so the project
  carries its sounds wherever it goes;
- a summary for lists (`tracks`: names; `patterns`: which hold steps) that a reader may ignore.
The format is written down in `docs/PROJECT-FORMAT.md` with the first build, and the tests read the files the
core's own tests write, so the two never drift.

### Later: a VST or a native app
The project file and the virtual FM-1 are the two halves of it: the core already builds for the host (`--host`) and
the browser; a plug-in or app links the same core, opens `.egprj` files, and syncs with the FM-1 over USB MIDI the way
the manager does.

## Where it stands (2026-11-15)
- Phase 4: the virtual FM-1 runs in the manager (VIRTUAL): the Bluetooth package's firmware (`site/manager/vfm1/`,
  `firmware/build.py --web --ble`), its sound, its SysEx, its screen on HOME; its store kept in this browser across
  reloads; backup and restore on it. THE PANEL (F9, `egpanel.js`): its screen, knobs, buttons and keys with their
  lights, played from the computer's keyboard. Offline: `sw.js` keeps the page, its modules and `vfm1/` (the network
  first, the kept copy when there is none). The tests hold `vfm1/build.json` against the files and `sw.js`'s list
  against the folder. Not yet: a manifest and an icon (an installable app); offline checked by the tests' own network
  and by the worker's cache in the browser, not with the network really off.
- Phase 5: PROJECTS' IN THIS BROWSER box: SAVE HERE (a slot to a new library entry), SEND TO SLOT (backup to CABINET,
  presets found or added, the store written back), EXPORT / IMPORT `.egprj` (`docs/PROJECT-FORMAT.md`), RENAME,
  FORGET. Proven in the browser on the virtual FM-1, and end to end against the simulated unit in the Node tests;
  not yet on the real FM-1.

- **The manager is an FM-1 itself (the owner, 2026-11-15: "a real standalone browser app").** The firmware starts in
  the page with the page: no VIRTUAL, no connect, no reads. The screens follow it (what its own panel changes shows
  within a second: HOME, MIX, POOL, PROJECTS, the transport, SEQUENCE, SOUND). CONNECT FM-1 brings a unit on USB
  beside it: PROJECTS shows its slots in a box of its own (GET: its project into the library; SEND: the library's
  onto its slot), and WORK ON FM-1 (F10) puts every screen on the unit, as the manager was before. Checked in the
  browser with the simulated unit (which refuses a restore, so SEND to the second FM-1 went as far as the write);
  not on the real FM-1.
- **The hardware as the panel** (`egremote.js`): an FM-1 running RemoteFM1 plays the FM-1 in the page. CONNECT finds
  it by RemoteFM1's HELLO, takes a session, and its keys, buttons, knobs and MASTER go in as the page's panel does;
  the page's lights and screen go out (LEDS, TILES). Written from RemoteFM1's protocol document; proven against a
  unit made in the tests (the tiles through a decoder written from the same document), not on a real RemoteFM1 yet.
  Over Bluetooth: the panel and the lights, no screen for now.

## EVILGENIUS itself as the panel: REMOTE MODE (built 2026-11-15, on the owner's unit 2026-11-16)
The seamless round: play on the go on EVILGENIUS; at the computer plug in, GET the project, play it in the browser
**with the same unit as the controller**; SEND it back, unplug.
- **The firmware** (`firmware/app/app.c`, `fz_rm_*`): it answers RemoteFM1's HELLO (as EVILGENIUS, protocol 2, no
  screen size and no caps, so a host sends no TILES and RemoteFM1's own hosts do not mistake it), SESSION (ACK,
  PANEL_R), PANEL_REQ, and takes LEDS. While a session lasts the keys, buttons and knobs go out as RemoteFM1 sends
  them (the default panel's ids, whatever the unit's calibration), MASTER as CC 7 / 39, PANEL_R twice a second; the
  app hears nothing of the panel (what it held is let go first), its output is silent (the gain glided to 0; the
  engine runs on), the screen says REMOTE MODE, the lights are the host's. SESSION 0, the keepalive, or a restart end
  it; the screen is drawn again whole. EVILGENIUS's own SysEx goes on meanwhile, so GET and SEND work in a session
  (a SEND restarts the unit: the session ends).
- **No screen on the unit**: TILES need a decoder and a shadow frame buffer the unit has no room for; the computer
  shows the screen.
- **Tested** in the host simulator (`firmware/app/tests/remote.txt`: the session, each message's bytes, the lights,
  the app deaf meanwhile, the end, the keepalive) and the page's side against a unit made in the Node tests. The
  other simulator scripts fail as they did before it (FIZZ's, not ported: same counts with and without).
- **Flash, measured** (the Bluetooth package, a clean tree at 42b7e20 + app.c): the app slot 580,824 of 581,564 B
  (**740 free**; 2,788 before: REMOTE MODE costs 2,048), RAM 368 B free (64 used), the second blob 5,720 free. So it
  fits, but phases 1-3 then need room made first (REMOTE MODE's cold functions to the second blob, or phase 1's
  handlers there as planned).
- **The page**: CONNECT finds that the unit has REMOTE MODE; REMOTE MODE (ALT + P) takes and gives back the session,
  sharing the port with the unit's link.
- **On the unit (2026-11-16, FM-1_4500, the owner's go-ahead)**: installed; HELLO, SESSION, PANEL_R every half
  second, LEDS, the end all answered over USB (a script with mido). The store read before and after: both projects'
  records the same (one 512-byte page of the store rewritten at the start, as at any start). Found there: a
  RemoteFM1 app on the computer sends HELLO to every FM-1 port once a second; it does not take EVILGENIUS (the name),
  but its HELLOs put off the PANEL_Rs and would have kept a dead session alive, so a HELLO no longer counts for
  either. Not tried yet: a hand on the unit's keys with the page.
- **The owner tried it (2026-11-16): it connects and the unit plays the page's FM-1.** His calls, built the same day:
  the name is REMOTE MODE; the unit's screen for it in EVILGENIUS's own pixels (the pixel kit's glyphs, 120 x 120 at
  2x, drawn straight to the panel: `fz_rm_screen`; +480 B, the slot 260 B free, built, awaiting the go-ahead to
  install); in the page **the FM-1's screen docked at the top left** above the screens, the top bar and the status
  line beside it, its size dragged or ALT + [ ] (`egpanel.js mountDock`; `?dock` shows it with no unit); and **the
  manager's screens follow the unit's page keys** (the browser build's `eg_web_view`, in each frame; `egremote.js
  screenOf`): MIX and FX open MIX, EDIT SOUND on the selected track, SEQ / the tools / OVERVIEW SEQUENCE, PRESETS'
  browser LIBRARY, the projects PROJECTS, HOME HOME. The knobs then change on the unit's page what the manager's
  screen shows, and the screen follows within a second. Not there yet: the manager's own pages for FX, MIDI FX and
  the track settings (phases 2 and 3), and SOUND following the unit's editor page by page.
- **The owner's second round (2026-11-16): "fully interconnected and built together, not some tacked on feature."**
  - The screen in **a band of its own at the very top**, above the tabs. Beside it THE STRIP: where the unit is (its
    page's name), the status line and the top bar's keys, and the unit's own LABELS (`core/app/view_labels.c`): what
    each of the seven knobs, eleven black keys and fourteen buttons does there now, each a control (scroll a knob,
    press a key). At 1024 x 768 every screen but CABINET (already over) still fits below it.
  - **Every page of the unit has a screen here** (`egremote.js screenOf`, held by a test over every menu and view):
    STEPS and EDIT open SEQUENCE in STEPS, the PIANO ROLL its PIANO ROLL, OVERVIEW its TRACKS, on the selected track;
    MIX MIX; EDIT SOUND, on the page the unit's black keys picked (the view carries the page's first value id); the
    browser LIBRARY; the projects PROJECTS; GEEK OUT HOME. A page with no screen of its own yet (MIDI FX, TOOLS,
    PATTERNS, EFFECTS, the settings menus, the keyboard) opens **THE FM-1 (F9)**, named after it: the unit's page
    with every control's job written on it (the old F9 overlay, now a screen), with keys to MIDI FX, TOOLS, EFFECTS.
  - **The other way** (`GOTO`): a screen picked in the manager (MIX, SOUND, SEQUENCE; MIDI FX, TOOLS, EFFECTS from
    THE FM-1) takes the unit to its page, its button tapped until the view says it is there.
  - The unit's REMOTE MODE screen on black (built: the slot 276 B free; awaiting the go-ahead to install).
  - The screen then moved out of the manager's frame: centred above it on the border's colour, a yellow frame (the
    owner's mock-up); THE STRIP is the manager's first row.
  - **MIDI FX (F9) and TOOLS (F10) have their own screens** (`egmfx.js`, `egtools.js`), on the FM-1 in the browser:
    the browser build exports `eg_web_mfx` and `eg_web_tools` (`fz_port.c`, PLAT_WEB only: no flash of the unit's),
    called through the worklet (`vu.call`). MIDI FX: the tracks' groups, a group's eight slots, the picked slot's
    every value on every page and the ARP's lanes, each name, text, range and step the firmware's own
    (`qd_mfx_par`, `qd_mfx_value_text`); a change is written as the unit's knob writes it, and the slot picked is
    the one the unit's screen shows. TOOLS: every key and turn goes to the unit's own tool (`qd_tools_black`,
    `_knob`, `_oct_click`), which changes the pattern live; the screen shows the tool, its values, the page's steps
    before and after, KEEP and UNDO. Both ask three times a second while shown, so the unit's knobs move them.
    Tried in the browser: an ARP put in a slot and its RATE turned; EUCLID with 9 hits previewed and undone.
    On a unit worked on over USB these two need phase 3's SysEx; until then its own page (THE FM-1).
  - Still owed for "everything matches a panel": EFFECTS' page in MIX (phase 2), PATTERNS, the track, record and
    global settings (THE FM-1 shows them meanwhile), SOUND's value picked by the unit's knobs lit, TOOLS' richer
    pictures (GRIDS' map, the timing lanes of HUMANIZE and QUANTIZE, STRETCH's before and after).
- **Not yet**: over Bluetooth (the route is carried, untested);
  the round in one key (CONNECT: take the project worked on into the browser FM-1 and the session; DISCONNECT: send
  it back to its slot): which browser slot it may replace is the owner's call.

## Decided (2026-11-15)
- The virtual FM-1 is the Bluetooth package (your unit's layout).
- The browser keeps an unlimited library; FM-1 -> library adds, library -> FM-1 replaces the slot you pick.
- The project file is portable (a VST or native app later).
- The manager opens on the FM-1 in the page; an FM-1 on USB is where projects go to and come from, or its panel.

## Open questions
- Solo saved with the pattern (as mute is) or live only (as the unit's double tap is today)?
