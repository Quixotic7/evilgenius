/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* EvilGenius: screen 1, idle (FIZZ's logo screen, redrawn): the villain's control room at 120 x 120.
 *   the villain   at his desk between two consoles (their screens blink), 2x; he grins while the title lands and,
 *                 playing, on each beat
 *   the title     EVIL / GENIUS in the BIG font at 2x. FIZZ's word phases are kept (ui_idle_word): off at first (the
 *                 room shows READY. and a blinking cursor), the letters drop in one by one, the title holds, then
 *                 its letters fall away one by one, out of the bottom
 *   the floor     a girder; the agent runs it end to end and back once a loop, somersaulting the patrol robot
 *                 whenever he meets it; a lift rides its shaft at the right
 *   the scroller  under the floor, between two raster lines, a line of text crawling right to left, once a loop
 *   playing       the border flashes on each beat (the downbeat brighter), the consoles step with the beats
 * The loop (FZ_LOOP s) is seamless: everything moves whole cycles a loop. Deterministic: a pure function of the time
 * and the beats. */
#include <math.h>
#include "fz_math.h"

#include "ui.h"
#include "px.h"
#include "../seq/qd_div.h"                    /* (qd_ratio_f) */

#define FZ_LOOP 11.f

/* the word's timing (loop seconds), FIZZ's: the tests read the phases through ui_idle_word */
#define WD_GATHER 4.0f                                  /* the first letter drops .. */
#define WD_STAGGER 0.12f
#define WD_TRAVEL 0.42f
#define WD_SOLID0 4.50f
#define WD_SOLID1 4.62f
#define WD_PFADE1 4.70f                                 /* .. all of them landed by here */
#define WD_BREAK0 8.78f                                 /* the letters start to fall away .. */
#define WD_BREAK1 8.90f
#define WD_FIZZ 8.86f
#define WD_FSTAG 0.6f
#define WD_FADE 0.9f                                    /* .. all gone by 10.36 s */

static float clamp01(float x) { return x < 0.f ? 0.f : x > 1.f ? 1.f : x; }
static float seg(float t, float a, float b) { return clamp01((t - a) / (b - a)); }
static uint32_t ih(uint32_t a, uint32_t b)
{
    uint32_t h = a * 0x9E3779B1u ^ (b + 0x7F4A7C15u) * 0x85EBCA77u;
    h ^= h >> 15;
    h *= 0x2C1B3C6Du;
    h ^= h >> 12;
    return h;
}

void ui_idle_word(float t, float *solid, float *parts)
{
    const float u = fmodf(t, FZ_LOOP);
    float s = 0.f, p = 0.f;
    if (u >= WD_GATHER && u < WD_PFADE1) {              /* dropping in, then landed */
        s = ui_ease(seg(u, WD_SOLID0, WD_SOLID1));
        p = 1.f - ui_ease(seg(u, WD_SOLID1 - 0.06f, WD_PFADE1));
    } else if (u >= WD_PFADE1 && u < WD_BREAK0) {       /* the hold */
        s = 1.f;
    } else if (u >= WD_BREAK0 && u < WD_FIZZ + WD_FSTAG + WD_FADE) {   /* falling away */
        s = 1.f - seg(u, WD_BREAK0, WD_BREAK1);
        p = seg(u, WD_BREAK0, WD_BREAK0 + 0.08f) * (1.f - seg(u, WD_FIZZ + WD_FSTAG, WD_FIZZ + WD_FSTAG + WD_FADE));
    }
    if (solid)
        *solid = s;
    if (parts)
        *parts = p;
}

/* ---------------------------------------------------------------- the room's layout (120-space) */
#define CX 56                                           /* the room's middle (the shaft takes the right) */
#define VIL_X (CX - 16)                                 /* the villain, 2x: 32 x 32 */
#define VIL_Y 0
#define DESK_Y 32
#define T1_Y 40                                         /* EVIL's top */
#define T2_Y 58                                         /* GENIUS's top */
#define FLOOR_Y 96
#define SHAFT_X 108                                     /* the lift's shaft: rails at 108 and 117 */
#define RUN_X0 2
#define RUN_X1 96                                       /* the agent's run (his left edge) */
#define ROBOT_C 62                                      /* the robot's beat (its middle) */

/* the title's letters: their place, the time each lands (dropping in) and leaves (falling away) */
static const char *const TITLE[2] = {"EVIL", "GENIUS"};
#define NLET 10
static void letter(int k, int *row, int *i)
{
    *row = k < 4 ? 0 : 1;
    *i = k < 4 ? k : k - 4;
}
static int letter_x(int row, int i)
{
    const int w = px_text_w(TITLE[row], PX_FB, 2);
    return CX - (w + 1) / 2 + i * 16;
}

