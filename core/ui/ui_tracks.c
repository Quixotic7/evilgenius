/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* EvilGenius: the mixer and the effects (FIZZ's ui_tracks.c, redrawn on the 120 x 120 grid; the models are FIZZ's).
 *   MIX     six lift shafts: the platform the track's LEVEL, the pan a dial on top, the meter climbing beside it, the
 *           ECHO and ROOM sends two little bars under it; the selected track in the knobs' colours; a muted one
 *           crossed, a soloed one's number yellow. SENDS (ENV again): CHORUS, ECHO, ROOM as three bars a track
 *   EFFECTS the retro rooms (qd_fx.h), a drawing each, KNOB 1..4 along the foot:
 *           SENDS   the villain listening, the track's sends at the four corners
 *           CHORUS  two waves swaying apart       ECHO / 2  bouncing balls, the repeats darkening (LOFI)
 *           ROOM / 2  the room as big as SIZE     CRUSH  the staircase   ROBOT  the antenna sparking
 *           WARP    the comb's teeth             GLITCH  a slice caught and repeated   TV  the set, its scanlines
 * A held step (or the selection) frames the screen in purple: the knobs lock on it. */
#include <string.h>
#include "fz_math.h"

#include "ui.h"
#include "px.h"

static const qd_rgb FK[4] = {UI_K1, UI_K2, UI_K3, UI_K4};

static void panel_head(const char *title, int npg, int ipg, int nsel)
{
    const int x = px_text(4, 4, title, UI_K3, PX_FS, 1);
    int k;
    for (k = 0; k < npg && npg > 1; k++)
        px_rect(x + 3 + k * 4, 6, 2, 2, k == ipg ? UI_K3 : UI_G2);
    if (nsel > 0) {
        char n[12];
        ui_itoa(n, nsel);
        px_rect(104, 2, 12, 9, UI_STEP_FRAME);
        px_ctext(110, 4, n, UI_BG, PX_FS, 1);
    }
    px_dots(0, 12, 120, UI_G3, 2);
}

static void step_frame(int on)
{
    if (on) {
        px_box(0, 0, 120, 120, UI_STEP_FRAME);
        px_box(1, 1, 118, 118, UI_STEP_FRAME);
    }
}

