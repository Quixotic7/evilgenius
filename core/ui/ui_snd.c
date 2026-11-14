/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* EvilGenius: the sound editor, SID TONE's pages (built through ui_layer.c; the model is FIZZ's ui_snd_t). FIZZ's
 * frame: brown round the track's sound, orange round a step's locks; the head (the group's page dots, STEP n, the
 * page's name, ALGORITHM's value in its cyan badge); one drawing; the foot: KNOB 1..4's labels and values in their
 * colours (a lock a chip: filled here, outlined somewhere; an LFO's or a slot's destination marked by its label).
 * The drawings:
 *   OSC     the oscillator's wave (its pulse width), the chip's three voices with this one lit, sync / ring drawn
 *   ENV     the SID's ADSR (0..15 each), LINK a chain to ENV 1
 *   FILTER  the chip's filter: its mode's response, the cutoff, the resonance's peak, the oscillators routed in
 *   F ENV   the filter envelope         CHIP  the 6581 or the 8580, key tracking, the oscillators' detune
 *   WORD    the word in a terminal: its start and end, the loop, the root key
 *   DIGI    the volume register $D418: the bits kept lit, the digi as a staircase at its rate
 *   PORT    two platforms and the glide      VOICE the unison's robots    MOD the eight slots
 *   AMP     LEVEL, velocity, DRIVE           CRUSH a sine as stairs       LFO / its WAVE: the shape, the phase */
#include "quad_voice.h"                 /* (SID TONE's waves, filter modes, LFO shapes, the slots' sources) */
static const qd_rgb SNDK[5] = {UI_K1, UI_K2, UI_K3, UI_K4, UI_KALG};
static const char *const SD_MODE_NAME[6] = {"LOWPASS", "BANDPASS", "HIGHPASS", "NOTCH", "LP+BP", "ALL"};

#define SD_TOP 14                                       /* the drawing's area (120-space) */
#define SD_BOT 88

/* ---------------------------------------------------------------- the waves */
static int32_t sd_wave(int w, float u, float pw)        /* the oscillator's wave at u (0..1): -1..1 x 1000 */
{
    const float t = u - (float)(int)u;
    float tri = t < 0.5f ? 4.f * t - 1.f : 3.f - 4.f * t, saw = 2.f * t - 1.f, pul = t < pw ? 1.f : -1.f, y;
    switch (w) {
    case QD_SW_TRI: y = tri; break;
    case QD_SW_SAW: y = saw; break;
    case QD_SW_PUL: y = pul; break;
    case QD_SW_NOI: y = (float)((((uint32_t)(u * 53.f) * 2654435761u) >> 22) & 1023u) / 512.f - 1.f; break;
    case QD_SW_TS: y = tri > saw ? saw : tri; break;    /* (the combined waves: an AND, roughly) */
    case QD_SW_PT: y = pul > 0.f ? tri : -1.f; break;
    case QD_SW_PS: y = pul > 0.f ? saw : -1.f; break;
    case QD_SW_PTS: y = pul > 0.f ? (tri > saw ? saw : tri) : -1.f; break;
    default: y = 0.f; break;
    }
    return (int32_t)(y * 1000.f);
}

static void sd_scope(int x0, int y0, int w, int h, int wave, float pw, float cycles, qd_rgb c, float sync)
{
    int i, prev = -1000;
    for (i = 0; i < w; i++) {
        float u = (float)i / (float)w * cycles;
        int y;
        if (sync > 0.f)                                 /* hard sync: the wave restarts every master cycle */
            u = (u - (float)(int)(u / sync) * sync) * 2.3f;
        y = y0 + h / 2 - (int)(sd_wave(wave, u, pw) * (h / 2 - 1) / 1000);
        if (prev > -1000 && (y > prev + 1 || y < prev - 1))
            px_vline(x0 + i, y < prev ? y : prev, (y > prev ? y - prev : prev - y) + 1, c);
        px_pset(x0 + i, y, c);
        prev = y;
    }
}

/* the chip: a little SID, its three voices' lanes, this one lit */
static void sd_chip(int x, int y, int lit, qd_rgb c)
{
    int k;
    px_rect(x, y, 28, 16, PX_DGREY);
    for (k = 0; k < 7; k++) {
        px_rect(x + 2 + k * 4, y - 2, 2, 2, UI_G1);
        px_rect(x + 2 + k * 4, y + 16, 2, 2, UI_G1);
    }
    for (k = 0; k < 3; k++)
        px_rect(x + 3 + k * 8, y + 4, 6, 8, k == lit ? c : UI_G3);
    px_pset(x + 1, y + 1, UI_G1);
}

