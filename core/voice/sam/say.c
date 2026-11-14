/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* EvilGenius: SAY, SAM speaking live (say.h). SAM (this directory, see README.md) renders a word at 22050 Hz into its
 * buffer; here the silence at either end is trimmed, the rest box-filtered down to QD_VOX_FS, normalised and
 * quantised to the 4 bits of the SID's volume register, faded in and out (no click), two samples a byte. The cache
 * is QD_SAY_SLOTS words, the least recently wanted replaced; a slot being rewritten has no key (no voice finds it). */
#include <string.h>
#include "say.h"
#include "quad_voice.h"
#include "names.h"
#include "sam_names.h"                  /* (last of all but SAM's own: its macros rename SAM's globals) */
#include "sam.h"
#include "reciter.h"

#define SAY_LEN (QD_VOX_FS * QD_SAY_TENTHS / 10u)      /* a slot's samples */
typedef struct {
    volatile uint32_t key;              /* (0: empty, or being written) */
    uint32_t len, used;
    uint8_t data[SAY_LEN / 2u];
} say_slot_t;
static say_slot_t slots[QD_SAY_SLOTS];
static uint32_t say_clock;

int qd_say_text(int seed, char *out)
{
    uint32_t s;
    out[0] = 0;
    if (seed <= 0)
        return 0;
    s = (uint32_t)seed * 2654435761u + 12345u;         /* (the name generators' seed: one word a value) */
    if (seed % 3 == 0)
        qd_name_rnd(&s, out);                           /* a third: namesizer's pairs ("WARM CAT") */
    else
        qd_name_phonic(&s, out);                        /* the rest: phonic nonsense ("SMAIRSH") */
    return out[0] != 0;
}

int qd_say_default_voice(const int16_t *p)
{
    return p[QD_QP_SSPD] == QD_SAY_SPD0 && p[QD_QP_SPIT] == QD_SAY_PIT0 && p[QD_QP_STHR] == QD_SAY_THR0 &&
           p[QD_QP_SMTH] == QD_SAY_MTH0;
}

uint32_t qd_say_key(const int16_t *p)
{
    const int say = p[QD_QP_SAY], w = p[QD_QP_WORD];
    int32_t v[5];
    uint32_t h = 2166136261u;
    int k;
    if (say > 0)
        v[0] = 1000 + say;
    else if (w >= 1 && w <= qd_vox_nwords() && !qd_say_default_voice(p))
        v[0] = w;
    else
        return 0;
    v[1] = p[QD_QP_SSPD], v[2] = p[QD_QP_SPIT], v[3] = p[QD_QP_STHR], v[4] = p[QD_QP_SMTH];
    for (k = 0; k < 5; k++)
        h = (h ^ (uint32_t)v[k]) * 16777619u;
    return h ? h : 1u;
}

const uint8_t *qd_say_get(uint32_t key, uint32_t *len)
{
    int i;
    if (!key)
        return 0;
    for (i = 0; i < QD_SAY_SLOTS; i++)
        if (slots[i].key == key) {
            *len = slots[i].len;
            return slots[i].data;
        }
    return 0;
}

static int clampi(int x, int a, int b) { return x < a ? a : x > b ? b : x; }
static int dev(int x) { return x < 128 ? 128 - x : x - 128; }

/* SAM speaks p's word; its samples into s (len 0: nothing came out) */
static void say_render(const int16_t *p, say_slot_t *s)
{
    static char in[256];
    const int say = p[QD_QP_SAY];
    const unsigned char *b;
    uint32_t n, a, e, m, j, peak = 0, i;
    s->len = 0;
    if (say > 0) {
        char t[16];
        if (!qd_say_text(say, t))
            return;
        strcpy(in, t);
        strcat(in, "[");                                /* (the reciter's end mark: it writes the phonemes back) */
        if (!TextToPhonemes((unsigned char *)in))
            return;
    } else {
        strncpy(in, qd_vox_word_phon(p[QD_QP_WORD]), 240);
        in[240] = 0;
        strcat(in, "\x9b");                             /* (SAM's end of input) */
    }
    SetInput(in);
    SetSpeed((unsigned char)clampi(p[QD_QP_SSPD], 1, 255));
    SetPitch((unsigned char)clampi(p[QD_QP_SPIT], 0, 255));
    SetThroat((unsigned char)clampi(p[QD_QP_STHR], 0, 255));
    SetMouth((unsigned char)clampi(p[QD_QP_SMTH], 0, 255));
    if (!SAMMain())
        return;
    n = (uint32_t)GetBufferLength() / 50u;
    if (n > SAM_BUF_LEN)
        n = SAM_BUF_LEN;
    b = (const unsigned char *)GetBuffer();
    for (a = 0; a < n && dev(b[a]) < 8; a++)            /* the silence at either end */
        ;
    for (e = n; e > a && dev(b[e - 1]) < 8; e--)
        ;
    for (i = a; i < e; i++)
        if ((uint32_t)dev(b[i]) > peak)
            peak = (uint32_t)dev(b[i]);
    if (peak < 8u)
        return;
    m = (e - a) * QD_VOX_FS / 22050u;
    if (m > SAY_LEN)
        m = SAY_LEN;
    m &= ~1u;
    memset(s->data, 0x88, sizeof s->data);
    for (j = 0; j < m; j++) {                           /* box-filtered to QD_VOX_FS, normalised, 4 bits */
        const uint32_t i0 = a + j * 22050u / QD_VOX_FS, i1 = a + (j + 1u) * 22050u / QD_VOX_FS;
        int32_t sum = 0, cnt = 0, x, q;
        uint32_t f = 60u;                               /* (10 ms fades) */
        for (i = i0; i < i1 && i < e; i++, cnt++)
            sum += (int32_t)b[i] - 128;
        x = cnt ? sum / cnt : 0;
        if (j < f)
            x = x * (int32_t)j / (int32_t)f;
        else if (m - j < f)
            x = x * (int32_t)(m - j) / (int32_t)f;
        q = 8 + (x * 15 + (x < 0 ? -(int32_t)peak : (int32_t)peak)) / (2 * (int32_t)peak);
        q = clampi(q, 0, 15);
        if (j & 1u)
            s->data[j / 2u] = (uint8_t)((s->data[j / 2u] & 0xF0u) | (uint32_t)q);
        else
            s->data[j / 2u] = (uint8_t)((uint32_t)q << 4 | (s->data[j / 2u] & 0x0Fu));
    }
    s->len = m;
}

int qd_say_want(const int16_t *p)
{
    const uint32_t key = qd_say_key(p);
    say_slot_t *s = &slots[0];
    int i;
    if (!key)
        return 0;
    for (i = 0; i < QD_SAY_SLOTS; i++)
        if (slots[i].key == key) {
            slots[i].used = ++say_clock;
            return 0;
        }
    for (i = 1; i < QD_SAY_SLOTS; i++)                  /* an empty slot, else the least recently wanted */
        if (slots[i].used < s->used)
            s = &slots[i];
    s->key = 0;
    say_render(p, s);
    s->used = ++say_clock;
    s->key = key;                                       /* (last: a voice finds it whole) */
    return 1;
}

void qd_say_reset(void)
{
    memset(slots, 0, sizeof slots);
    say_clock = 0;
}