/* ---------------------------------------------------------------- the mix: lift shafts */
void ui_mix_draw(const ui_mix_t *v)
{
    int i, k;
    panel_head(v->page ? "SENDS" : "MIX", 2, v->page ? 1 : 0, v->nsel);
    for (i = 0; i < UI_NTRACK; i++) {
        const int x = 10 + i * 20, sel = i == v->sel, mute = v->tr[i].mute == 1, solo = v->tr[i].mute == 2;
        const qd_rgb col = mute ? UI_G3 : sel ? UI_K3 : UI_G1;
        char n[4] = {(char)('1' + i), 0};
        if (ui_track_kind(i + 1) >= 0)
            ui_kind_icon(ui_track_kind(i + 1), (float)(2 * x), 34.f, 1.f, mute ? UI_G3 : UI_PK_COL[ui_track_kind(i + 1)]);
        if (!v->page) {
            const int top = 30, bot = 88, fy = bot - (bot - top) * v->tr[i].level / 127;
            const float a = -UI_PI * 0.5f + (float)v->tr[i].pan / 64.f * 2.2f;
            px_circle(x, 24, 3, sel ? UI_K2 : col, QD_NONE);   /* PAN */
            px_line(x, 24, x + (int)(fz_cosf(a) * 3.f + 0.5f), 24 + (int)(fz_sinf(a) * 3.f + 0.5f), sel ? UI_K2 : col);
            px_vline(x - 3, top, bot - top, UI_G3);     /* the shaft */
            px_vline(x + 3, top, bot - top, UI_G3);
            if (!mute && v->tr[i].meter > 0.f) {         /* the meter, beside it */
                const int h = (int)((float)(bot - top) * (v->tr[i].meter > 1.f ? 1.f : v->tr[i].meter));
                px_rect(x + 5, bot - h, 2, h, h > (bot - top) * 9 / 10 ? PX_LRED : UI_G2);
            }
            px_rect(x - 5, fy - 1, 11, 3, mute ? UI_G3 : sel ? UI_K1 : PX_YELLOW);   /* the platform: LEVEL */
            px_rect(x - 5, fy + 2, 11, 1, mute ? UI_G3 : PX_ORANGE);
            if (sel && v->locked[0])
                px_box(x - 6, fy - 2, 13, 5, FK[0]);
            for (k = 0; k < 2; k++) {                   /* the sends: ECHO, ROOM */
                const int y = 93 + k * 3, f = (k ? v->tr[i].reverb : v->tr[i].delay) * 14 / 127;
                px_hline(x - 7, y, 15, UI_G3);
                if (f > 0)
                    px_hline(x - 7, y, f, mute ? UI_G3 : sel ? FK[2 + k] : UI_G2);
                if (sel && v->locked[2 + k])
                    px_rect(x + 8, y - 1, 2, 3, FK[2 + k]);
            }
        } else {
            for (k = 0; k < 3; k++) {                   /* CHORUS, ECHO, ROOM: three bars */
                const int bx = x - 6 + k * 5, top = 24, bot = 88;
                const int val = k == 0 ? v->tr[i].chorus : k == 1 ? v->tr[i].delay : v->tr[i].reverb;
                const int h = (bot - top) * val / 127;
                px_box(bx, top, 4, bot - top, UI_G3);
                if (h > 0)
                    px_rect(bx, bot - h, 4, h, mute ? UI_G3 : sel ? FK[k] : UI_G1);
                if (sel && v->locked[k])
                    px_box(bx - 1, bot - h - 1, 6, 3, FK[k]);
            }
        }
        if (mute) {
            px_line(x - 3, 101, x + 3, 107, UI_K4);
            px_line(x + 3, 101, x - 3, 107, UI_K4);
        } else {
            px_ctext(x + 1, 101, n, solo ? UI_KSEL : sel ? UI_K3 : UI_G1, PX_FS, 1);
        }
        if (sel || solo)
            px_box(x - 5, 99, 11, 10, solo ? UI_KSEL : UI_K3);
    }
    if (v->page) {
        static const char *const S[3] = {"CHORUS", "ECHO", "ROOM"};
        for (k = 0; k < 3; k++)
            px_ctext(20 + k * 40, 112, S[k], FK[k], PX_FS, 1);
    } else if (v->last >= 0 && v->last < 4) {
        static const char *const L[4] = {"LEVEL", "PAN", "ECHO", "ROOM"};
        px_ctext(60, 112, L[v->last], FK[v->last], PX_FS, 1);
    }
    for (k = 0; k < 4; k++)                             /* the locks as chips in the head */
        if (v->locked[k] || v->lockany[k]) {
            if (v->locked[k])
                px_rect(44 + k * 14, 3, 12, 7, FK[k]);
            else
                px_box(44 + k * 14, 3, 12, 7, FK[k]);
            px_ctext(50 + k * 14, 4, v->ltxt[k], v->locked[k] ? UI_BG : FK[k], PX_FS, 1);
        }
    step_frame(v->step);
}

/* ---------------------------------------------------------------- the rooms */
static void fx_sends(const ui_fx_t *v)
{
    static const int AT[4][2] = {{14, 26}, {106, 26}, {14, 70}, {106, 70}};
    static const char *const NM[4] = {"ROOM", "CHORUS", "ECHO", "DRY"};
    int k;
    px_sprite_sc(36, 28, v->beat >= 0.f && v->beat < 0.15f ? PXS_GENIUS_TALK : PXS_GENIUS, 0, 3, QD_NONE);
    for (k = 0; k < 4; k++) {
        if (!v->has[k])
            continue;
        px_ctext(AT[k][0], AT[k][1] - 8, NM[k], UI_G1, PX_FS, 1);
        if (v->locked[k] || v->lockany[k]) {
            if (v->locked[k])
                px_rect(AT[k][0] - 12, AT[k][1] - 1, 24, 11, FK[k]);
            else
                px_box(AT[k][0] - 12, AT[k][1] - 1, 24, 11, FK[k]);
        }
        px_ctext(AT[k][0], AT[k][1] + 1, v->txt[k], v->locked[k] ? UI_BG : FK[k], PX_FB, 1);
    }
    if (v->keys)
        ui_rec_keys_foot(v->kst, 0);
    else if (v->lane)
        ui_steps_row((const ui_lane_t *)v->lane, 180.f, 58.f);
}

