#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""A MIDI port for tools/eg/manager_hw.mjs (Node has no Web MIDI): SysEx frames as lines of hex, both ways.

  manager_midi_bridge.py --list          the port names that are both an input and an output, a line each
  manager_midi_bridge.py NAME            stdin: a frame a line (hex) -> sent; a frame received -> stdout, a line

Needs mido with python-rtmidi, as firmware/tools/fizz_xdata.py."""
import sys
import threading
import time

import mido


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--list":
        outs = set(mido.get_output_names())
        for n in dict.fromkeys(mido.get_input_names()):
            if n in outs:
                print(n)
        return 0
    name = sys.argv[1]
    inp, out = mido.open_input(name), mido.open_output(name)
    stop = threading.Event()

    def pump():
        while not stop.is_set():
            m = inp.poll()
            if m is None:
                time.sleep(0.001)
                continue
            if m.type == "sysex":
                sys.stdout.write(bytes(m.bytes()).hex() + "\n")
                sys.stdout.flush()

    t = threading.Thread(target=pump, daemon=True)
    t.start()
    try:
        for line in sys.stdin:
            line = line.strip()
            if line:
                out.send(mido.Message.from_bytes(bytes.fromhex(line)))
    finally:
        stop.set()
        t.join(0.2)
        inp.close()
        out.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
