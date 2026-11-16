# Editing sequences from the manager: the firmware side (plan, 2026-11-15)

The manager's mockup (the design canvas "EVILGENIUS Manager: C64 webapp", boards 05 SEQUENCE and 06 STEP LOCKS) edits
a pattern's steps in a piano roll and locks any value on any steps. Today the manager can only read the whole store
(FZBR) and write it back whole (FZSR, the restore: stopped, a minute, the unit restarts). This plan adds the commands
that let it read and edit the steps of the pattern on the unit, live, the way the unit's own panel does: each change
small, immediate, playable while the pattern plays, and undone with the unit's SHIFT + F1.

Phases 1 to 3 are built and tested on the host and in the manager (the SEQUENCE tab); 1 and 2 on the unit too; phase 4 is not. The numbers below come from the code as of `5a984fd` (the manager) and the working tree's core.

## What the core already has (no new model code)

| need | the core's own | where |
| --- | --- | --- |
| a step's fields, each clamped, its override bit kept | `qd_step_set_trig / notes / note / slots / vel / len / micro / ratchet / cond / chance / sound / strum / func / mfx` | core/seq/pattern.h |
| a lock set, read, cleared (the pool full: `QD_EFULL`) | `qd_lock_set / get / clear / count`, `qd_locks(p, t, s, &n)` (sorted by id) | pattern.h |
| a run of steps with their locks, out and back in | `qd_steps_get / qd_steps_put` | pattern.h |
| a step's bytes as the store keeps them (20 bytes) | `qd_step_wire / qd_step_unwire` (`QD_STEP_WIRE`) | pattern.h |
| the pattern edited (the playing one, or the one shown) | `qd_ctl_pat(a)` | core/app/ctl.h |
| one change = one undo level | `qd_undo_input(a, 0)` + `qd_undo_hint`: the gesture closes after `QD_UNDO_QUIET_MS` of quiet; its XOR difference is the level | core/app/undo.h |
| commands in the handler (the quick ones) or as a job (between frames, stopped only) | `sx_frame`'s switch, `sx_ack`, `qd_sx_work` | core/app/fizz_sx.c |
| a pattern change: at once stopped, queued while playing (END, BAR, BEAT, NOW) | `qd_seq_select / qd_seq_select_at` | core/seq/seq.h |

So the firmware work is a protocol layer over functions the panel already calls, not new sequencer code.

## Constraints that shape the protocol

