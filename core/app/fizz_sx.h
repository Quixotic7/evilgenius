/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* P1.5r: FIZZ's SysEx (docs/SYSEX.md): sounds imported into the LIBRARY or the project's POOL (a web page converting
 * Digitone .dnsnd presets with ChoralRoot's reader hands them over this way), and an identity query. Built through
 * app.c (it includes fizz_sx.c). The glue (core/glue/core_quadrille.c) carries the frames: what the ABI's midi_in
 * collects between F0 and F7 (FM1VST's core-glue/common sysex.h) goes to qd_app_sysex, and qd_app_sysex_take's replies
 * go out through midi_out_take.
 *
 *   F0 7D 45 47 01 <cmd> <body> <chk> F7         7D: non-commercial; 45 47 "EG" (EvilGenius; FIZZ's is 46 5A "FZ":
 *                                                its tools never write FM patches here); 01 the protocol's version
 *   chk: (sum of cmd, body, chk) & 0x7F == 0      every byte between F0 and F7 7-bit
 *
 *   01  IDENTITY       -> 41 <protocol 01> <"FIZZ 0.6.4-p1.5r" ASCII>
 *   10  STORE SOUND    (P1.5t: the LIBRARY is MY presets: 256 places, the sound marked imported, its kind read)
 *                      flags, slot hi, slot lo, name[12], drive, track, pan, chorus, delay, reverb, mixmask,
 *                      patch[110] (the 96-byte FM TONE blob, 7-bit packed)
 *                      -> 50 <status> <0 LIBRARY / 1 POOL> <slot hi> <slot lo>
 *   any other command  -> 7F <status 7> <cmd> */
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define QD_SX_ID0 0x7Du
#define QD_SX_ID1 0x45u
#define QD_SX_ID2 0x47u
#define QD_SX_PROTO 1u

enum { QD_SX_IDENTITY = 0x01, QD_SX_STORE = 0x10, QD_SX_STORE6 = 0x11, QD_SX_LABELS = 0x20, QD_SX_LIST = 0x21,
       QD_SX_DUMP = 0x22, QD_SX_R_IDENTITY = 0x41, QD_SX_R_STORE = 0x50, QD_SX_R_LABELS = 0x60, QD_SX_R_LIST = 0x61,
       QD_SX_R_ERROR = 0x7F };          /* (P1.6l: LABELS; P1.6m: LIST, DUMP: its replies STORE / STORE6 frames) */
/* the web manager's Phase 1 (docs/WEB-MANAGER-PLAN.md §5, docs/SYSEX.md): the library, the pool and the projects
 * edited from a page. The quick ones run in the handler (the lock: a directory entry, a record queued); the ones that
 * touch patterns or other projects' records are a job (qd_sx_t.wk) stepped by the store's step (qd_persist_step:
 * between frames, outside the locks), refused while playing (BUSY), paused if PLAY comes meanwhile; their reply comes
 * when they are done */
enum { QD_SX_STATUS = 0x02, QD_SX_FLUSH = 0x03, QD_SX_TAGS = 0x12, QD_SX_RENAME = 0x13, QD_SX_DELETE = 0x14,
       QD_SX_SWAP = 0x15, QD_SX_POOLREF = 0x16, QD_SX_USERS = 0x17, QD_SX_PROJECTS = 0x23, QD_SX_PROJECT = 0x24,
       QD_SX_R_STATUS = 0x42, QD_SX_R_ACK = 0x52, QD_SX_R_USERS = 0x57, QD_SX_R_PROJECTS = 0x63 };
#define QD_SXS_PROJECT 3               /* RENAME's source: a project (slot 1..8); MY PRESETS the other */
#define QD_SXS_TRACK 4                 /* Manager P2-B: DUMP's source: a track's sound (slot 1..6; 0 the selected one) */
#define QD_SXD_CONFIRM 0x01u           /* DELETE's flags: delete even if used (else IN USE and the users) */
enum { QD_SXP_LOAD = 1, QD_SXP_NEW, QD_SXP_COPY, QD_SXP_DELETE };   /* PROJECT's ops */
#define QD_SXT_PLAYING 0x01u           /* STATUS's flags: playing, .. */
#define QD_SXT_NOSTORE 0x02u           /* .. no store attached (safe mode on the unit), .. */
#define QD_SXT_DIRTY 0x04u             /* .. something not written yet, .. */
#define QD_SXT_JOB 0x08u               /* .. a job running (BUSY for another), .. */
#define QD_SXT_DEMO 0x10u              /* .. the project worked on started with the demos, .. */
#define QD_SXT_REC 0x20u               /* .. (Manager P2-B) recording, or armed (a page's notes are recorded); then the
                                        * selected track (a byte after the job's command) */
#define QD_SXT_BROWSE 0x40u            /* .. (Manager fixes) the unit's sound browser open (its preview on a track) */
#define QD_SXK_BLE 0x01u               /* 2026-10-27: STATUS's package byte (after the selected track; the Bluetooth
                                        * package's reply only, then its projects and MY PRESETS' places): the
                                        * Bluetooth package. A reply without the byte: the USB package */
#define QD_SXF_DUMP 0x08u              /* P1.6m: a STORE that is a DUMP's reply: FIZZ ignores it (clear it to restore) */
#define QD_SXS_MINE 0                  /* P1.6m: LIST / DUMP's sources: MY PRESETS (slot 1..256) .. */
#define QD_SXS_FACTORY 1               /* .. the factory presets (1..23) .. */
#define QD_SXS_POOL 2                  /* .. the project's pool (1..128: its preset) */
#define QD_SXL_FACTORY 0x01u           /* LIST's flags: the factory presets too, .. */
#define QD_SXL_POOL 0x02u              /* .. the pool too */
#define QD_SX_LIST_PER 16              /* a LIST reply's entries at most */
#define QD_SX_ENTRY 20                 /* an entry: source, slot (2), preset id (3), name (12), tags, flags */
#define QD_SXL_SUB 0x01u               /* P1.6l: LABELS' flags: subscribe (a LABELS reply by itself when they change) */
#define QD_SX_LABELS_MS 50u            /* .. looked at every this many ms at most (20 a second) */          /* (E1: STORE6, the 128-byte version-6 blob; its reply is STORE's) */

/* STORE's flags */
#define QD_SXF_POOL 0x01u              /* into the project's POOL (else the LIBRARY) */
#define QD_SXF_BATCH 0x02u             /* joins the previous import's undo level (a batch: one undo) */
#define QD_SXF_LOAD 0x04u              /* also onto track <track> of the pattern playing (its sound, and its mix by mixmask) */
/* Manager P2-B (docs/MANAGER-P2-PLAN.md §1.3): AUDITION (with LOAD): the sound onto the track only, nothing stored, no
 * undo level; the body may end with the track's extras (8 bytes after the tags byte: a track DUMP's), its preset id,
 * pool sound and edited mark set as given (a page's CANCEL puts a track back exactly). OWN: the preset is the owner's
 * (not marked imported: the editor's SAVE) */
#define QD_SXF_AUDITION 0x10u
#define QD_SXF_OWN 0x20u
#define QD_SX_XTRA 8                   /* the track's extras: preset id (3 x 7 bits), pool sound (2 x 7), flags (01 edited,
                                        * 02 the selected track, 04 recording, 08 playing), its MIDI channel, the selected
                                        * track */
#define QD_SXX_EDITED 0x01u
#define QD_SXX_SELECTED 0x02u
#define QD_SXX_REC 0x04u
#define QD_SXX_PLAYING 0x08u
#define QD_SXX_BROWSE 0x10u            /* (Manager fixes) the unit's sound browser previews on this track */
/* Manager P2-B: PARAM: one value of a track's sound, as a knob turned on the unit (qd_player_live_edit: the voices
 * sounding follow). Body: track (0..5; 127 the selected one), id (0..109), value + 2^20 (3 x 7 bits), flags (01 ACK);
 * no reply but with ACK or on an error (ACK 52: a = the track + 1, b = the id) */
#define QD_SX_PARAM 0x30
#define QD_SXP_ACK 0x01u
#define QD_SXP_SELECTED 127
#define QD_SXP_OFS (1 << 20)
/* Manager fixes: BROWSE: the unit's sound browser opened on a track at a preset, as PRESETS turned to it (the track
 * previews it; OCT- on the unit cancels, OCT+ loads it). Body: track (0..5; 127 the selected one), preset id (3 x 7
 * bits). ACK (a = the track + 1, b = the browser's place + 1): BAD TRACK, NOT FOUND (no such preset), BUSY (a name
 * being typed on the unit), BAD LENGTH */
#define QD_SX_BROWSE 0x31
/* 2026-11-15 (docs/SEQ-SYSEX-PLAN.md, phase 1: reading the pattern open on the unit, the one qd_ctl_pat edits):
 *   PATTERN INFO (32 -> 72): no body. Reply: the pattern (0..63), its revision (2 x 7 bits: qd_hist_t.rev, moves when
 *     the unit's undo sees the pattern change), bpm (2), swing, master (3: 0 AUTO, 16..1024, 65535 INF), nlock (2),
 *     used, tracks (6), QD_STEP_WIRE (20), sizeof (qd_tset_t) (44); then each track: its qd_tset_t's bytes packed 7 bits
 *     a byte (as the store's pattern record holds them), its sound's name (12, spaces).
 *   STEPS (33 -> 73, then 74): track (0..5, 127 the selected), first step (0..127), count (1..127; 0: to step 128),
 *     flags (01: their locks too). Replies, paced as DUMP's (the ring's room): 73 pattern, track, first, n (<= 32),
 *     revision (2), each step's QD_STEP_WIRE bytes packed on their own (23 bytes a step); then, with 01, 74 pattern,
 *     track, part, last, n (<= QD_SX_LOCKS_PER), each lock: step, id (2), value + 2^20 (3). An error: 7F BAD TRACK /
 *     BAD SLOT / BAD LENGTH, 33 */
#define QD_SX_PINFO 0x32
#define QD_SX_STEPS 0x33
/* phase 2 (writing the open pattern; every write starts with the pattern the page believes is open: another one is
 * BAD PATTERN, b = the open pattern + 1; each write is an input to the undo, so a run of them within its quiet time is
 * one level, as a knob's turn; STEPS PUT and CLEAR an operation's level of their own). The step mask: 19 bytes, step
 * s = bit s % 7 of byte s / 7. ACK 52: a = the track + 1, b = the steps (or locks) changed; the first refusal's status:
 *   STEP SET (34): pattern, track, mask, n, then n fields: field, value (3 x 7 bits, + 2^20); NOTES: field, count, the
 *     notes (count bytes). Fields QD_SXF_*: each the core's setter on every step in the mask (BAD VALUE: out of range)
 *   LOCK SET (35): pattern, track, mask, n (<= 16), then n entries: op (0 set, 1 clear the id, 2 clear every lock),
 *     id (2 x 7 bits), value (3 x 7 bits, + 2^20). FULL: the pattern's 1024 are used (what went in stays: b says)
 *   STEPS PUT (36): pattern, track, first, n (<= 24), the steps' QD_STEP_WIRE bytes packed on their own (23 bytes a
 *     step): the steps replaced, their locks cleared (a paste)
 *   UNDO (39): 0 undo, 1 redo: the unit's own (SHIFT + F1 / F2); b = the level's kind + 1, NOT FOUND: none */
#define QD_SX_STEPSET 0x34
#define QD_SX_LOCKSET 0x35
#define QD_SX_STEPSPUT 0x36
#define QD_SX_UNDO 0x39
/* phase 3 (2026-11-15):
 *   TRACK SET (37): pattern, track, n, then n fields: field, value (3 x 7 bits, + 2^20). Fields QD_SXT_*: LOOP (the
 *     page mask, 1..255), PSTART / PEND (page << 4 | step: a page's first / last step, start <= end), RATE (a rate code,
 *     qd_tset_set_rate), SWING (0 / 1), TRANSPOSE (-48..48), MUTE (0 / 1), DEF (pm << 8 | value: a step default,
 *     qd_tdef_set), DEFNOTE (k << 8 | pitch: a default note slot, qd_tdef_set_note). One undo input, as STEP SET's
 *   GO TO PATTERN (38): pattern (0..63): as the unit's pattern keys (the project's launch while playing; stopped and not
 *     in RAM: chosen once it is read in). ACK b = 1 now, 2 later (queued, or once read in) */
#define QD_SX_TRACKSET 0x37
#define QD_SX_GOTO 0x38
enum { QD_SXT_LOOP, QD_SXT_PSTART, QD_SXT_PEND, QD_SXT_RATE, QD_SXT_SWING, QD_SXT_TRANSPOSE, QD_SXT_MUTE, QD_SXT_DEF,
       QD_SXT_DEFNOTE, QD_SXT_N };
#define QD_SX_MASK 19
#define QD_SX_PUT_PER 24
#define QD_SX_LOCKSET_PER 16
enum { QD_SXF_TRIG, QD_SXF_NOTES, QD_SXF_VEL, QD_SXF_LEN, QD_SXF_MICRO, QD_SXF_RATCH, QD_SXF_COND, QD_SXF_CHANCE,
       QD_SXF_SOUND, QD_SXF_STRUM, QD_SXF_FUNC, QD_SXF_MFX, QD_SXF_RESET, QD_SXF_CLEAR, QD_SXF_N };
/* (TRIG's value: QD_TRIG_NONE clears the step and its locks, NOTE / LOCK / TIE a trig of that type, 4 a plain trig (the
 * tap); RATCH's: count | ramp << 4; RESET's: a QD_PM_* back to the track's) */
#define QD_SXF_TRIG_ON 4
#define QD_SX_R_PINFO 0x72
#define QD_SX_R_STEPS 0x73
#define QD_SX_R_LOCKS 0x74
#define QD_SXP_LOCKS 0x01u             /* STEPS' flags: the locks too */
#define QD_SX_STEPS_PER 32             /* a 73 reply's steps at most (32 x 23 + 10 bytes) */
#define QD_SX_LOCKS_PER 127            /* a 74 reply's locks at most (its count is one 7-bit byte: 127 x 6 + 13 bytes) */
/* STORE's mixmask (with LOAD): which of pan, chorus, delay, reverb the track takes */
#define QD_SXM_PAN 0x01u
#define QD_SXM_CHORUS 0x02u
#define QD_SXM_DELAY 0x04u
#define QD_SXM_REVERB 0x08u

/* the statuses */
enum { QD_SX_OK, QD_SX_FULL, QD_SX_BAD_LENGTH, QD_SX_BAD_CHECKSUM, QD_SX_BAD_PATCH, QD_SX_BAD_SLOT, QD_SX_BAD_VERSION,
       QD_SX_BAD_COMMAND, QD_SX_BUSY, QD_SX_NOT_FOUND, QD_SX_IN_USE, QD_SX_BAD_TRACK,   /* (8..11: Phase 1) */
       QD_SX_BAD_PATTERN, QD_SX_BAD_VALUE };   /* (12, 13: the sequencer's writes, 2026-11-15) */

#define QD_SX_NAME 12
#define QD_SX_BLOB 96
#define QD_SX_BLOB7 110                /* 13 groups of 7 bytes -> 8, the last 5 -> 6 */
#define QD_SX_STORE_BODY (1 + 2 + QD_SX_NAME + 1 + 1 + 4 + 1 + QD_SX_BLOB7)   /* 132 (P1.5x: or 133, + a tags byte) */
#define QD_SX_BLOB6 128                /* E1: STORE6's blob (version 6) .. */
#define QD_SX_BLOB6_7 147              /* .. 18 groups of 7 -> 8, the last 2 -> 3 */
#define QD_SX_STORE6_BODY (1 + 2 + QD_SX_NAME + 1 + 1 + 4 + 1 + QD_SX_BLOB6_7)   /* 169 (or 170, + a tags byte) */
#define QD_SX_OUT_MAX 48               /* an identity / store reply's bytes, F0 .. F7 (the short ones) */
#define QD_SX_FRAME_MAX 1024           /* P1.6l: the longest reply, F0 .. F7 (LABELS ~ 560) */
#define QD_SX_RING 4096                /* P1.6l: the replies waiting, a ring of bytes (each one: 2 bytes its length, then
                                        * it) */

