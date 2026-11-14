#!/bin/sh
# SPDX-License-Identifier: MPL-2.0
# EvilGenius: the unit's package (the Bluetooth one: the only one), built in a copy of the tree.
#
# Why a copy: firmware/build.py is FIZZ's and patches fm1-base's sources, so it needs fm1-base at FIZZ's pin
# (934e40d, its bsp at 2cd696a). This checkout's firmware/fm1-base is newer (c8e0599), which the RemoteFM1 package
# (fm1-base's own build.py --rfm1) needs. The copy has the older one, as git worktrees of the two submodules:
#
#   DST=/private/tmp/eg-devbuild/EvilGenius          (or $EG_DEVBUILD)
#   git -C firmware/fm1-base worktree add --detach $DST/firmware/fm1-base 934e40d
#   rmdir $DST/firmware/fm1-base/bsp
#   git -C firmware/fm1-base/bsp worktree add --detach $DST/firmware/fm1-base/bsp 2cd696a
#
# Then: firmware/devbuild.sh            the package: $DST/firmware/app/build/evilgenius-ble.fwsc and its size report
#                                       (fizz-ble-size.txt); FZ_MEASURE=1 in the environment: a measure only
# Install it: python3 firmware/fm1-base/tools/fm1_install.py PACKAGE.fwsc --yes
# The unit's counters afterwards: python3 firmware/tools/fizz_xdata.py stats
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
DST=${EG_DEVBUILD:-/private/tmp/eg-devbuild/EvilGenius}
[ -d "$DST/firmware/fm1-base/bsp/chip" ] || { echo "devbuild: $DST has no fm1-base at FIZZ's pin: see this script's head"; exit 1; }
rsync -a --exclude .git --exclude tools/build --exclude art-eg --exclude site --exclude mockups --exclude ios \
    --exclude firmware/fm1-base --exclude firmware/app/build --exclude dist "$SRC"/ "$DST"/
cd "$DST"
export DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib
export AC79_SDK=${AC79_SDK:-$HOME/fw-AC79_AIoT_SDK} JIELI_TOOLCHAIN=${JIELI_TOOLCHAIN:-$HOME/.jieli/toolchain}
python3 firmware/build.py "$@"