- **Two patterns in RAM on the unit** (`QD_PAT_RAM 2` at the device's sizes: the playing one and the queued one). A
  pattern that is not loaded lives in the store; reading or writing it means paging it in (an 18 ms flash read the
  panel keeps out of the audio lock). Phase 1 therefore edits **only the pattern the unit has open** (`qd_ctl_pat`);
  another pattern is shown from the store image (FZBR, read only) and opened for editing by asking the unit to go to it.
- **Inbound frames: 640 bytes at most, four waiting** (`firmware/app/app.c FZ_HQ`, `FZ_HQ_LEN`; a fifth is dropped). Every
  write is one small frame and waits for its ACK before the next, as PARAM does today (`eglive.js` already works this way).
- **Replies: 1024 bytes a frame, a 4096-byte ring** (`QD_SX_FRAME_MAX`, `QD_SX_RING`). A read of a track is several
  frames, paced by the ring's room, as DUMP slot 0 is.
- **RAM is nearly gone** (BUDGET.md: about 1.5 KB free in the USB package; the Bluetooth package, which the owner's unit
  runs, has to be measured first). No new buffer: replies are built into the existing ring, frames parsed in place.
  The code is `FZ_COLD` (flash), as the rest of `fizz_sx.c`.
- **Bluetooth**: the same frames arrive through `fz_bsx` with their port. The new commands should be "light"
  (`fz_hq_light`: served between the screen's bands); none needs a flash write.
- **Playing**: step and lock edits go in under the lock in the handler, as PARAM's `qd_player_live_edit` does: the
  pattern plays on with the change.

## The commands (proposed ids; all under 7D 45 47 01, the replies as today's)

Numbers are 7-bit bytes; `u14` two of them (high first), `s21` three (value + 2^20, as PARAM). `track` 0..5 (127: the
selected one). Steps are 0..127 (`QD_NSTEP`). Every write answers ACK `52` (status, a = track + 1, b = step + 1), and
on failure the status says why: BAD TRACK, BAD SLOT (a step out of range), FULL (the lock pool), BUSY (a job, a name
typed), BAD LENGTH.

### `32` PATTERN INFO -> `72`
The open pattern at a glance, so the page knows what it is looking at and whether it changed.
Body: none. Reply: the pattern number (0..63), its revision (`u14`, below), bpm, swing, master length, `nlock` (u14),
and for each of the 6 tracks: its loop (the `loop` bits, 8 pages' `pstart` / `pend`), rate code, mute, channel, limit,
transpose, the step defaults (`qd_sdef_t`, as the record keeps it) and its sound's name. About 6 x 40 bytes: one frame.

### `33` STEPS -> `73` (and `74` LOCKS)
Read steps. Body: track, first step, count (1..128), flags (01: with their locks). Replies: `73` frames of at most 32
steps each (`QD_STEP_WIRE` x 32 = 640 bytes, 732 packed), each `track, first, n, pack7(wire bytes)`; then, with flag 01,
`74` frames of the locks in that range: `part, last, n, (step, id, s21 value) x n` (6 bytes a lock, at most 127 a
frame: the count is one 7-bit byte). A whole track: 4 `73` frames plus its locks (a pattern holds 1024 locks at most: 9 frames in the worst case).

### `34` STEP SET
Change fields of one or more steps. Body: track, a step mask (128 bits as 19 bytes of 7), then pairs (field, `s21`
value), at most 8. Fields map one to one onto the core's setters, so the unit's own rules apply (a note sets a trig;
slots keep "no two the same"; a sound lock 0..128): TRIG, NOTE k (k 0..5, the slot), NOTES (a chord: up to 6 values
follow), VEL, LEN, MICRO, RATCHET (count, ramp), COND, CHANCE, SOUND, STRUM, FUNC, MFX, CLEAR (the step emptied, its
locks with it). The mask makes "these three steps get velocity 100" or "lock POOL 07 on 5, 9, 13" one command and one
undo level, the same as the panel's held steps (and the fix of the multi-step sound lock in the working tree).

### `35` LOCK SET
Set or clear locks. Body: track, step mask (19 bytes), then entries (op, id, `s21` value), at most 16: op 0 sets
(`qd_lock_set`, clamped by `qd_lock_range`), 1 clears that id, 2 clears every lock of the steps. ids are `qd_lock_t.id`:
the sound's values 0..118, then PAN DELAY REVERB CHORUS LEVEL and the rooms CRUSH ROBOT WARP GLITCH TV (119..128): all
fit the byte, unlike PARAM's 7-bit id. FULL when the pool runs out part way: what went in stays, the ACK's b says how
many entries were applied, so the page can say "the pattern's 1024 locks are used".

### `36` STEPS PUT
Paste. Body: track, first step, n (at most 24: 480 wire bytes, 549 packed: under the 640), pack7(wire bytes). Locks are
not carried (send them with LOCK SET afterwards); the pasted steps' old locks are cleared. `qd_steps_put` does it.

### `37` TRACK SET
A track's settings: field, value pairs (loop pages, a page's start and end, rate base and type, mute, transpose,
the step defaults). Phase 2.

### `38` GO TO PATTERN
Body: pattern 0..63. As the unit's own pattern keys: at once when stopped, queued while playing
(`qd_seq_select_at`, the project's launch setting). ACK; PATTERN INFO's number changes when it happens.

### `39` UNDO
Body: -1 or +1 (0 or 2). The unit's own `qd_undo_step`: the web's CMD + Z and the unit's SHIFT + F1 walk one history.
ACK b = the level's kind, or NOT FOUND (nothing to undo).

### STATUS (`02` -> `42`): appended
The open pattern's revision (`u14`): a counter the core bumps whenever the open pattern changes (an undo level stored,
a pattern switched, a recording pass, a paste). The page polls STATUS (it already does, once a second, for EDIT's
read-back) and re-reads only the tracks it shows when the revision moved. Appending keeps older pages working: they
read STATUS by its length (egsysex.js `parseStatus`).

## The firmware changes

1. `core/app/fizz_sx.h`: the ids above, their reply ids, field and op enums, the step-mask size; docs/SYSEX.md their
   bytes (and its stale FIZZ ids: `7D 46 5A` -> `7D 45 47`).
2. `core/app/fizz_sx.c`: `sx_pinfo`, `sx_steps` (paced like DUMP slot 0: a cursor in `qd_sx_t`, a few bytes), `sx_stepset`,
   `sx_lockset`, `sx_stepsput`, `sx_goto`, `sx_undo`; each write: `qd_undo_input(a, 0)`, `qd_undo_hint(a, QD_UK_EDIT)`,
   the core's setter on `qd_ctl_pat(a)`, the ACK. `sx_frame`'s switch gains them.
3. The revision: a `uint16_t` in `qd_app_t`, bumped where the open pattern changes (the undo gesture's close when it
   stores a level is the one place every edit passes; plus the pattern switch). STATUS appends it.
4. `firmware/app/app.c`: `fz_hq_light` lists the new ids as light (they write no flash).
5. The budget: measure both packages before and after (`firmware/build.py`, BUDGET.md's table). Estimate: 2 to 3 KB of
   flash, under 64 bytes of RAM (the STEPS cursor, the revision).
   **Measured for phase 1 (2026-11-15, the Bluetooth package, the working tree's core):** the app image 575,640 ->
   577,288 B (+1,648; **4,276 B free** of the 581,564 slot, was 5,924), RAM .data + .bss unchanged (416 free), the pool
   +16 B (8,996 free), the second data blob +12 B. Phase 2's writes must fit in what is left: about 4 KB.
   **Measured for phase 2:** the app image 578,984 B (+1,696 over phase 1; **2,580 B free**), RAM unchanged. Phase 3
   (GO TO PATTERN, TRACK SET) has to stay within that.
   **Measured for phase 3:** 579,560 B (+576; **2,004 B free**), RAM unchanged.

## The manager's side

- `egsysex.js`: the frames and their parsers; `eglink.js`: `patternInfo`, `steps(track, from, n, {locks})`,
  `stepSet(track, steps, fields)`, `lockSet(track, steps, entries)`, `stepsPut`, `gotoPattern`, `undo`.
- `egseq.js` (no DOM): the pattern model from those replies (or from the store image's pattern records, for patterns
  not open: the record layout from `core/app/persist.c ser_pat`, as FIZZ's MPL `projects.js walkPat` reads it).
- The piano roll and STEP LOCKS screens: every edit one command and its ACK through the same one-at-a-time queue as
  LIVE (`eglive.js`); a drag sends what it ends on.
- `egsim.js`: the same commands on the simulated unit, so the screens can be built and tested without one.

## Phases

1. **Read** (no risk to the unit): `32`, `33`, the STATUS revision. The piano roll shows the open pattern, follows the
   unit as it plays and as someone edits on it. Hardware check: read only.
2. **Write the open pattern**: `34`, `35`, `36`, `39`. Undo shared with the unit. Hardware check on track 6 of a
   project that is not Project 2, put back with UNDO, then compared byte for byte with the steps read before.
3. **Any pattern**: `38` (and the store image for the overview), `37` track settings.
4. **Later, if wanted**: editing a pattern that is not open without switching to it (a job paging it in, stopped only).

## Tests

- core: `core/tests/test_app.c` drives each command through `qd_app_sysex` (and reads `qd_app_sysex_take`) on the host core: the steps and locks it
  reads back equal `qd_steps_get`'s; masks, clamps, FULL, BUSY, a paste over locks; each write one undo level, UNDO
  restoring the pattern byte for byte; the revision moving exactly when the pattern does.
- the host simulator (`firmware/app/tests`): a script that edits while the demo plays, the frames timed.
- the manager: `tools/eg/manager_test.mjs` against frames captured from the unit and the simulated unit;
  `manager_hw.mjs` grows a read-only `--steps` and, with the owner's go-ahead, the track 6 write-and-undo run.
- `make -C tools values-check` stays the check that the page's value table is the core's.

## Risks and open questions

- **The other session's uncommitted core changes** (`ctl_step.c`'s multi-step sound lock, the new LFO destinations)
  touch the same code. Build this after they are committed, so the protocol is cut against the core that ships.
- **Undo while the web drags**: a drag is many STEP SETs within `QD_UNDO_QUIET_MS`, one gesture, one level: right.
  The page must not let a gesture run across two tracks it thinks are separate edits; one undo level each is the
  unit's rule, not the page's.
- **The unit edited at the same time** (a knob, a recording): the revision tells the page to re-read; the page's
  pending command still goes in. Last write wins, as two hands on the panel would.
- **A pattern switch mid-edit**: every write could carry the pattern number the page believes is open, refused with
  BAD SLOT when it is not. Cheap, and it removes the worst surprise (editing the wrong pattern). Recommended.
- **The Bluetooth package's flash and RAM**: measure first; if it does not fit, phase 1 (read) alone is the smallest
  useful piece.
- **Firmware compatibility**: an older EVILGENIUS answers BAD COMMAND to `32`..`39`: the page shows SEQUENCE read
  only from the store image and says which firmware adds editing.