static void fx_chorus(const ui_fx_t *v)
{
    int x, k;
    for (k = 0; k < 2; k++) {
        int prev = -1;
        for (x = 6; x < 114; x++) {
            const float sway = fz_sinf(v->t * 2.f * v->chorus_hz + (float)k * 2.f) * v->depth * 6.f * (k ? v->cwidth : 0.3f);
            const int y = 52 - (int)(fz_sinf((float)x * 0.18f + sway) * 22.f);
            if (prev >= 0)
                px_line(x - 1, prev, x, y, k ? FK[1] : FK[0]);
            prev = y;
        }
    }
}

static void fx_echo(const ui_fx_t *v)
{
    int k;
    const float fb = v->fdbk, lofi = v->tone;
    for (k = 0; k < 7; k++) {                           /* the repeats: balls bouncing lower, darker, coarser */
        const int x = 10 + k * 15, h = (int)(56.f * fz_powf(fb > 0.05f ? fb : 0.05f, (float)k));
        const qd_rgb c = k == 0 ? UI_K3 : lofi > 0.5f && k > 2 ? UI_G2 : k < 3 ? FK[0] : UI_G1;
        const int sz = k == 0 ? 6 : lofi > 0.3f ? 5 - k / 2 : 5;
        if (h < 2)
            break;
        px_rect(x, 80 - h, sz > 1 ? sz : 1, sz > 1 ? sz : 1, c);
        px_vdots(x + 2, 80 - h + sz, h - sz, UI_G3, 2);
        if (v->ping)
            px_pset(x + 2, k & 1 ? 20 : 18, k & 1 ? FK[2] : FK[1]);
    }
    px_hline(6, 82, 108, UI_G2);
}

static void fx_echo2(const ui_fx_t *v)
{
    int k, x;
    px_text(6, 18, v->sync ? "SYNC" : "FREE", FK[0], PX_FS, 1);
    px_text(40, 18, v->ping ? "PING-PONG" : "STEREO", FK[1], PX_FS, 1);
    for (k = 0; k < 2; k++)                             /* the two sides' repeats */
        for (x = 0; x < 6; x++)
            if (!v->ping || ((x + k) & 1))
                px_rect(10 + x * 16 + k * 8, 34 + k * 14, 6, 6, x < 2 ? FK[k] : UI_G2);
    for (x = 6; x < 114; x++)                           /* WOW: the line wobbling */
        px_pset(x, 74 + (int)(fz_sinf((float)x * 0.12f + v->t * 2.f) * v->wow * 5.f), FK[3]);
}

static void fx_room(const ui_fx_t *v)
{
    const int w = 30 + (int)(v->size * 70.f), h = 20 + (int)(v->size * 40.f), x = 60 - w / 2, y = 52 - h / 2;
    int k;
    for (k = 0; k < 4; k++)                             /* the walls and their echoes inward, darker with DAMP */
        px_box(x + k * 4, y + k * 3, w - k * 8, h - k * 6, k == 0 ? FK[0] : v->damp > 0.5f && k > 1 ? UI_G3 : UI_G2);
    px_sprite(56, y + h - 17, PXS_AGENT_STAND, 0);
    px_hline(x, y + h + 3, (int)((float)w * (v->decay < 0.f ? 1.f : v->decay)), FK[2]);
}