/* how far a letter is above its place (dropping in) or below it (falling away), whole pixels; -1000: not shown */
static int letter_dy(float u, int k)
{
    const int land_order = k;                           /* dropping in reading order, falling in a scrambled one */
    float t;
    if (u < WD_GATHER)
        return -1000;
    if (u < WD_PFADE1) {                                /* dropping in: a fall from above the screen, landing */
        const float t0 = WD_GATHER + (WD_PFADE1 - WD_GATHER - 0.24f) * (float)land_order / (float)(NLET - 1);
        if (u < t0)
            return -1000;
        t = clamp01((u - t0) / 0.24f);
        return -(int)((1.f - t * t) * 70.f);
    }
    if (u < WD_BREAK0)
        return 0;
    {                                                   /* falling away: each from its own moment, gravity */
        int order = 0, j;
        float t1;
        for (j = 0; j < NLET; j++)                      /* (a fixed permutation: the rank of k's hash) */
            if (ih((uint32_t)j, 7u) < ih((uint32_t)k, 7u))
                order++;
        t1 = WD_BREAK0 + WD_FSTAG * 1.6f * (float)order / (float)(NLET - 1);
        if (u < t1)
            return 0;
        t = u - t1;
        {
            const int dy = (int)(160.f * t * t + 6.f * t);
            return dy > 90 ? -1000 : dy;
        }
    }
}

static void draw_title(float u)
{
    int k;
    for (k = 0; k < NLET; k++) {
        int row, i, dy, x, y;
        char ch[2];
        letter(k, &row, &i);
        dy = letter_dy(u, k);
        if (dy == -1000)
            continue;
        x = letter_x(row, i);
        y = (row ? T2_Y : T1_Y) + dy;
        if (y > FLOOR_Y - 16 && dy > 0)                 /* falling: gone behind the floor */
            continue;
        ch[0] = TITLE[row][i];
        ch[1] = 0;
        if (row == 0)
            px_text_sh(x, y, ch, PX_LRED, PX_RED, PX_FB, 2);
        else
            px_text_sh(x, y, ch, PX_WHITE, PX_DGREY, PX_FB, 2);
    }
}

/* READY. and a blinking cursor where the title will be (the C64's prompt) */
static void draw_ready(float u)
{
    px_text(CX - 30, T1_Y + 8, "READY.", PX_LBLUE, PX_FB, 1);
    if ((int)(u * 2.f) % 2 == 0)
        px_rect(CX - 30, T1_Y + 18, 7, 8, PX_LBLUE);
}

/* ---------------------------------------------------------------- the villain's desk */
static void console(int x, int y, int k, int flick)
{
    int r, c;
    px_sprite(x, y, PXS_TERMINAL, 0);
    for (r = 0; r < 2; r++)                              /* its screen's two rows of readout, blinking */
        for (c = 0; c < 8; c++)
            if ((ih((uint32_t)(k * 31 + r * 8 + c), (uint32_t)flick) & 3u) != 0u)
                px_pset(x + 3 + c, y + 3 + r * 2, (ih((uint32_t)c, (uint32_t)(flick + r)) & 1u) ? PX_LGREEN : PX_GREEN);
            else
                px_pset(x + 3 + c, y + 3 + r * 2, PX_BLACK);
}

static void draw_desk(int talk, int flick)
{
    px_sprite_sc(VIL_X, VIL_Y, talk ? PXS_GENIUS_TALK : PXS_GENIUS, 0, 2, QD_NONE);
    px_rect(CX - 34, DESK_Y, 68, 2, PX_GREY);           /* the desk's top, its legs */
    px_rect(CX - 32, DESK_Y + 2, 2, 4, PX_DGREY);
    px_rect(CX + 30, DESK_Y + 2, 2, 4, PX_DGREY);
    console(CX - 34, DESK_Y - 12, 0, flick);
    console(CX + 20, DESK_Y - 12, 1, flick + 3);
}

/* ---------------------------------------------------------------- the floor, the shaft, the agent, the robot */
static int tri_wave(float u, float lo, float hi)        /* lo .. hi .. lo once a loop */
{
    const float f = u / FZ_LOOP;
    const float g = f < 0.5f ? f * 2.f : 2.f - f * 2.f;
    return (int)(lo + (hi - lo) * g + 0.5f);
}

static void draw_floor(float u)
{
    int x;
    const int ly = 30 + (int)(28.f * (1.f - cosf(UI_TAU * 2.f * u / FZ_LOOP)) + 0.5f);   /* twice a loop */
    for (x = 0; x < SHAFT_X - 2; x += 8)
        px_sprite(x, FLOOR_Y, PXS_FLOOR, 0);
    px_vdots(SHAFT_X, 0, FLOOR_Y + 4, PX_DGREY, 2);      /* the shaft's rails */
    px_vdots(SHAFT_X + 9, 0, FLOOR_Y + 4, PX_DGREY, 2);
    px_vdots(SHAFT_X + 1, 1, FLOOR_Y + 3, PX_GREY, 2);
    px_vdots(SHAFT_X + 10, 1, FLOOR_Y + 3, PX_GREY, 2);
    px_sprite(SHAFT_X + 1, ly, PXS_LIFT, 0);
    px_rect(SHAFT_X + 1, FLOOR_Y, 8, 1, PX_DGREY);       /* the shaft's sill */
}