/* Manager P2-B: a STORE over a used MY PRESETS place waiting for its job (the other projects' records that load the
 * preset keep their own copies first, a project a step, outside the handler): the frame as read */
typedef struct {
    int16_t patch[QD_QUAD_NP];
    char name[QD_SX_NAME + 1];
    uint8_t flags, track, mix[5];      /* STORE's flags, track, pan + 64, chorus, delay, reverb, mixmask */
    uint8_t tags, has_x, x_sound, x_flags;   /* the tags byte (0 none); the extras: given, pool sound, flags */
    uint16_t slot, x_id;               /* the place (1-based); the extras' preset id */
} qd_sx_pend_t;

/* (Phase 1) the job a command left (cmd 0: none): its arguments and its cursor; in qd_app_t (the pool on the unit) */
typedef struct {
    uint8_t cmd, src, flags, step;     /* the command, its source, its flags, the cursor (a project, a pattern) .. */
    uint8_t x, y;                      /* .. its slots (SWAP: the pool numbers; PROJECT: p, q; DELETE / USERS: the place) */
    uint16_t id;                       /* .. the preset (DELETE / USERS of MY presets) */
    uint16_t steps;                    /* USERS: the steps counted so far (all projects) .. */
    uint8_t np, tracks;                /* .. the projects using it, the tracks here */
    uint8_t pst[8];                    /* .. each project's steps (255: more), 0 not used (the reply lists the others) */
} qd_sx_work_t;