static void sd_osc(const ui_snd_t *v)
{
    const int n = v->pv[0] < 0 ? 0 : v->pv[0] > 2 ? 2 : v->pv[0], w = v->pv[1], m = v->pv[2];
    const float pw = 0.04f + (float)v->v[3] / 127.f * 0.92f;
    px_box(4, SD_TOP + 2, 112, 42, UI_G3);
    if (w == QD_SW_OFF) {
        px_ctext(60, SD_TOP + 19, m ? "SOURCE ONLY" : "OFF", UI_G2, PX_FS, 1);
    } else {
        if (m & 1)                                      /* SYNC: the master's cycles ghosted */
            sd_scope(6, SD_TOP + 4, 108, 38, QD_SW_SAW, 0.5f, 2.f, UI_G3, 0.f);
        sd_scope(6, SD_TOP + 4, 108, 38, w, pw, 2.5f, SNDK[0], m & 1 ? 1.f : 0.f);
        if (m & 2) {                                    /* RING: the source's triangle, multiplying */
            int x;
            for (x = 6; x < 114; x += 4)
                px_pset(x, SD_TOP + 23 - (int)(sd_wave(QD_SW_TRI, (float)(x - 6) / 108.f * 7.f, 0.5f) * 16 / 1000),
                        SNDK[4]);
        }
    }
    sd_chip(8, SD_TOP + 52, n, SNDK[0]);
    if (m) {                                            /* the source: the oscillator before this one */
        const int src = (n + 2) % 3;
        px_line(11 + src * 8 + 3, SD_TOP + 50, 11 + n * 8 + 3, SD_TOP + 48, SNDK[4]);
        px_text(42, SD_TOP + 56, m == 1 ? "SYNC BY" : m == 2 ? "RING BY" : "S+R BY", SNDK[4], PX_FS, 1);
        {
            char d[2] = {(char)('1' + src), 0};
            px_text(74, SD_TOP + 56, d, UI_K3, PX_FS, 1);
        }
    } else {
        char s[8] = "OSC 1";
        s[4] = (char)('1' + n);
        px_text(42, SD_TOP + 56, s, UI_G1, PX_FS, 1);
    }
}

/* an ADSR as a polyline in x0..x0+w, y0 (top) .. y1 (foot); a, d, r of span, s 0..smax */
static void sd_adsr_shape(int a, int d, int s, int r, int span, int smax, qd_rgb c, int x0, int w, int y0, int y1)
{
    const int seg = (w - 12) / 3;
    const int xa = x0 + 2 + a * seg / span, xd = xa + d * seg / span, xr = x0 + w - 2,
              xs = xr - r * seg / span - 6, sy = y1 - s * (y1 - y0) / smax;
    px_line(x0 + 2, y1, xa, y0, c);
    px_line(xa, y0, xd, sy, c);
    px_line(xd, sy, xs, sy, c);
    px_line(xs, sy, xr, y1, c);
    px_rect(xa - 1, y0 - 1, 3, 3, SNDK[0]);
    px_rect(xd - 1, sy - 1, 3, 3, SNDK[1]);
    px_rect((xd + xs) / 2 - 1, sy - 1, 3, 3, SNDK[2]);
    px_rect(xs - 1, sy - 1, 3, 3, SNDK[3]);
}

static void sd_env(const ui_snd_t *v)
{
    px_box(4, SD_TOP + 2, 112, 70, UI_G3);
    if (v->has[4] && v->v[4]) {                         /* LINK: ENV 1's, ghosted, a chain */
        int k;
        sd_adsr_shape(v->v[0], v->v[1], v->v[2], v->v[3], 15, 15, UI_G2, 6, 108, SD_TOP + 8, SD_TOP + 66);
        for (k = 0; k < 4; k++)
            px_box(44 + k * 8, SD_TOP + 30 + (k & 1), 6, 4, SNDK[4]);
        px_ctext(60, SD_TOP + 40, "= ENV 1", SNDK[4], PX_FS, 1);
        return;
    }
    sd_adsr_shape(v->v[0], v->v[1], v->v[2], v->v[3], 15, 15, UI_K3, 6, 108, SD_TOP + 8, SD_TOP + 66);
}