static void fx_room2(const ui_fx_t *v)
{
    int x;
    const int gap = (int)(v->pre * 30.f);
    px_rect(6, 30, 3, 40, UI_K3);                       /* the dry hit, the gap, the tail */
    for (x = 0; x < 100 - gap; x++) {
        const int h = (int)(38.f * fz_expf(-(float)x * 0.04f));
        px_vline(10 + gap + x, 70 - h + (int)(fz_sinf((float)x * 0.5f + v->t * 3.f) * v->mod * 3.f), h + 1,
                 x & 1 ? UI_G2 : FK[1]);
    }
    px_line(6, 84, 6 + (int)(v->low * 30.f), 76, FK[2]);   /* LOW CUT: a slope */
}

static void fx_crush(const ui_fx_t *v)
{
    const int levels = 2 + (int)(v->x[0] * 14.f), step = 2 + (int)(v->x[1] * 12.f);
    int x;
    px_box(4, 16, 112, 70, UI_G3);
    for (x = 6; x < 114; x += step) {
        const float s = fz_sinf((float)(x - 6) * 0.06f);
        const int q = (int)(s * (float)levels / 2.f);
        px_rect(x, 50 - q * 30 / (levels / 2 > 0 ? levels / 2 : 1), step, 2, v->x[3] > 0.f ? FK[0] : UI_G2);
    }
}

static void fx_robot(const ui_fx_t *v)
{
    const int on = v->x[3] > 0.f, spark = on && ((int)(v->t * (4.f + v->x[0] * 20.f)) & 1);
    int x, prev = -1;
    px_sprite_sc(8, 30, spark ? PXS_ROBOT2 : PXS_ROBOT1, 0, 3, on ? QD_NONE : UI_G2);
    if (spark) {
        px_rect(23, 24, 2, 2, PX_YELLOW);
        px_rect(21, 20, 2, 2, PX_WHITE);
        px_rect(25, 17, 2, 2, PX_YELLOW);
    }
    for (x = 0; x < 64; x++) {                          /* the ring: the carrier times the voice */
        const float c = fz_sinf((float)x * (0.3f + v->x[0] * 2.f));
        const int y = 50 - (int)(fz_sinf((float)x * 0.1f) * c * 26.f);
        if (prev >= 0)
            px_line(48 + x - 1, prev, 48 + x, y, on ? FK[0] : UI_G2);
        prev = y;
    }
}

static void fx_warp(const ui_fx_t *v)
{
    const float teeth = 3.f + v->x[0] * 8.f, fb = v->x[1] * 2.f - 1.f;
    int x;
    px_box(4, 16, 112, 70, UI_G3);
    for (x = 6; x < 114; x++) {                         /* the comb's notches, deeper with the feedback */
        const float ph = (float)(x - 6) / 108.f * teeth * UI_PI + v->t * v->x[2] * 4.f;
        const float g = fz_cosf(ph) * (fb >= 0.f ? 1.f : -1.f);
        const int h = 8 + (int)((g * 0.5f + 0.5f) * (20.f + (fb < 0.f ? -fb : fb) * 40.f));
        px_vline(x, 84 - h, h, x & 1 ? FK[0] : PX_BLUE);
    }
}

static void fx_glitch(const ui_fx_t *v)
{
    const int on = v->x[3] > 0.f, rep = (int)(v->t * 6.f) % 8;
    int k;
    px_box(4, 16, 112, 70, UI_G3);
    for (k = 0; k < 13; k++) {                          /* the slices; the caught one repeated, stepping in pitch */
        const int x = 6 + k * 8, caught = on && k >= 4 && k < 10;
        const int dy = caught ? (k - 4) * (int)((v->x[2] - 0.5f) * 6.f) : 0;
        if (caught)
            px_rect(x, 40 - dy, 7, 14, k - 4 == rep % 6 ? UI_K3 : FK[0]);
        else
            px_rect(x, 44, 7, 10, UI_G2);
    }
    {
        char s[12];
        ui_itoa(s, (int)(v->x[1] * 100.f));
        strcat(s, "%");
        px_text(8, 76, s, FK[1], PX_FS, 1);
    }
}