typedef struct {
    uint8_t ring[QD_SX_RING];
    uint32_t r, w;
    int lbl_sub;                       /* P1.6l: LABELS subscribed .. */
    int job, job_flags, job_src, job_at, job_part;   /* P1.6m: a LIST / DUMP going out (0 none): its cursor, its part */
    int job_first, job_end, job_li, job_stage;   /* (2026-11-15) STEPS: its range, the lock within the step, steps (0)
                                        * or locks (1) */
    uint32_t lbl_count, lbl_hash, lbl_ms;   /* .. the set's change count, its hash, when last looked at */
    const char *version;               /* the identity's version ("FIZZ 0.6.4-p1.5r"; the glue sets it) */
    uint32_t frames, errors;           /* (counters) */
    qd_sx_work_t wk;                   /* (Phase 1) the job running */
    qd_sx_pend_t pend;                 /* (Manager P2-B) a STORE's frame while its job runs */
    uint8_t dump[1 + QD_SX_STORE6_BODY + 1 + QD_SX_XTRA];   /* (P2-B) a DUMP reply being made (was a static in RAM) */
    uint32_t rx_ms;                    /* the port's: when its last FIZZ frame came (its clock | 1; 0 none): the frames'
                                        * pacing during a transfer (firmware/app/app.c fz_step) */
    uint32_t xs[13];                   /* the port's transfer counters (app.c FZ_XS_*: stats line 16), here not in the
                                        * port's RAM */
#if QD_PKG_BLE
    uint8_t port;                      /* (the Bluetooth package) the port the frame being read came from (0 USB, 1
                                        * Bluetooth: qd_app_sysex_port) .. */
    uint8_t out, job_port, wk_port, lbl_port;   /* .. the port the replies being made go to; a LIST / DUMP's, a
                                        * job's, LABELS' subscriber's: each reply goes back where its request came from */
#endif
} qd_sx_t;