static void sd_filter(const ui_snd_t *v)
{
    const int mode = v->pv[0], route = v->pv[1];
    const float fc = (float)v->v[0] / 2047.f, q = (float)v->v[1] / 15.f;
    const int xc = 8 + (int)(fc * 102.f);
    int x, prev = -1, n;
    px_box(4, SD_TOP + 2, 112, 56, UI_G3);
    for (x = 6; x < 114; x++) {                         /* the response, by the mode's bits */
        const float f = (float)(x - 6) / (float)(xc - 6 > 1 ? xc - 6 : 1);
        float lp = f < 1.f ? 1.f : 1.f / (f * f), hp = f > 1.f ? 1.f : f * f;
        const float bpv = 1.f / (1.f + (f - 1.f) * (f - 1.f) * 6.f);
        float g = 0.f;
        int y;
        if (mode == QD_QF_OFF)
            g = 1.f;
        else {
            if (mode == QD_QF_LP || mode == QD_QF_LPBP || mode == QD_QF_NOTCH || mode == QD_QF_ALL)
                g += lp;
            if (mode == QD_QF_HP || mode == QD_QF_BPHP || mode == QD_QF_NOTCH || mode == QD_QF_ALL)
                g += hp;
            if (mode == QD_QF_BP || mode == QD_QF_LPBP || mode == QD_QF_BPHP || mode == QD_QF_ALL)
                g += bpv;
            if (mode == QD_QF_NOTCH)
                g -= bpv * 1.4f;
            g += q * 1.6f / (1.f + (f - 1.f) * (f - 1.f) * 60.f);   /* the resonance's peak */
        }
        g = g < 0.f ? 0.f : g;
        y = SD_TOP + 50 - (int)(g * 26.f);
        y = y < SD_TOP + 4 ? SD_TOP + 4 : y;
        if (prev >= 0)
            px_line(x - 1, prev, x, y, mode == QD_QF_OFF ? UI_G2 : SNDK[0]);
        prev = y;
    }
    if (mode != QD_QF_OFF)
        px_vdots(xc, SD_TOP + 4, 52, UI_G1, 2);
    if (v->v[3] != 64) {                                /* the envelope's depth: an arrow at the cutoff */
        const int d = (v->v[3] - 64) / 4;
        px_line(xc, SD_TOP + 30, xc + d, SD_TOP + 30, SNDK[3]);
        px_pset(xc + d + (d > 0 ? -1 : 1), SD_TOP + 29, SNDK[3]);
        px_pset(xc + d + (d > 0 ? -1 : 1), SD_TOP + 31, SNDK[3]);
    }
    for (n = 0; n < 3; n++) {                           /* the oscillators routed in */
        char d[2] = {(char)('1' + n), 0};
        const int on = route >> n & 1;
        if (on)
            px_rect(8 + n * 10, SD_TOP + 62, 8, 9, SNDK[2]);
        else
            px_box(8 + n * 10, SD_TOP + 62, 8, 9, UI_G3);
        px_ctext(12 + n * 10, SD_TOP + 64, d, on ? UI_BG : UI_G2, PX_FS, 1);
    }
    px_text(42, SD_TOP + 64, v->pv[2] ? "8580" : "6581", UI_G1, PX_FS, 1);
}

static void sd_chipmodel(const ui_snd_t *v)
{
    const int m = v->v[0];
    int k;
    for (k = 0; k < 2; k++) {                           /* the two chips, the chosen one lit */
        const int x = 10 + k * 54, on = k == m;
        px_rect(x, SD_TOP + 6, 46, 24, on ? PX_DGREY : UI_BG);
        px_box(x, SD_TOP + 6, 46, 24, on ? SNDK[0] : UI_G3);
        px_ctext(x + 23, SD_TOP + 15, k ? "8580" : "6581", on ? UI_K3 : UI_G2, PX_FB, 1);
    }
    for (k = 0; k < 11; k++) {
        px_rect(12 + k * 4, SD_TOP + 4, 2, 2, m == 0 ? UI_G1 : UI_G3);
        px_rect(66 + k * 4, SD_TOP + 4, 2, 2, m == 1 ? UI_G1 : UI_G3);
    }
    {   /* KEY TRACK: a slant; DETUNE: two waves apart */
        const int kt = v->v[1] * 20 / 127;
        px_line(10, SD_TOP + 60, 50, SD_TOP + 60 - kt, SNDK[1]);
        px_text(10, SD_TOP + 64, "KEY", UI_G1, PX_FS, 1);
        sd_scope(60, SD_TOP + 38, 52, 22, QD_SW_SAW, 0.5f, 3.f, SNDK[2], 0.f);
        sd_scope(60 + v->v[2] / 16, SD_TOP + 38, 52 - v->v[2] / 16, 22, QD_SW_SAW, 0.5f, 3.f, UI_G1, 0.f);
    }
}

