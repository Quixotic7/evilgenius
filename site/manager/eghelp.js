// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EDIT's help line: what each SID TONE value does, in a sentence (from core/voice/quad/quad_voice.h, the unit's own
// account of its values). help(id) -> text. No DOM.
import { ID, MIX } from "./egsound.js";
import { MIX_ID } from "./egsysex.js";

const OSC = ["WAVE: the oscillator's waveform: TRI, SAW, PULSE, NOISE, or the SID's combined waves (T+S .. P+T+S). OFF silences it.",
  "COARSE: the oscillator's pitch in semitones, -24 to +24.",
  "FINE: a fine tune, up to a semitone either way (0: none).",
  "PW: the pulse's width (the PULSE wave and its combinations); 64 is a square.",
  "MOD: SYNC, RING or both, by the oscillator before it (1 by 3, 2 by 1, 3 by 2)."];
const ENV = ["ATK: the SID envelope's attack, 0..15 (the chip's own rates).", "DEC: the decay to the sustain level, 0..15.",
  "SUS: the sustain level, 0..15.", "REL: the release after the key lets go, 0..15."];
const LFO = ["SPEED: how fast the LFO runs (on a MULT division it does nothing; on an ARP wave a step is this many PAL frames).",
  "MULT: FREE, or a tempo division: one cycle (an ARP wave: one note) each division, in time with the pattern.",
  "FADE: fades the LFO in (under 0) or out (over 0) after each note; 0 none.",
  "DEST: what the LFO moves. Drop the LFO's chip on a value to set it.",
  "WAVE: its shape; the ARP waves make a C64 arpeggio of a chord on the one voice.",
  "PHASE: where in its cycle the LFO starts.",
  "TRIG: FREE runs on its own, TRIG starts with each note, HOLD keeps its value from the note's start, ONE runs once, HALF runs half a cycle.",
  "DEPTH: how far it moves its destination (0 none; on an ARP wave the direction and the range)."];
const T = {
  [ID.DETUNE]: "DETUNE: spreads oscillators 2 and 3 apart, a chorus of the chip (0 none).",
  [ID.E2LINK]: "LINK: ENV 2 follows ENV 1 (its own four values unused while ON).",
  [ID.E3LINK]: "LINK: ENV 3 follows ENV 1 (its own four values unused while ON).",
  [ID.HR]: "HR: hard restart: a struck voice's gate is held off this many ms first, so the SID's envelope starts clean.",
  [ID.FREQ]: "CUTOFF: the SID filter's cutoff, 0..2047 (the chip's 11 bits).",
  [ID.RESO]: "RESO: the filter's resonance, 0..15.",
  [ID.FTYPE]: "MODE: the filter's mode: LP, BP, HP, their combinations, or OFF.",
  [ID.FROUTE]: "ROUTE: which oscillators go through the filter (1 2 3) and V the voice's digi (VOX).",
  [ID.FDEPTH]: "DEPTH: how far the filter envelope moves the cutoff, either way.",
  [ID.FKTRK]: "KEYTRK: the cutoff follows the key played.",
  [ID.FATK]: "F ATK: the filter envelope's attack (a software envelope, 0..127).",
  [ID.FDEC]: "F DEC: the filter envelope's decay.", [ID.FSUS]: "F SUS: the filter envelope's sustain level.",
  [ID.FREL]: "F REL: the filter envelope's release.",
  [ID.CHIP]: "CHIP: the SID model the filter and the combined waves sound like: 6581 or 8580.",
  [ID.LEVEL]: "LEVEL: the sound's level.", [ID.VEL]: "VEL: how much the note's velocity reaches the level.",
  [ID.DRIVE]: "DRIVE: overdrive in the mix (0 none).", [ID.DRPRE]: "ROUTE: the drive before the filter (PRE) or after it (POST).",
  [ID.BITS]: "BITS: bit crushing (0 none).", [ID.SRR]: "SRR: sample-rate reduction (0 none).",
  [ID.CRPOST]: "ROUTE: the crush before or after the filter.",
  [ID.PORT]: "PORT: the glide: OFF, ON (every note glides from the last), LEGATO (only notes that overlap).",
  [ID.PTIM]: "TIME: the glide's time.", [ID.PSLOPE]: "SLOPE: TIME the same time whatever the leap, RATE the same speed.",
  [ID.WORD]: "WORD: VOX, a sampled word played by the SID's volume register (0 OFF).",
  [ID.ROOT]: "ROOT: the key at which the word plays at its own speed.",
  [ID.VSTART]: "START: where in the word to start.", [ID.VEND]: "END: where in the word to stop.",
  [ID.VLOOP]: "LOOP: OFF, FWD or BOUNCE between START and END.",
  [ID.DBITS]: "BITS: the digi's bits, 1..4 (the C64's volume register has four).",
  [ID.DHOLD]: "RATE: the digi's update rate.", [ID.DBOOST]: "BOOST: the 8580's trick: oscillator 3 as the DC the volume scales.",
  [ID.DLVL]: "LEVEL: the word's level.",
  [ID.VMODE]: "VOICE: POLY or MONO (not lockable on a step).", [ID.UNI]: "UNISON: voices per note, 1..8.",
  [ID.UDET]: "DETUNE: the unison voices' detune.", [ID.USPR]: "SPREAD: the unison voices across the stereo field.",
  [ID.VPRIO]: "PRIO: which notes keep their voices when they run out: LOW, MID or HIGH.",
  [ID.SAY]: "SAY: SAM speaks a word live: 0 OFF (WORD's), 1..999 a word of its own each.",
  [ID.SSPD]: "SPEED: SAM's speaking speed (72 its own).", [ID.SPIT]: "PITCH: SAM's pitch (64 its own).",
  [ID.STHR]: "THROAT: SAM's throat (128 its own).", [ID.SMTH]: "MOUTH: SAM's mouth (128 its own).",
  [MIX_ID.PAN]: "PAN: the track's place in the stereo field (kept with the preset).",
  [MIX_ID.DELAY]: "DELAY: the send into the delay.", [MIX_ID.REVERB]: "REVERB: the send into the reverb.",
  [MIX_ID.CHORUS]: "CHORUS: the send into the chorus.",
};
export function help(id) {
  if (T[id]) return T[id];
  if (id >= 0 && id < 15) return `OSC ${Math.floor(id / 5) + 1} ${OSC[id % 5]}`;
  if (id >= ID.EATK && id <= ID.EREL) return `ENV 1, the amp's: ${ENV[id - ID.EATK]}`;
  if (id >= ID.E2A && id <= ID.E2R) return `ENV 2: ${ENV[id - ID.E2A]}`;
  if (id >= ID.E3A && id <= ID.E3R) return `ENV 3: ${ENV[id - ID.E3A]}`;
  if (id >= ID.LFO0 && id < ID.MOD0) return `LFO ${Math.floor((id - ID.LFO0) / 8) + 1} ${LFO[(id - ID.LFO0) % 8]}`;
  if (id >= ID.MOD0 && id < ID.VMODE) {
    const k = Math.floor((id - ID.MOD0) / 3) + 1;
    return [`MOD ${k} SOURCE: VEL, KEY, MW (CC 1), AT, PB, BR (CC 2), RAND (a new value each note) or F ENV.`,
      `MOD ${k} DEST: what the slot moves (the LFOs' list). Drop a source's chip on a value to fill a free slot.`,
      `MOD ${k} DEPTH: how far, -127..+127.`][(id - ID.MOD0) % 3];
  }
  return MIX.some((m) => m.id === id) ? "" : "";
}
