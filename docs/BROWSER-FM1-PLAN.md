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
  reloads; backup and restore on it. Not yet: the unit's panel buttons on the page, a service worker for offline use.
- Phase 5: PROJECTS' IN THIS BROWSER box: SAVE HERE (a slot to a new library entry), SEND TO SLOT (backup to CABINET,
  presets found or added, the store written back), EXPORT / IMPORT `.egprj` (`docs/PROJECT-FORMAT.md`), RENAME,
  FORGET. Proven in the browser on the virtual FM-1, and end to end against the simulated unit in the Node tests;
  not yet on the real FM-1.

## Decided (2026-11-15)
- The virtual FM-1 is the Bluetooth package (your unit's layout).
- The browser keeps an unlimited library; FM-1 -> library adds, library -> FM-1 replaces the slot you pick.
- The project file is portable (a VST or native app later).

## Open questions
- Should the manager open on the virtual FM-1 by default when no unit is plugged in?
- Solo saved with the pattern (as mute is) or live only (as the unit's double tap is today)?