static void sd_word(const ui_snd_t *v)
{
    const int s0 = 8 + v->v[2] * 104 / 127, s1 = 8 + v->v[3] * 104 / 127;
    int x;
    px_rect(4, SD_TOP + 2, 112, 66, UI_BG);
    px_box(4, SD_TOP + 2, 112, 66, PX_GREEN);
    if (!v->v[0]) {
        px_ctext(60, SD_TOP + 30, "NO WORD", UI_G2, PX_FB, 1);
        return;
    }
    if (px_text_w(v->txt[0], PX_FB, 1) <= 108)
        px_ctext(60, SD_TOP + 6, v->txt[0], PX_LGREEN, PX_FB, 1);
    else
        px_ctext(60, SD_TOP + 7, v->txt[0], PX_LGREEN, PX_FS, 1);
    for (x = 8; x < 112; x++) {                         /* a word's digi: bursts, its hiss between */
        const int in = x >= s0 && x <= s1;
        const uint32_t h = (uint32_t)(x * 2654435761u + (uint32_t)v->v[0] * 40503u);
        const int env = (x - 8) % 26 < 18 ? 9 : 3, a = (int)((h >> 27) % (uint32_t)(env + 1));
        px_vline(x, SD_TOP + 38 - a, 2 * a + 1, in ? PX_LGREEN : PX_GREEN);
    }
    px_vline(s0, SD_TOP + 22, 32, SNDK[2]);             /* START, END */
    px_vline(s1, SD_TOP + 22, 32, SNDK[3]);
    if (v->v[4]) {                                      /* the loop */
        px_hline(s0, SD_TOP + 57, s1 - s0, SNDK[4]);
        px_text(s0 + 1, SD_TOP + 59, v->v[4] == 2 ? "BOUNCE" : "LOOP", SNDK[4], PX_FS, 1);
    }
}

static void sd_digi(const ui_snd_t *v)
{
    const int bits = v->v[0] < 1 ? 1 : v->v[0] > 4 ? 4 : v->v[0], rate = v->v[1], lvl = v->v[2];
    const int step = 2 + (7 - rate) * 2, levels = 1 << bits;
    int k, x;
    px_text(6, SD_TOP + 4, "$D418", UI_G1, PX_FS, 1);
    for (k = 0; k < 4; k++) {                           /* the volume register's four bits: those kept lit */
        const int on = 3 - k < bits;
        if (on)
            px_rect(34 + k * 20, SD_TOP + 2, 16, 9, SNDK[0]);
        else
            px_box(34 + k * 20, SD_TOP + 2, 16, 9, UI_G3);
        {
            char d[2] = {(char)('3' - k), 0};
            px_ctext(42 + k * 20, SD_TOP + 4, d, on ? UI_BG : UI_G3, PX_FS, 1);
        }
    }
    px_box(4, SD_TOP + 16, 112, 54, UI_G3);
    for (x = 6; x < 114; x += step) {                   /* the digi: a sine at the bits and the rate */
        const float s = fz_sinf((float)(x - 6) * 0.11f) * (float)lvl / 127.f;
        int q = (int)((s * 0.5f + 0.5f) * (float)(levels - 1) + 0.5f);
        const int y = SD_TOP + 66 - q * 46 / (levels - 1 > 0 ? levels - 1 : 1);
        px_rect(x, y, step, 2, SNDK[1]);
    }
    if (v->v[3])
        px_text(84, SD_TOP + 60, "BOOST", SNDK[3], PX_FS, 1);
}

static void sd_adsr(const ui_snd_t *v)
{
    px_box(4, SD_TOP + 2, 112, 70, UI_G3);
    sd_adsr_shape(v->v[0], v->v[1], v->v[2], v->v[3], 127, 127, UI_K3, 6, 108, SD_TOP + 8, SD_TOP + 66);
}

static void sd_port(const ui_snd_t *v)
{
    const int on = v->v[0], tw = 6 + v->v[1] * 40 / 127;
    int i;
    for (i = 0; i < 4; i++)
        px_sprite(8 + i * 8, SD_TOP + 56, PXS_LIFT, 0);
    for (i = 0; i < 5; i++)
        px_sprite(64 + i * 8, SD_TOP + 20, PXS_LIFT, 0);
    if (on) {
        px_line(40, SD_TOP + 56, 40 + tw, SD_TOP + 21, SNDK[1]);
        px_line(40, SD_TOP + 57, 40 + tw, SD_TOP + 22, SNDK[1]);
    } else {
        px_vdots(52, SD_TOP + 22, 34, UI_G2, 2);
    }
    if (on == 2)
        px_dots(40, SD_TOP + 60, tw + 6, SNDK[0], 2);
    px_sprite(14, SD_TOP + 40, PXS_AGENT_RUN1, 0);
    if (v->v[3])
        px_text(8, SD_TOP + 64, "HR", SNDK[3], PX_FS, 1);
}