static void fx_tv(const ui_fx_t *v)
{
    const int on = v->x[3] > 0.f, roll = (int)(v->t * 10.f * v->x[1]) % 30;
    int y;
    px_rbox(10, 16, 82, 62, UI_G1, PX_DGREY);
    px_rect(16, 20, 64, 52, PX_BLUE);
    for (y = 21; y < 72; y += 2)
        px_hline(16, y, 64, on ? PX_LBLUE : UI_G3);
    if (on && v->x[1] > 0.05f)                          /* the hum: a bar rolling up the screen */
        px_rect(16, 70 - roll - 4, 64, 3, PX_LBLUE);
    px_rect(20, 28, 28, 18, PX_BLUE);
    px_text(22, 30, "READY.", PX_WHITE, PX_FS, 1);
    if (on && ((int)(v->t * 2.f) & 1))
        px_rect(22, 38, 4, 5, PX_WHITE);
    px_rect(84, 22, 6, 6, PX_BLACK);                    /* its knobs, its legs */
    px_rect(84, 34, 6, 2, UI_G2);
    px_rect(84, 40, 6, 2, UI_G2);
    px_rect(30, 78, 4, 6, UI_G2);
    px_rect(68, 78, 4, 6, UI_G2);
    {
        int k;
        for (k = 0; k < 3; k++)                         /* DRIVE: the speaker's grille glowing */
            px_rect(98 + k * 5, 70 - (int)(v->x[2] * 30.f) * (k + 1) / 3, 3, (int)(v->x[2] * 30.f) * (k + 1) / 3 + 1, FK[2]);
    }
}

void ui_fx_draw(const ui_fx_t *v)
{
    int k;
    panel_head(v->name ? v->name : "", v->npg, v->ipg, v->nsel);
    if (v->track >= 1 && v->track <= UI_NTRACK && (v->draw == UI_FXD_OVER || v->draw <= UI_FXD_CHORUS)) {
        char n[2] = {(char)('0' + v->track), 0};
        px_rect(94, 2, 8, 8, UI_K4);
        px_ctext(98, 3, n, UI_BG, PX_FS, 1);
    }
    switch (v->draw) {
    case UI_FXD_DELAY: fx_echo(v); break;
    case UI_FXD_DELAY2: fx_echo2(v); break;
    case UI_FXD_REVERB: fx_room(v); break;
    case UI_FXD_REVERB2: fx_room2(v); break;
    case UI_FXD_CHORUS: fx_chorus(v); break;
    case UI_FXD_OVER: fx_sends(v); break;
    case UI_FXD_CRUSH: fx_crush(v); break;
    case UI_FXD_ROBOT: fx_robot(v); break;
    case UI_FXD_WARP: fx_warp(v); break;
    case UI_FXD_GLITCH: fx_glitch(v); break;
    case UI_FXD_TV: fx_tv(v); break;
    default: break;
    }
    for (k = 0; k < 4 && v->draw != UI_FXD_OVER; k++) {   /* KNOB 1..4 along the foot */
        const int cx = 15 + k * 30;
        const int f = px_text_w(v->txt[k], PX_FB, 1) > 27 ? PX_FS : PX_FB;
        if (!v->has[k])
            continue;
        px_ctext(cx, 93, v->lab[k] ? v->lab[k] : "", v->dim[k] ? UI_G3 : UI_G1, PX_FS, 1);
        if (v->locked[k] || v->lockany[k]) {
            if (v->locked[k])
                px_rect(cx - 14, 102, 28, 13, FK[k]);
            else
                px_box(cx - 14, 102, 28, 13, FK[k]);
        }
        px_ctext(cx, f == PX_FB ? 105 : 107, v->txt[k], v->locked[k] ? UI_BG : v->dim[k] ? UI_G3 : FK[k], f, 1);
        if (v->last == k)
            px_hline(cx - 9, 99, 19, FK[k]);
    }
    step_frame(v->step);
}
