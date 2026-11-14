#!/bin/sh
# The promo's lettering: promo/glyphs.c against the host objects (make -C tools tour first); run from the repo's
# root. promo/build/glyphs.raw is the firmware's 8 x 8 face.
set -e
OBJ=$(ls tools/build/*.o | grep -v -E "build/(tour|presets|fxtest|render_|test_|gen_|bench|tick|midimon|flash)")
INC="-Icore/app -Icore/ui -Icore/gfx -Icore/seq -Icore/voice -Icore/voice/quad -Icore/voice/sid -Icore/voice/fx -Icore/voice/sam -Icore/tests -Ithird_party/plutovg/include"
DEF="-DQD_USB_HOST=1 -DSID_COMB_CONST -DPLUTOVG_BUILD -DPLUTOVG_BUILD_STATIC -DPLUTOVG_DISABLE_FONT_FACE_CACHE_LOAD"
mkdir -p promo/build
cc -O2 -std=c99 $INC $DEF -c promo/glyphs.c -o promo/build/glyphs.o
cc -o promo/build/glyphs promo/build/glyphs.o $OBJ -lm
promo/build/glyphs promo/build/glyphs.raw