static void sd_voice(const ui_snd_t *v)
{
    const int mono = v->v[0], n = v->v[1] < 1 ? 1 : v->v[1] > 8 ? 8 : v->v[1];
    int k;
    for (k = 0; k < 8; k++) {
        const int x = 6 + (k % 4) * 28, y = SD_TOP + 4 + (k / 4) * 32;
        const int on = k < n, dim = v->limit > 0 && k >= v->limit;
        px_sprite_sc(x + 3 + (on ? (k - n / 2) * v->v[2] / 127 : 0), y, on ? PXS_ROBOT2 : PXS_ROBOT1, 0, 2,
                     on ? (dim ? UI_G2 : QD_NONE) : UI_G3);
    }
    if (mono)
        px_text(4, SD_TOP + 68, "MONO", SNDK[0], PX_FS, 1);
}

static void sd_mod(const ui_snd_t *v)
{
    static const char *const SRC[QD_MS_N] = {"-", "VEL", "KEY", "MW", "AT", "PB", "BR", "RAND", "FENV"};
    int k;
    for (k = 0; k < QD_NMOD; k++) {
        const int y = SD_TOP + 1 + k * 9, sel = k == v->mod_sel, src = v->mod_src[k];
        const qd_rgb c = sel ? UI_K3 : src ? UI_G1 : UI_G3;
        char d[2] = {(char)('1' + k), 0};
        if (sel)
            px_box(2, y - 1, 116, 9, SNDK[4]);
        px_text(4, y + 1, d, c, PX_FS, 1);
        px_text(10, y + 1, src >= 0 && src < QD_MS_N ? SRC[src] : "?", sel ? SNDK[0] : c, PX_FS, 1);
        px_text(30, y + 1, v->mod_dst[k] ? v->mod_dst[k] : "-", sel ? SNDK[1] : c, PX_FS, 1);
        if (src) {                                      /* the depth: a bar from the middle */
            const int dep = v->mod_dep[k] * 22 / 127;
            px_hline(94, y + 3, 1, UI_G2);
            if (dep > 0)
                px_rect(94, y + 2, dep, 3, SNDK[2]);
            else if (dep < 0)
                px_rect(94 + dep, y + 2, -dep, 3, SNDK[2]);
        }
    }
}

static void sd_amp(const ui_snd_t *v)
{
    const int lvl = v->v[0] * 60 / 127, vel = v->v[1], drv = v->v[2];
    int x;
    px_box(10, SD_TOP + 6, 10, 62, UI_G3);              /* LEVEL a fader */
    px_rect(11, SD_TOP + 67 - lvl, 8, lvl, SNDK[0]);
    for (x = 0; x < 30; x++)                            /* VEL a wedge */
        px_vline(28 + x, SD_TOP + 67 - x * (vel + 20) / 147, x * (vel + 20) / 147 + 1, x & 1 ? UI_G3 : SNDK[1]);
    {   /* DRIVE: a sine through the clip */
        int prev = -1;
        for (x = 0; x < 50; x++) {
            float s = fz_sinf((float)x * 0.25f) * (1.f + (float)drv / 32.f);
            int y;
            s = s > 1.f ? 1.f : s < -1.f ? -1.f : s;
            y = SD_TOP + 36 - (int)(s * 22.f);
            if (prev >= 0)
                px_line(64 + x - 1, prev, 64 + x, y, SNDK[2]);
            prev = y;
        }
    }
}

static void sd_crush(const ui_snd_t *v)
{
    const int bits = v->v[0], srr = v->v[1];
    const int levels = bits ? 2 + (127 - bits) / 10 : 64, step = srr ? 1 + srr / 8 : 1;
    int x;
    px_box(4, SD_TOP + 2, 112, 70, UI_G3);
    for (x = 6; x < 114; x += step) {
        const float s = fz_sinf((float)(x - 6) * 0.07f);
        const int q = (int)(s * (float)levels / 2.f);
        px_rect(x, SD_TOP + 37 - q * 30 / (levels / 2 > 0 ? levels / 2 : 1), step, 2, SNDK[0]);
    }
}