struct qd_app;
void qd_app_sysex(struct qd_app *a, const uint8_t *f, uint32_t n);   /* one frame: its bytes between F0 and F7 */
int qd_app_sysex_take(struct qd_app *a, uint8_t *out, uint32_t max);  /* a reply, F0 .. F7: its length (0: none) */
int qd_app_sysex_peek(const struct qd_app *a);   /* P1.6l: the next reply's length (0: none) */
#if QD_PKG_BLE
/* (the Bluetooth package) the next frames' port (0 USB, 1 Bluetooth), before qd_app_sysex; and the next reply's (its
 * request's: the ring keeps it in its length's top bit) */
void qd_app_sysex_port(struct qd_app *a, int port);
int qd_app_sysex_peek_port(const struct qd_app *a);
#endif
int qd_app_sysex_busy(const struct qd_app *a);   /* P1.6m: replies still to be made (an export going out) */
void qd_sx_ms(struct qd_app *a);       /* P1.6l: each ms: a subscribed page's LABELS when they change */
void qd_app_sysex_version(struct qd_app *a, const char *version);
void qd_sx_work(struct qd_app *a);     /* (Phase 1) the job's next step: the store's step calls it (persist.c) */

/* the 7-bit packing: groups of seven bytes as eight, the first holding their top bits (bit k: byte k's); n bytes ->
 * returns the packed length */
uint32_t qd_sx_pack7(const uint8_t *in, uint32_t n, uint8_t *out);
uint32_t qd_sx_unpack7(const uint8_t *in, uint32_t n, uint8_t *out);   /* packed n -> the bytes */

#ifdef __cplusplus
}
#endif
