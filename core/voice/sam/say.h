/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* EvilGenius: SAY, SAM speaking live. A patch's spoken word is its SAY word (1..999: a random word, FIZZ's name
 * generator's, the same for the same value on every build) or, with a voice other than SAM's own, its WORD; SAM
 * renders it in that voice (SPEED, PITCH, THROAT, MOUTH) into a cache of QD_SAY_SLOTS words, 4-bit at QD_VOX_FS like
 * the stored words, so VOX plays it the same way. SAM runs only in the app's free time (qd_say_want, never in the
 * audio); the voices only look the word up (qd_say_get): a word not rendered yet is the stored one (WORD), or silence
 * (a SAY word). */
#pragma once
#include <stdint.h>

#define QD_VOX_FS 6000u                 /* the words' rate (eg_vox_data.h VOX_FS) */
#define QD_SAY_MAX 999                  /* SAY's values: 1..999 */

int qd_say_text(int seed, char *out);   /* SAY's word for seed (out: 13 bytes); 0: none (seed 0, OFF) */
uint32_t qd_say_key(const int16_t *p);  /* the patch's live word and voice (0: none live: the stored word, or no word) */
int qd_say_default_voice(const int16_t *p);
int qd_say_want(const int16_t *p);      /* the app (not the audio): render the patch's live word if it isn't cached;
                                         * 1: it rendered one (SAM's time spent) */
const uint8_t *qd_say_get(uint32_t key, uint32_t *len);   /* the audio: the cached word (two samples a byte, the
                                                           * high nibble first) and its samples, or 0 */
void qd_say_reset(void);                /* the cache empty (a new app) */