static int32_t lfo_wave(int w, float u)                 /* -1000..1000 */
{
    const float t = u - (float)(int)u;
    switch (w) {
    case QD_LW_TRI: return (int32_t)((t < 0.5f ? 4.f * t - 1.f : 3.f - 4.f * t) * 1000.f);
    case QD_LW_SINE: return (int32_t)(fz_sinf(t * UI_TAU) * 1000.f);
    case QD_LW_SAW: return (int32_t)((1.f - 2.f * t) * 1000.f);
    case QD_LW_SQR: return t < 0.5f ? 1000 : -1000;
    case QD_LW_SH: return (int32_t)(((((uint32_t)(u * 4.f + 7.f) * 2654435761u) >> 21) & 2047u) - 1024u);
    case QD_LW_EXP: return (int32_t)((1.f - t) * (1.f - t) * (1.f - t) * 2000.f - 1000.f);
    default: return (int32_t)((2.f * t - 1.f) * 1000.f);
    }
}

static void sd_lfo(const ui_snd_t *v)
{
    const int w = v->pv[0], dep = v->v[2] - 64;
    const float cyc = 1.f + (float)v->v[0] / 32.f;
    int x, prev = -1;
    px_box(4, SD_TOP + 2, 112, 70, UI_G3);
    px_hline(5, SD_TOP + 37, 110, UI_G3);
    for (x = 0; x < 108; x++) {
        const int y = SD_TOP + 37 - (int)(lfo_wave(w, (float)x / 108.f * cyc + v->t * cyc * 0.2f) * dep * 30 / 64000);
        if (prev >= 0)
            px_line(6 + x - 1, prev, 6 + x, y, UI_LFO_COL[v->arg % 3]);
        prev = y;
    }
}

static void sd_lfoshape(const ui_snd_t *v)
{
    const int w = v->v[0], tr = v->v[2];
    int n, x;
    px_box(4, SD_TOP + 2, 112, 70, UI_G3);
    for (n = 0; n < 3; n++) {                           /* three notes, the wave restarting by its TRIG */
        const int x0 = 6 + n * 36;
        int prev = -1;
        px_rect(x0, SD_TOP + 66, 30, 3, UI_G2);
        for (x = 0; x < 34; x++) {
            float u = (float)x / 34.f + (float)v->v[1] / 127.f;
            int y;
            if (tr == QD_LT_FREE)
                u += (float)n;
            if ((tr == QD_LT_ONE && x > 30) || (tr == QD_LT_HALF && x > 16))
                u = tr == QD_LT_HALF ? 0.5f : 0.99f;
            y = SD_TOP + 34 - (int)(lfo_wave(w, u) * 24 / 1000);
            if (prev >= 0)
                px_line(x0 + x - 1, prev, x0 + x, y, UI_LFO_COL[v->arg % 3]);
            prev = y;
        }
        px_rect(x0, SD_TOP + 34 - (int)(lfo_wave(w, (float)v->v[1] / 127.f) * 24 / 1000) - 1, 3, 3, SNDK[1]);
    }
}

/* ---------------------------------------------------------------- the keys strip, the dice, the popup */
static void sd_keys_strip(const ui_snd_t *v)
{
    static const uint8_t BLK[27] = {0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0};
    int i, w = 0;
    if (v->keys == 1) {
        for (i = 0; i < 16; i++)
            ui_rec_key(8.f + (float)i * 14.f, 160.f, 12.f, 12.f, v->kst[i]);
        return;
    }
    for (i = 0; i < 27; i++) {
        if (!BLK[i])
            ui_rec_key(8.f + (float)(w++) * 14.f, 162.f, 12.f, 10.f, v->kst[i]);
        else
            px_rect(4 + w * 7 - 2, 79, 3, 2, (v->kst[i] & 4) || (v->kst[i] & 3) ? UI_REC_KEY : UI_G3);
    }
}

static void sd_dice(float u, float t, int shake)
{
    const int dx = shake ? (int)(fz_sinf(t * 40.f) * 3.f * u) : 0, face = 1 + (int)(t * 7.f) % 6;
    static const uint8_t PIP[7][7] = {{0}, {4}, {0, 8}, {0, 4, 8}, {0, 2, 6, 8}, {0, 2, 4, 6, 8}, {0, 2, 3, 5, 6, 8}};
    int k;
    px_rect(16, 20, 88, 64, UI_BG);
    px_rbox(44 + dx, 30, 32, 32, UI_K3, UI_K3);
    for (k = 0; k < face; k++) {
        const int p = PIP[face][k];
        px_rect(48 + dx + (p % 3) * 9, 34 + (p / 3) * 9, 5, 5, UI_BG);
    }
    px_ctext(60, 70, shake ? "SHAKE" : "ROLL", UI_K3, PX_FS, 1);
}

