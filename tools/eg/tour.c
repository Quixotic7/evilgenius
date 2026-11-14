/* SPDX-License-Identifier: MPL-2.0
 * EvilGenius: the screen tour. Runs the app (core/app) headless on the core's clock and plays a script of panel
 * gestures, writing the screen as PNG where the script says. The mock-ups (and FIZZ's own screens, for reference)
 * come from real states this way, not from drawings of them.
 *
 *     tour SCRIPT OUT_DIR
 *
 * The script, a command a line ('#' starts a comment):
 *     wait MS                      run the app MS milliseconds
 *     play                         the demo plays (qd_app_play)
 *     tap BUTTON | down BUTTON | up BUTTON        by the printed names: FX SEL ENV LFO EDIT GLO HOME SAVE ARP SEQ
 *                                  PLAY REC OCT- OCT+ (a tap: down, 20 ms, up, 20 ms)
 *     key KEY down [VEL] | key KEY up | tapkey KEY     KEY: W1..W16, B1..B11 (or 0..26, F3 up)
 *     knob KNOB N                  KNOB: SELECT ALGO PRESETS K1 K2 K3 K4; N detents (+ clockwise), 30 ms apart
 *     shot NAME [caption..]        OUT_DIR/NAME.png (and a line in OUT_DIR/index.tsv)
 *     reset                        the app again from power-on
 *     wav PATH                     the audio from here on into PATH (16-bit stereo; closed at the script's end) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "app.h"
#include "ctl.h"
#include "plutovg.h"
#include "qd_gfx.h"

static qd_app_t A;
static uint32_t now;
static uint64_t frames_done;
static uint16_t lcd[QD_W * QD_H];
static FILE *wavf;
static uint32_t wavn;

static void run(uint32_t n)
{
    while (n--) {
        now++;
        qd_app_tick(&A, now);
        if (now % 15u == 0u)
            qd_app_frame(&A, lcd);
        while (frames_done + 128u <= (uint64_t)now * QD_FS / 1000u) {
            int16_t blk[256];
            qd_app_audio(&A, blk, 128);
            if (wavf)
                wavn += (uint32_t)fwrite(blk, 2, 256, wavf) * 2u;
            frames_done += 128u;
        }
    }
}

static int write_png(const char *path)
{
    plutovg_surface_t *s = plutovg_surface_create(QD_W, QD_H);
    unsigned char *d = plutovg_surface_get_data(s);
    const int stride = plutovg_surface_get_stride(s);
    int x, y, ok;
    for (y = 0; y < QD_H; y++)
        for (x = 0; x < QD_W; x++) {
            const uint16_t be = lcd[y * QD_W + x], c = (uint16_t)((be >> 8) | (be << 8));
            const uint32_t r = ((c >> 11) & 31u) * 255u / 31u, g = ((c >> 5) & 63u) * 255u / 63u,
                           b = (c & 31u) * 255u / 31u;
            ((uint32_t *)(void *)(d + y * stride))[x] = 0xFF000000u | (r << 16) | (g << 8) | b;
        }
    ok = plutovg_surface_write_to_png(s, path);
    plutovg_surface_destroy(s);
    return ok;
}

static int button(const char *s)
{
    static const char *const N[QD_NBTN] = {"FX", "SEL", "ENV", "LFO", "EDIT", "GLO", "HOME",
                                           "SAVE", "ARP", "SEQ", "PLAY", "REC", "OCT-", "OCT+"};
    int i;
    for (i = 0; i < QD_NBTN; i++)
        if (!strcmp(s, N[i]))
            return i;
    return -1;
}
static int knob(const char *s)
{
    static const char *const N[QD_NKNOB] = {"SELECT", "ALGO", "PRESETS", "K1", "K2", "K3", "K4"};
    int i;
    for (i = 0; i < QD_NKNOB; i++)
        if (!strcmp(s, N[i]))
            return i;
    return -1;
}
static int key(const char *s)
{
    int n = atoi(s + 1);
    if (s[0] == 'W' && n >= 1 && n <= 16)
        return QD_WHITE_KEY[n - 1];
    if (s[0] == 'B' && n >= 1 && n <= 11)
        return QD_BLACK_KEY[n - 1];
    n = atoi(s);
    return n >= 0 && n < QD_NKEY ? n : -1;
}

static void reset(void)
{
    qd_app_init(&A);
    now = 0;
    frames_done = 0;
    qd_app_tick(&A, 0);
    run(100);
}

int main(int argc, char **argv)
{
    char line[512], path[1024];
    FILE *f, *idx;
    int ln = 0, fails = 0;
    if (argc < 3) {
        fprintf(stderr, "usage: tour SCRIPT OUT_DIR\n");
        return 2;
    }
    if (!(f = fopen(argv[1], "r"))) {
        perror(argv[1]);
        return 2;
    }
    snprintf(path, sizeof path, "%s/index.tsv", argv[2]);
    if (!(idx = fopen(path, "w"))) {
        perror(path);
        return 2;
    }
    reset();
    while (fgets(line, sizeof line, f)) {
        char cmd[32] = "", a[64] = "", b[64] = "", c[64] = "";
        char *hash = strchr(line, '#');
        int n;
        ln++;
        if (hash && strncmp(line, "shot", 4))
            *hash = 0;
        n = sscanf(line, "%31s %63s %63s %63s", cmd, a, b, c);
        if (n < 1)
            continue;
        if (!strcmp(cmd, "wait"))
            run((uint32_t)atoi(a));
        else if (!strcmp(cmd, "reset"))
            reset();
        else if (!strcmp(cmd, "wav")) {
            static const unsigned char H[44] = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ',
                                                16, 0, 0, 0, 1, 0, 2, 0, 0x44, 0xAC, 0, 0, 0x10, 0xB1, 2, 0, 4, 0, 16, 0,
                                                'd', 'a', 't', 'a', 0, 0, 0, 0};
            if ((wavf = fopen(a, "wb")))
                fwrite(H, 1, 44, wavf);
        }
        else if (!strcmp(cmd, "play"))
            qd_app_play(&A);
        else if (!strcmp(cmd, "tap") || !strcmp(cmd, "down") || !strcmp(cmd, "up")) {
            const int k = button(a);
            if (k < 0)
                goto bad;
            if (cmd[0] != 'u') {
                qd_app_button(&A, k, 1);
                run(20);
            }
            if (cmd[0] != 'd') {
                qd_app_button(&A, k, 0);
                run(20);
            }
        } else if (!strcmp(cmd, "key") || !strcmp(cmd, "tapkey")) {
            const int k = key(a);
            if (k < 0)
                goto bad;
            if (!strcmp(cmd, "tapkey")) {
                qd_app_key(&A, k, 1, 100);
                run(60);
                qd_app_key(&A, k, 0, 0);
                run(30);
            } else if (!strcmp(b, "down")) {
                qd_app_key(&A, k, 1, n > 3 ? atoi(c) : 100);
                run(5);
            } else {
                qd_app_key(&A, k, 0, 0);
                run(5);
            }
        } else if (!strcmp(cmd, "knob")) {
            int k = knob(a), d = atoi(b), s = d < 0 ? -1 : 1;
            if (k < 0)
                goto bad;
            for (d = d < 0 ? -d : d; d > 0; d--) {
                qd_app_knob(&A, k, s);
                run(30);
            }
        } else if (!strcmp(cmd, "shot")) {
            const char *cap = strstr(line, a) + strlen(a);
            char capt[400];
            while (*cap == ' ')
                cap++;
            snprintf(capt, sizeof capt, "%s", cap);
            capt[strcspn(capt, "\n")] = 0;
            qd_app_frame(&A, lcd);
            snprintf(path, sizeof path, "%s/%s.png", argv[2], a);
            if (!write_png(path))
                fails++;
            fprintf(idx, "%s\t%s\n", a, capt);
            printf("%s  %s\n", a, capt);
        } else {
        bad:
            fprintf(stderr, "%s:%d: what is \"%s\"?\n", argv[1], ln, line);
            fails++;
        }
    }
    fclose(f);
    fclose(idx);
    if (wavf) {                                         /* the WAV's sizes */
        const uint32_t riff = 36u + wavn;
        fseek(wavf, 4, SEEK_SET), fwrite(&riff, 4, 1, wavf);
        fseek(wavf, 40, SEEK_SET), fwrite(&wavn, 4, 1, wavf);
        fclose(wavf);
    }
    return fails ? 1 : 0;
}
