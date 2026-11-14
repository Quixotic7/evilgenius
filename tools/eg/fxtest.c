/* SPDX-License-Identifier: MPL-2.0
 * EvilGenius: the retro rooms, each alone at full mix on a test signal (a 220 Hz saw with an 8th-note gate), sends
 * full into CHORUS / ECHO / ROOM: each one's output level, peak and how far it moves the signal; FAIL on silence, a
 * runaway (the limiter pinned for seconds) or no effect at all. Writes OUT_DIR/fx-NAME.wav to listen to.
 *     fxtest OUT_DIR */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "qd_fx.h"

#define FS 44100
#define SECS 4

static void wav(const char *path, const int16_t *x, int n)
{
    FILE *f = fopen(path, "wb");
    uint32_t v;
    uint16_t h;
    if (!f)
        return;
    fwrite("RIFF", 1, 4, f), v = 36u + (uint32_t)n * 4u, fwrite(&v, 4, 1, f), fwrite("WAVEfmt ", 1, 8, f);
    v = 16, fwrite(&v, 4, 1, f), h = 1, fwrite(&h, 2, 1, f), h = 2, fwrite(&h, 2, 1, f);
    v = FS, fwrite(&v, 4, 1, f), v = FS * 4, fwrite(&v, 4, 1, f), h = 4, fwrite(&h, 2, 1, f), h = 16, fwrite(&h, 2, 1, f);
    fwrite("data", 1, 4, f), v = (uint32_t)n * 4u, fwrite(&v, 4, 1, f), fwrite(x, 4, (size_t)n, f);
    fclose(f);
}

static int room = -1;                                   /* the room under test (0 CRUSH .. 4 TV), -1 none */
static double run(const char *name, const int *ids, const int *vals, int nv, int sends, const char *dir, double *pk)
{
    static int16_t o16[FS * SECS * 2];
    int32_t l[QD_FX_CTL], r[QD_FX_CTL], sc[QD_FX_CTL], sd[QD_FX_CTL], sr[QD_FX_CTL], out[2 * QD_FX_CTL];
    int i, b, n = 0;
    double ss = 0;
    char path[512];
    qd_fx_init();
    qd_fx_tempo(120);
    for (i = 0; i < nv; i++)
        qd_fx_set(ids[i], vals[i]);
    *pk = 0;
    for (b = 0; b < FS * SECS / QD_FX_CTL; b++) {
        for (i = 0; i < QD_FX_CTL; i++) {
            const int t = b * QD_FX_CTL + i;
            const int gate = (t % (FS / 4)) < FS / 8 && t < FS * 3;
            const int32_t x = gate ? (int32_t)((((t * 220) % FS) * 2 - FS) * 6000.0 / FS) : 0;
            l[i] = r[i] = x;
            sc[i] = sends & 1 ? x : 0, sd[i] = sends & 2 ? x : 0, sr[i] = sends & 4 ? x : 0;
        }
        if (room >= 0) {                                /* (a room: the signal through its bus, none of it dry) */
            static int16_t rb[5][QD_FX_CTL];
            memset(rb, 0, sizeof rb);
            for (i = 0; i < QD_FX_CTL; i++) {
                rb[room][i] = (int16_t)(l[i] / 16);
                l[i] = r[i] = 0;
            }
            qd_fx_rooms((const int16_t (*)[QD_FX_CTL])rb, 0);
        }
        qd_fx_block(sc, sd, sr, l, r, out);
        for (i = 0; i < 2 * QD_FX_CTL; i++) {
            const double y = out[i];
            o16[n++] = (int16_t)(y > 32767 ? 32767 : y < -32767 ? -32767 : y);
            ss += y * y;
            if (fabs(y) > *pk)
                *pk = fabs(y);
        }
    }
    snprintf(path, sizeof path, "%s/fx-%s.wav", dir, name);
    wav(path, o16, n / 2);
    return sqrt(ss / n);
}

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : ".";
    static const struct {
        const char *name;
        int sends, n, ids[4], vals[4];
    } T[] = {
        {"dry", 0, 0, {0}, {0}},
        {"chorus", 1, 0, {0}, {0}},
        {"echo", 2, 2, {QD_FXP_DFDBK, QD_FXP_DTONE}, {90, 80}},
        {"room", 4, 1, {QD_FXP_RDECAY}, {100}},
        {"crush", 0, 3, {QD_FXP_XMIX, QD_FXP_XBITS, QD_FXP_XRATE}, {127, 4, 4}},
        {"robot", 0, 2, {QD_FXP_RBMIX, QD_FXP_RBFREQ}, {127, 70}},
        {"warp", 0, 2, {QD_FXP_WMIX, QD_FXP_WRATE}, {100, 40}},
        {"glitch", 0, 2, {QD_FXP_GMIX, QD_FXP_GCHNC}, {127, 127}},
        {"tv", 0, 3, {QD_FXP_TVMIX, QD_FXP_TVHUM, QD_FXP_TVDRV}, {127, 60, 80}},
    };
    double dry = 0, dpk;
    int k, fails = 0;
    for (k = 0; k < (int)(sizeof T / sizeof T[0]); k++) {
        double pk, rms;
        room = k >= 4 ? k - 4 : -1;                     /* (the table's order: dry, the three sends, the five rooms) */
        rms = run(T[k].name, T[k].ids, T[k].vals, T[k].n, T[k].sends, dir, &pk);
        const char *v = "ok";
        if (!k)
            dry = rms, dpk = pk;
        if (rms < 50)
            v = "FAIL silent", fails++;
        else if (k && fabs(rms - dry) < 1.0)
            v = "FAIL no effect", fails++;
        else if (rms > 20000)
            v = "FAIL runaway", fails++;
        printf("%-7s rms %7.0f  peak %6.0f  %s\n", T[k].name, rms, pk, v);
    }
    (void)dpk;
    return fails ? 1 : 0;
}
