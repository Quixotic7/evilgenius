# EVILGENIUS release notes

The firmware releases for the M-VAVE FM-1, newest first, written for players. Install them from
[the install page](https://quixotic7.github.io/evilgenius/install/) and report what you find in
[the issues](https://github.com/Quixotic7/evilgenius/issues). `firmware/release.py` turns the "Unreleased" section
into the next release: its text becomes the release's notes on the install page and on GitHub.

EVILGENIUS began as FIZZ 0.12.0-beta.17 with another engine and another face; FIZZ's own history is in
[its repository](https://github.com/Quixotic7/FIZZ/blob/master/CHANGELOG.md).

## Unreleased

<!-- The next release's notes, for testers, in plain language. firmware/release.py moves them. -->

The first release. EVILGENIUS is a six-track SID groovebox that talks: FIZZ's sequencer and controls, a C64 SID for
every voice, SAM for the words, and the screen of a C64 game about a villain's tower.

- **SID voices.** Each note is a SID chip: three oscillators (triangle, saw, pulse, noise and their mixes), pulse
  width, ring modulation and sync, three envelopes, an LFO, and the chip's filter with its eight modes and its routing.
  Eight voices across the FM-1's two cores.
- **It talks.** VOX sounds speak. SAM renders each word on the unit when a sound or a step first needs it, and the
  word plays as 4-bit samples through the SID's volume register, as C64 games did. WORD picks one of the 54 it comes
  with, SAY speaks what you type; a word is trimmed, looped and pitched like a sample, and with the filter's ROUTE on
  V it goes through the SID's filter.
- **Step locks.** Hold a step (or select several) and turn a knob: that step keeps its own sound, word, level, pan
  or effect send. Per step too: chance, conditions, ratchets, micro-timing, slides and functions.
- **The room.** The EDIT view at rest is a room of the tower over the page's steps: a note is a platform at its
  pitch, the agent runs the playhead, a locked step posts a robot.
- **The FX tower.** Eight effects, a floor each, the lift at the left: CHORUS, ECHO, ROOM, CRUSH, ROBOT (a ring
  modulator), WARP, GLITCH and TV. Every track has its own send into each one, on the mixer's SENDS and FX MIX pages
  and on the effects' own first pages, and every send locks on a step.
- **The villain speaks** when you clear, copy, paste or ride the lift. HOME held, page 2: **VOICE** is STOPPED (only
  while nothing plays, the default), ALWAYS or OFF, and **VOICE LEVEL** is how loud.
- **SEQ and SAVE are page buttons** (FIZZ's, 2026-11-14). SEQ clicks go round TOOLS, PATTERNS and the PIANO ROLL;
  holding SEQ is a quick peek at the patterns. SAVE clicks turn between SAVE PRESET and PROJECT; **hold SAVE** half a
  second to save the project now (a green tick: PROJECT SAVED), and F2 saves on either page. HOME's views are STEPS,
  EDIT and GEEK OUT.
- **Copy, cut and paste whole patterns** on PATTERNS: F1 + a pattern copies it and every other pattern you press
  gets it; F2 + a pattern picks it up and drops it on the next one you press.
- **Waking the unit does nothing else**: the button or knob that wakes it from the title screen only wakes it.
- **OVERVIEW (SEL) is easy to read**: a step is a solid bar in its track's colour on black, an empty step only its
  floor. (The cells were the C64's blue, which the red and light blue tracks sank into.)
- **One package, with Bluetooth**: USB and Bluetooth MIDI, USB audio to the computer, four projects, 128 presets of
  your own. The step view draws in 28 ms a frame on the unit with a pattern playing.

Known:

- FIZZ's new 4 x 4 grid for the PIANO ROLL's COND, TRIG, FUNC, SLIDE and SOUND modes is not in: those modes draw as
  lanes, as before.
- ECHO's longest time is 0.575 s and its repeats are 8-bit; ROOM's longest pre-delay is 23 ms (what fits the unit).
