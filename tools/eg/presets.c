/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* presets: every factory preset on one voice, measured and written out for listening.
 *   presets OUT_DIR [NOTE]
 * Each plays NOTE (60) for 0.9 s and 0.9 s of its release, alone on a voice (no mix, no effects): OUT_DIR/presets.wav
 * has them one after another (mono, 16-bit, 44.1 kHz), presets.txt a line each: its kind, the peak and the RMS of the
 * loudest 100 ms (of 32767), the time to -40 dB after the release, and the pitches heard in the first frames (from
 * the zero crossings of each 20 ms: an ARP preset shows its chord). */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sounds.h"
#include "say.h"

#define SR 44100
#define HOLD (SR * 9 / 10)
#define TAIL (SR * 9 / 10)

static void w16(FILE *f, unsigned v) { fputc((int)(v & 255u), f), fputc((int)(v >> 8 & 255u), f); }
static void w32(FILE *f, unsigned v) { w16(f, v & 65535u), w16(f, v >> 16); }

int main(int argc, char **argv)
{
    static qd_quad_voice_t v;
    static qd_quad_owner_t o;
    static int32_t x[HOLD + TAIL + 64];
    const int note = argc > 2 ? atoi(argv[2]) : 60;
    char path[512];
    FILE *wav, *txt;
    int k, total = 0;
    if (argc < 2) {
        fprintf(stderr, "presets OUT_DIR [NOTE]\n");
        return 1;
    }
    snprintf(path, sizeof path, "%s/presets.wav", argv[1]);
    wav = fopen(path, "wb");
    snprintf(path, sizeof path, "%s/presets.txt", argv[1]);
    txt = fopen(path, "w");
    if (!wav || !txt)
        return 1;
    fwrite("RIFF\0\0\0\0WAVEfmt ", 1, 16, wav);
    w32(wav, 16), w16(wav, 1), w16(wav, 1), w32(wav, SR), w32(wav, SR * 2), w16(wav, 2), w16(wav, 16);
    fwrite("data\0\0\0\0", 1, 8, wav);
    for (k = 0; k < QD_NFACTORY; k++) {
        qd_sound_t s;
        int n, i, peak = 0, t40 = -1, clip = 0;
        double best = 0;
        char pitches[160] = "";
        qd_factory_preset(k, &s);
        qd_quad_owner_init(&o);
        o.quad_patch = s.patch;
        qd_quad_voice_init(&v, 0);
        qd_say_want(s.patch);                           /* SAM renders the word (the app does this before a note) */
        memset(x, 0, sizeof x);
        qd_quad_voice_start(&v, s.patch, &o, note, 100);
        for (n = 0; n < HOLD + TAIL; n += QD_QUAD_CTL) {
            if (n >= HOLD && v.gate)
                qd_quad_voice_release(&v);
            qd_quad_owner_block(&o);
            qd_quad_voice_render(&v, x + n);
        }
        for (i = 0; i < HOLD + TAIL; i++) {
            const int a = abs((int)x[i]);
            if (a > peak)
                peak = a;
        }
        for (i = 0; i + 4410 <= HOLD + TAIL; i += 441) {   /* the loudest 100 ms */
            double e = 0;
            int j;
            for (j = 0; j < 4410; j++)
                e += (double)x[i + j] * x[i + j];
            if (e > best)
                best = e;
        }
        for (i = HOLD + TAIL - 441; i >= HOLD; i -= 441) {   /* the last 10 ms over -40 dB of the peak */
            int j, m = 0;
            for (j = 0; j < 441; j++)
                if (abs((int)x[i + j]) > m)
                    m = abs((int)x[i + j]);
            if (m > peak / 100) {
                t40 = (i - HOLD) * 1000 / SR;
                break;
            }
        }
        for (i = 0; i < 12; i++) {                      /* the pitch of each 20 ms (rising zero crossings) */
            int j, c = 0, first = -1, last = -1;
            char one[16];
            for (j = i * 882 + 1; j < (i + 1) * 882; j++)
                if (x[j - 1] < 0 && x[j] >= 0) {
                    if (first < 0)
                        first = j;
                    last = j;
                    c++;
                }
            snprintf(one, sizeof one, " %d", c > 1 ? (int)((double)(c - 1) * SR / (last - first) + 0.5) : 0);
            strcat(pitches, one);
        }
        for (i = 0; i < HOLD + TAIL; i++) {
            int y = (int)x[i];
            if (y > 32767 || y < -32768)
                clip++, y = y > 0 ? 32767 : -32768;
            w16(wav, (unsigned)(y & 65535));
        }
        total += HOLD + TAIL;
        fprintf(txt, "%3d %-13s %-5s peak %5d rms %5d rel %4d ms%s  hz%s\n", k + 1, s.name,
                qd_preset_kind_name(qd_tags_first(s.tags)), peak, (int)sqrt(best / 4410.), t40, clip ? " CLIPS" : "",
                pitches);
    }
    fseek(wav, 4, SEEK_SET), w32(wav, 36u + (unsigned)total * 2u);
    fseek(wav, 40, SEEK_SET), w32(wav, (unsigned)total * 2u);
    fclose(wav), fclose(txt);
    return 0;
}