/* ---------------------------------------------------------------- a MIDI track's page */
static void sd_midi(const ui_snd_t *v)
{
    const qd_rgb hc = v->step ? UI_K3 : UI_MIDI_HEAD;
    char n[12], head[16];
    int k;
    px_box(0, 0, 120, 120, v->step ? UI_SND_FRAME_STEP : UI_SND_FRAME_TRACK);
    px_box(1, 1, 118, 118, v->step ? UI_SND_FRAME_STEP : UI_SND_FRAME_TRACK);
    for (k = 0; k < 7; k++)
        px_rect(5 + k * 4, 5, 2, 2, k == v->ipg ? hc : UI_G2);
    head[0] = 0;
    if (v->step)
        cat(cat(head, "STEP "), ui_itoa(n, v->step));
    else
        cat(head, "MIDI");
    px_text(36, 4, head, hc, PX_FS, 1);
    px_rtext(115, 4, v->mch ? ui_itoa(n, v->mch) : "OFF", v->mch ? UI_KALG : UI_G2, PX_FS, 1);
    for (k = 0; k < 4; k++) {
        const int x = 8 + k * 28, cx = x + 10;
        char lab[8] = "CC ";
        px_box(x, 16, 20, 66, UI_G3);
        if (v->has[k])
            px_rect(x + 1, 81 - v->v[k] * 64 / 127, 18, v->v[k] * 64 / 127 + 1, SNDK[k]);
        else
            px_vdots(cx, 18, 62, UI_G2, 3);
        if (v->shift) {
            ui_itoa(n, v->cc[k]);
            px_ctext(cx, 40, n, v->shift_k == k ? UI_K3 : SNDK[k], PX_FB, 1);
        }
        cat(lab, ui_itoa(n, v->cc[k]));
        px_ctext(cx, 95, lab, UI_G1, PX_FS, 1);
        if (v->last == k)
            px_hline(cx - 9, 101, 18, SNDK[k]);
        if (v->has[k]) {
            ui_itoa(n, v->v[k]);
            if (v->step && v->locked[k]) {
                px_rect(cx - 12, 104, 24, 11, SNDK[k]);
                px_ctext(cx, 106, n, UI_BG, PX_FB, 1);
            } else {
                px_ctext(cx, 106, n, SNDK[k], PX_FB, 1);
            }
        }
    }
}