static void draw_actors(float u)
{
    const int rw = px_sprite_w(PXS_ROBOT1), rh = px_sprite_h(PXS_ROBOT1);
    const int aw = px_sprite_w(PXS_AGENT_STAND), ah = px_sprite_h(PXS_AGENT_STAND);
    const float f = u / FZ_LOOP;
    const int dir = f < 0.5f ? 1 : -1;                  /* the agent: right on the way out, left back */
    const int rx = ROBOT_C - rw / 2 + (int)floorf(18.f * sinf(UI_TAU * 3.f * u / FZ_LOOP) + 0.5f);
    const int rdir = cosf(UI_TAU * 3.f * u / FZ_LOOP) >= 0.f ? 1 : -1;
    const int ax = tri_wave(u, (float)RUN_X0, (float)RUN_X1);
    const int dx = (ax + aw / 2) - (rx + rw / 2), span = 16;
    int ay = FLOOR_Y - ah, sprite;
    static const int RUN[4] = {PXS_AGENT_RUN1, PXS_AGENT_RUN2, PXS_AGENT_RUN3, PXS_AGENT_RUN2};

    px_sprite(rx, FLOOR_Y - rh, (int)(u * 4.f) % 2 ? PXS_ROBOT2 : PXS_ROBOT1, rdir < 0);
    if (dx > -span && dx < span) {                      /* over the robot: a somersault, its arc by the distance */
        const float q = (float)dx / (float)span;
        ay -= (int)(18.f * (1.f - q * q) + 0.5f);
        sprite = dx > -span * 2 / 3 && dx < span * 2 / 3 ? PXS_AGENT_FLIP : PXS_AGENT_RUN2;
    } else {
        sprite = RUN[(int)(u * 10.f) % 4];
    }
    if (ax <= RUN_X0 || ax >= RUN_X1)                   /* at the ends: standing, turning */
        sprite = PXS_AGENT_STAND;
    px_sprite(ax, ay, sprite, dir < 0);
}

/* ---------------------------------------------------------------- the scroller */
static const char SCROLL[] = "EVILGENIUS FOR THE FM-1 · SIX TRACKS · A SID CHIP PER VOICE · WORDS IN $D418 · "
                             "EIGHT ROOMS OF FX · ANY KEY WAKES ME";
static void draw_scroller(float u, int playing, long beat)
{
    const int w = px_text_w(SCROLL, PX_FS, 1);
    const int x = 120 - (int)((float)(w + 120) * (u / FZ_LOOP));
    static const qd_rgb BAR[4] = {PX_BLUE, PX_LBLUE, PX_CYAN, PX_LBLUE};
    px_hline(0, 104, 120, BAR[playing ? (int)(beat & 3) : 1]);
    px_hline(0, 114, 120, BAR[playing ? (int)((beat + 2) & 3) : 0]);
    px_text(x, 107, SCROLL, PX_LGREY, PX_FS, 1);
}

void ui_idle_draw(const ui_idle_t *v)
{
    const float t = v->t, u = fmodf(t, FZ_LOOP), bpm = (float)(v->bpm > 0 ? v->bpm : 120);
    float solid, parts, frac = 0.f;
    int talk, flick;

    ui_idle_word(t, &solid, &parts);
    if (v->playing)                                     /* the part of the beat gone */
        frac = qd_ratio_f(v->beat_num, v->beat_den > 0 ? v->beat_den : 1);
    (void)bpm;

    {                                                   /* the stars over the desk: a few twinkle each half second */
        int i;
        const int tw = (int)(u * 2.f);
        for (i = 0; i < 24; i++) {
            const uint32_t h = ih((uint32_t)i, 3u);
            const int x = (int)(h % 104u), y = (int)((h >> 8) % 20u);
            if (x > VIL_X - 18 && x < VIL_X + 50 && y > 0)
                continue;                               /* not behind the villain */
            if ((ih((uint32_t)i, (uint32_t)tw) & 7u) != 0u)
                px_pset(x, y, (h >> 16) % 3u == 0u ? PX_WHITE : (h >> 16) % 3u == 1u ? PX_GREY : PX_DGREY);
        }
    }

    talk = (u >= WD_GATHER && u < WD_PFADE1 + 0.4f) || (u >= WD_BREAK0 && u < WD_BREAK0 + 0.8f && (int)(u * 8.f) % 2);
    flick = (int)(u * 4.f);
    if (v->playing) {
        talk = frac < 0.25f;
        flick = (int)(v->beat & 0xffff);
    }
    draw_desk(talk, flick);

    if (solid <= 0.f && parts <= 0.f && (u < WD_GATHER || u >= WD_FIZZ))
        draw_ready(u);
    else
        draw_title(u);

    draw_floor(u);
    draw_actors(u);
    draw_scroller(u, v->playing, v->beat);

    if (v->playing && frac < 0.125f) {                  /* the border: a flash on each beat, the downbeat brighter */
        const qd_rgb c = v->beat % 4 == 0 ? PX_YELLOW : PX_LBLUE;
        px_rect(0, 0, 120, 1, c);
        px_rect(0, 119, 120, 1, c);
        px_rect(0, 0, 1, 120, c);
        px_rect(119, 0, 1, 120, c);
    }
}
