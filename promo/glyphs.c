/* SPDX-License-Identifier: MPL-2.0
 * The promo's lettering: the firmware's own 8 x 8 face (px_text, PX_FB), a glyph a 10 x 10 cell, 12 a row, as raw
 * RGB565 big-endian (240 x 240, the pixels doubled as on the panel). promo/make.py cuts the cells out.
 *     glyphs OUT.raw */
#include <stdio.h>
#include "px.h"
#include "qd_gfx.h"

static uint16_t lcd[QD_W * QD_H];

int main(int argc, char **argv)
{
    FILE *f;
    int c;
    if (argc < 2 || !qd_init())
        return 2;
    qd_begin();
    for (c = 32; c < 96; c++) {
        const char s[2] = {(char)c, 0};
        px_text(((c - 32) % 12) * 10, ((c - 32) / 12) * 10, s, PX_WHITE, PX_FB, 1);
    }
    px_text(40, 50, "\xc2\xb7", PX_WHITE, PX_FB, 1);      /* the middle dot, cell 64 */
    qd_end(lcd);
    if (!(f = fopen(argv[1], "wb")))
        return 2;
    fwrite(lcd, 2, QD_W * QD_H, f);
    fclose(f);
    return 0;
}