/* ---------------------------------------------------------------- the page */
void ui_snd_draw(const ui_snd_t *v)
{
    char head[40], n[12];
    int x, k;
    const qd_rgb hc = v->step ? UI_K3 : UI_TRACK_COL;
    const qd_rgb fc = v->step ? UI_SND_FRAME_STEP : UI_SND_FRAME_TRACK;
    if (v->midi) {
        sd_midi(v);
        return;
    }
    px_box(0, 0, 120, 120, fc);
    px_box(1, 1, 118, 118, fc);
    head[0] = 0;
    if (v->step)
        cat(cat(cat(head, "STEP "), ui_itoa(n, v->step)), " \xc2\xb7 ");
    cat(head, v->name ? v->name : "");
    x = 4;
    for (k = 0; k < v->npg && v->npg > 1; k++)
        px_rect(x + k * 4, 5, 2, 2, k == v->ipg ? hc : UI_G2);
    if (v->npg > 1)
        x += v->npg * 4 + 2;
    px_text(x, 4, head, hc, PX_FS, 1);
    if (v->has[4]) {                                    /* ALGORITHM's value: the badge, the value (a lock: a chip) */
        const int w = px_text_w(v->txt[4], PX_FS, 1);
        const int bx = 115 - w;
        if (v->locked[4])
            px_rect(bx - 2, 3, w + 4, 7, SNDK[4]);
        else if (v->lockany[4])
            px_box(bx - 2, 2, w + 4, 9, SNDK[4]);
        px_text(bx, 4, v->txt[4], v->locked[4] ? UI_BG : SNDK[4], PX_FS, 1);
        px_rect(bx - 10, 3, 7, 7, SNDK[4]);
        px_ctext(bx - 6, 4, "A", UI_BG, PX_FS, 1);
    }
    px_dots(3, 12, 114, UI_G3, 2);
    switch (v->draw) {
    case UI_SD_OSC: sd_osc(v); break;
    case UI_SD_ENV: sd_env(v); break;
    case UI_SD_FILTER: sd_filter(v); break;
    case UI_SD_ADSR: sd_adsr(v); break;
    case UI_SD_CHIP: sd_chipmodel(v); break;
    case UI_SD_WORD: sd_word(v); break;
    case UI_SD_DIGI: sd_digi(v); break;
    case UI_SD_PORT: sd_port(v); break;
    case UI_SD_VOICE: sd_voice(v); break;
    case UI_SD_MOD: sd_mod(v); break;
    case UI_SD_DRIVE: sd_amp(v); break;
    case UI_SD_CRUSH: sd_crush(v); break;
    case UI_SD_LFO: sd_lfo(v); break;
    case UI_SD_LFOSHAPE: sd_lfoshape(v); break;
    default: break;
    }
    if (v->keys)
        sd_keys_strip(v);
    /* the foot: four columns, 29 wide: the label, the turned one underlined, the value (a lock a chip) */
    px_dots(3, 89, 114, UI_G3, 2);
    for (k = 0; k < 4; k++) {
        const int x0 = 3 + k * 29, cx = x0 + 14;
        const int lk = v->locked[k] || v->lockany[k];
        const qd_rgb tc = v->locked[k] ? UI_BG : SNDK[k];
        int f = PX_FB;
        if (!v->has[k])
            continue;
        if (v->lfomark[k]) {                            /* an LFO's destination: its number in its colour */
            const int lf = v->lfomark[k] & 1u ? 0 : v->lfomark[k] & 2u ? 1 : 2;
            px_rect(x0, 92, 3, 5, UI_LFO_COL[lf]);
        } else if (v->modmark[k]) {                     /* a modulation slot's */
            px_rect(x0, 92, 3, 5, UI_K2);
        }
        px_ctext(cx + 1, 92, v->lab[k] ? v->lab[k] : "", v->locked[k] ? UI_K3 : UI_G1, PX_FS, 1);
        if (v->lk && v->lk_k == k && v->lk_ok) {        /* being mapped to an LFO: a little wave */
            int i;
            for (i = 0; i < 16; i++)
                px_pset(cx - 8 + i, 99 + (int)(fz_sinf((float)i * 0.8f + v->t * 6.f) * 1.5f),
                        v->lk == 4 ? UI_K2 : UI_LFO_COL[(v->lk - 1) % 3]);
        } else if (v->last == k) {
            px_hline(cx - 9, 99, 19, SNDK[k]);
        }
        if (px_text_w(v->txt[k], PX_FB, 1) > 26)
            f = PX_FS;
        if (lk) {
            if (v->locked[k])
                px_rect(x0, 102, 28, 13, SNDK[k]);
            else
                px_box(x0, 102, 28, 13, SNDK[k]);
        }
        px_ctext(cx + 1, f == PX_FB ? 105 : 107, v->txt[k], tc, f, 1);
    }
    if (v->lk && v->lk_name) {                          /* an LFO key held: the mapping, over the drawing */
        char s[24] = "LFO ";
        px_rect(10, 30, 100, 34, UI_BG);
        px_box(10, 30, 100, 34, v->lk == 4 ? UI_K2 : UI_LFO_COL[(v->lk - 1) % 3]);
        if (v->lk < 4)
            s[4] = (char)('0' + v->lk), s[5] = 0;
        else
            strcpy(s, "MOD");
        px_ctext(60, 34, s, v->lk == 4 ? UI_K2 : UI_LFO_COL[(v->lk - 1) % 3], PX_FS, 1);
        px_ctext(60 + (v->lk_shake > 0.f ? (int)(fz_sinf(v->t * 50.f) * 3.f * v->lk_shake) : 0), 42, v->lk_name,
                 v->lk_ok ? UI_K3 : UI_G2, PX_FB, 1);
        px_rect(60, 54, (int)(v->lk_depth * 40.f), 4, UI_K3);
        px_vline(60, 52, 8, UI_G1);
    }
    if (v->rnd_kind)
        sd_dice(v->rnd_u, v->t, v->rnd_kind == 1);
    if (v->fpop) {                                      /* B4 held: the filter's modes */
        int k2;
        px_rect(6, 16, 108, 70, UI_BG);
        px_box(6, 16, 108, 70, SNDK[4]);
        for (k2 = 0; k2 < 6; k2++) {
            const int bx = 10 + (k2 % 2) * 52, by = 20 + (k2 / 2) * 21, on = k2 == v->fpop_sel;
            char d[2] = {(char)('1' + k2), 0};
            px_box(bx, by, 48, 18, on ? SNDK[4] : UI_G3);
            px_text(bx + 2, by + 2, d, on ? SNDK[4] : UI_G2, PX_FS, 1);
            px_ctext(bx + 26, by + 10, SD_MODE_NAME[k2], on ? UI_K3 : UI_G1, PX_FS, 1);
        }
    }
}
