# EVILGENIUS release notes

The firmware releases for the M-VAVE FM-1, newest first, written for players. Install them from
[the install page](https://quixotic7.github.io/evilgenius/install/) and report what you find in
[the issues](https://github.com/Quixotic7/evilgenius/issues). `firmware/release.py` turns the "Unreleased" section
into the next release: its text becomes the release's notes on the install page and on GitHub.

EVILGENIUS began as FIZZ 0.12.0-beta.17 with another engine and another face; FIZZ's own history is in
[its repository](https://github.com/Quixotic7/FIZZ/blob/master/CHANGELOG.md).

## Unreleased

<!-- The next release's notes, for testers, in plain language. firmware/release.py moves them. -->

- **The manager edits sounds** ([the manager](https://quixotic7.github.io/evilgenius/manager/), Chrome or Edge over
  USB). LIBRARY lists MY PRESETS and the factory's, found by name and tag: EDIT, LOAD ON FM-1 (the unit's own browser
  opens on it), EXPORT, and for MY PRESETS RENAME, TAGS, UP / DOWN and DELETE. EDIT shows every value of a sound
  (read from a track, a preset, a file or INIT): drag, scroll or type a value; drag LFO 1..3 or a modulation source
  onto a value to route it; LIVE changes the track as you go; SEND TO TRACK / PUT TRACK BACK try a sound on a track
  without keeping it; SAVE AS NEW, REPLACE, REVERT, EXPORT; the computer's keys play the track. Works with this
  firmware and the releases before it (0.1.0 and later).
- **Projects keep their names again.** Since the five rooms came in, the unit could not read a project's header back
  (at power-on, at a project load): the project lost its name, and the settings kept there (the tracks' level, pan,
  sends, room sends and names) were not read from it either. The headers were written right all along, so what a
  project last saved is read again now.
- **The manager is a full-screen app now**, loading as a program on a C64 would. F1..F6 (or ALT + 1..6) switch
  between HOME, LIBRARY, SOUND, SEQUENCE, MIX and CABINET, and ? lists every key. HOME shows the SID-chip brain, the
  picked track's sound as the chip's three voices and the open pattern's six tracks. SOUND draws each section as the
  unit does: the waves, the envelopes, the filter's curve, the LFOs. MIX changes each track's pan, delay, reverb and
  chorus live.
- **The manager edits the sequence** (with this firmware): SEQUENCE is a piano roll of the open pattern, with
  velocity, any parameter lock, the sound lock, chance and condition in lanes below it, every field of a step, the
  track's settings, copy and paste, and undo on the unit. PATTERNS shows the project's 64 patterns; click one to go
  there.
- **The manager fits the window and works from the keyboard.** Every screen shows all of itself without scrolling,
  from 1024 x 768 up: SOUND shows the unit's pages one at a time (1..9), LIBRARY is a list with the picked sound
  beside it. Every action has a key (? lists them; the status line shows the screen's main ones). PLAY / STOP and
  REC are in the top bar (SPACE, SHIFT + SPACE), with the pattern and its tempo; they press the unit's own buttons.
- **SEQUENCE in three views**: TRACKS (the six tracks a row each, lined up in time, scroll and zoom), STEPS (the
  track's eight pages of big steps, each page's [ ] start and end dragged, a keyboard under them for the steps'
  notes and chords) and PIANO ROLL (scroll and zoom in pitch and time, three lanes of any value). In all three a
  click picks a step (CMD / CTRL adds, SHIFT a run), a double-click or ALT + click makes or takes one away, and a
  drag up or down changes the EDIT mode's value: NOTE, VEL, LEN, MICRO, RATCH, CHANCE, COND, FUNC, SOUND or any of
  three locks. Steps show their note or chord name; the track's RATE is in the toolbar.
- **The manager's POOL, PROJECTS and CABINET** (F6, F7, F8). POOL shows the project's 128 pool places: put a sound
  in a place, CLEAR, MOVE (the steps follow), USED BY, SORT BY TAG and CLEAR UNUSED. PROJECTS: LOAD, NEW, RENAME, COPY
  TO, MOVE TO and DELETE a project, and which of its 64 patterns hold steps. CABINET shows the store in use, keeps your
  last 12 backups in the browser to restore or save again, saves PRESETS ONLY, and imports sounds one by one into MY
  PRESETS, the pool or a track, without rewriting the store. LIBRARY says who uses a preset (USED BY).
- **Undo works after a full lock pool is cleared** on the Bluetooth firmware; every edit after it had no undo before.
## 0.1.1 (2026-11-15)

- **The same firmware as 0.1.0**, released again so that RemoteFM1 takes it: its nightly update read 0.1.0 as older
  than 0.1.0-beta.3 and kept the beta. RemoteFM1 picks up `evilgenius-0.1.1.rfm1` at its next nightly update.

## 0.1.0 (2026-11-15)

- **The first stable release.** The same firmware as 0.1.0-beta.4, now out of beta.
- **EVILGENIUS in RemoteFM1.** Each release now carries `evilgenius-VERSION.rfm1`, and RemoteFM1 (the app,
  remotefm1.com and FM1VST) picks it up at its next nightly update. It plays in RemoteFM1's on-screen FM-1 in
  EVILGENIUS's own colours: a deep indigo faceplate, violet keys, maroon knobs and green LEDs, with no background
  picture.

## 0.1.0-beta.4 (2026-11-15)

- **The mixer's knobs work as on the Home views**: PRESETS chooses the track and ALGORITHM the step (a knob turned
  with a step chosen locks it on that step). PRESETS no longer mutes; hold a track's black key to mute it. On the
  FX MIX page PRESETS is still TV's send.
- **An LFO's MULT turns in the order of its speed**: FREE, then 1/128, 1/64, 1/32 .. 8 BAR. 1/64 and 1/128 came
  after 8 BAR. Sounds you saved keep their setting.

## 0.1.0-beta.3 (2026-11-14)

- **The start screen runs smoothly: 29 frames a second on the unit, from 11.** It drew more than the unit's frame
  holds, so the unit drew it the slow way, and its clock stepped 16 times a second: the picture stuttered and the
  line of text crawled four pixels a step. Now only the letters on screen are drawn, the machine is 645 pieces
  instead of 1,091, and the screen steps 30 times a second.
- **Every pixel screen draws faster.** The unit writes the screens' rectangles straight into its frame and reads its
  drawing list a word at a time (it was calling out to the flash six thousand times a frame). The start screen's
  drawing went from 66 ms a frame to 12.
- **The Evil Genius laughs without a box round its face**, and the liquid in its jar boils: bubbles rise at the
  brain's sides and the surface ripples, on the start screen, on SENDS and in the scenes.
- **LFO MULT goes on to 1/64 and 1/128** (after 8 BAR in the list, so your sounds keep their settings). With an ARP
  wave a note is a division: at 120 BPM a 1/64 is 32 notes a second and a 1/128 is 64, past the PAL frame's 50.

## 0.1.0-beta.2 (2026-11-14)

- **Notes start on time.** A note on a voice that had gone silent could start 33 ms late (a 32nd note at 124 BPM), or
  with its click on time and its body late: the emulated SID chip's own ADSR delay, which C64 players work round
  with a hard restart. A note on a silent voice, and one after a hard restart (HR over 0), now starts at once; kicks
  land on the beat. A note struck over a sounding voice with HR at 0 is as the chip plays it.
- **The Evil Genius has a face.** The mascot is a SID chip's brain in a jar of green liquid on its computer, from the
  owner's own pictures. The start screen is its hall: the agent runs and somersaults two robots while it throws
  bolts at the floor behind him; it laughs, EVIL GENIUS drops in under the jar, and then the name melts away, a
  column at a time. It is on the effects' SENDS page and in the scenes too, and small wherever the villain was.
- **A new demo: one song in four patterns.** Dark minimal techno at 124 BPM: A01 INTRO, A02 GROOVE, A03 BUILD (a
  filter sweep in step locks, a snare roll in ratchets, a noise riser, a lift in fifths) and A04 DROP, with the
  villain's EVIL and GENIUS. The drop's effects are PAL arpeggios locked a step on the KEYS track: a chord buzzing
  at 50 Hz, octave runs, falls; its lead's pulse flickers an octave every frame. Play it as a song: hold SEQ and press a pattern's key, and it starts when the playing one ends. The demo
  comes with its own mix (levels, echo and room sends). Projects you saved keep what they have.
- **USB HOST** (FIZZ's, 2026-11-14): the FM-1's USB port can be the host of a USB-MIDI keyboard, controller or synth,
  with no computer. Hold HOME for the settings, turn SELECT to page 3, KNOB 1 to ON. The device then plays
  EVILGENIUS as MIDI from a computer does (notes, CCs, clock and transport), and MIDI OUT goes to it. STATUS says
  WAITING, CONNECTED or NOT MIDI. The FM-1 gives the port no power: use a powered hub or a powered USB-C OTG adapter.
  While it is on there is no computer on the port (no USB audio, no manager, no updates over USB); turn it OFF or
  switch the unit off and on: it is never saved. BLUETOOTH is page 4 now.
- The start, update and crash screens are in the small face (the room USB HOST needed).

- **72 more factory sounds**, 95 in all: nine basses, eleven leads, eleven keys and plucks, eight pads, ten drums
  (made to be played at C4), eleven effects and twelve VOX sounds, after the first set and the kit. Each loads with
  sends chosen for it. The demo's pool and your saved projects keep the sounds they had.
- **PAL arpeggios.** An LFO's WAVE goes on past RAMP to nine ARP waves (OCT, 5TH, MAJ, MIN, SUS, 7, MI7, MA7, DIM):
  with DEST on PITCH the one voice plays the chord's notes one after another, as C64 music does, so a chord costs one
  voice. SPEED is a note's length in PAL frames (127: a note a frame, 50 Hz), or MULT makes it a division of the
  tempo; DEPTH over 0 runs up, under 0 down, and further out covers two and three octaves. PITCH 1..3 arpeggiates
  one oscillator over the others. Thirteen of the new sounds use it (MAJOR 50HZ, OCTAVE RUN, LIFT UP ..).
- WOBBLE no longer clips at full velocity (its LEVEL is 85).

## 0.1.0-beta.1 (2026-11-14)

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
- **The manager** (the site's MANAGER page) backs the unit's store up to a file and restores it, and exports and
  imports MY PRESETS, over USB from Chrome or Edge.
- **One package, with Bluetooth**: USB and Bluetooth MIDI, USB audio to the computer, four projects, 128 presets of
  your own. The step view draws in 28 ms a frame on the unit with a pattern playing.

Known:

- FIZZ's new 4 x 4 grid for the PIANO ROLL's COND, TRIG, FUNC, SLIDE and SOUND modes is not in: those modes draw as
  lanes, as before.
- ECHO's longest time is 0.575 s and its repeats are 8-bit; ROOM's longest pre-delay is 23 ms (what fits the unit).
