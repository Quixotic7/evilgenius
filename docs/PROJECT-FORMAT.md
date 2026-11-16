# The project file: `.egprj`

2026-11-15. One EvilGenius project, portable: the manager's browser library keeps projects in this form, EXPORT
writes it and IMPORT reads it, and a VST or native app linking EvilGenius's core can load it as the unit does. It
carries **the store's own records**, not a translation, so nothing is lost on the way and every tool reads the same
bytes the firmware wrote. Written and read by `site/manager/egproject.js`; tested in `tools/eg/manager_test.mjs`
("projects").

## The file

JSON, UTF-8:

```json
{
  "format": "evilgenius-project",
  "version": 1,
  "store": "EGB2",
  "name": "JAM ONE",
  "saved": "2026-11-15T22:23:10.000Z",
  "from": { "unit": "VIRTUAL", "slot": 1, "date": "2026-11-15T22:23:10.000Z" },
  "records": [ { "kind": "HDR", "index": 0, "data": "<base64>" }, { "kind": "PAT", "index": 0, "data": "<base64>" } ],
  "presets": [ { "id": 384, "name": "SAW", "blob": "<base64, 128 bytes>", "tags": 1, "flags": 0,
                 "pan": 0, "chorus": 0, "delay": 0, "reverb": 7 } ],
  "summary": { "tracks": ["KICK", "", "LEAD", "", "", ""], "patterns": [0, 17] }
}
```

- `format`, `version`: a reader refuses another format and a newer version.
- `store`: the store's magic the records were written under (`core/store/store.h` QDS_MAGIC, "EGB2" today). Its digit
  goes up when the packed patch format changes; a project goes only into a store of the same magic.
- `name`: the project's name (twelve characters, upper case), the same as its header record's.
- `from`: where it came from. `unit` (the link's id: `USB`, `VIRTUAL` ..) and `slot`, or `file` for an import. For
  people; a reader may ignore it.
- `records`: the project's records, exactly as `core/app/persist.c` writes them, each with its kind and index (the
  store's key is `kind << 24 | project << 16 | index`; the project is left out, so the file goes into any slot):
  - `HDR` index 0: the header ('H' 1: name, key, record settings, the tracks' mix, kinds, names, DRY, room sends);
  - `PAT` index 0..63: the patterns ('P' 1..6: steps, locks, track settings, track sounds);
  - `SND` index 1..128: the pool (a sound, 'S' 1..5; a reference, 'R' 1 and a preset id u16; 'E' 1 empty);
  - `MFX` index 0: the MIDI FX groups ('X' 1).
  A pattern or pool slot that was never written has no record (the firmware's default).
- `presets`: every one of MY PRESETS the records name, whole (persist.c's 'S' 5 fields: `blob` the 128-byte packed
  patch, `tags` a bit mask, `flags`, the mix). `id` is the preset's id in the store it came from.
- `summary`: for lists. `tracks`: the tracks' names (empty: the kit's default); `patterns`: the indexes of the
  patterns with steps. A reader may ignore it.

## The references, and how a project moves

A project's sounds live partly outside it. Two kinds of record name a preset by id:

- a pool slot's 'R' 1 record (bytes 2..3: the id), and
- a 'P' 5 or 6 pattern's track sounds (bytes 12..23: six ids, u16 each, 0 for a track sound written whole).

Ids 1..23 are the factory presets, compiled into the firmware: they travel as they are. Ids from 0x100 are MY PRESETS,
and differ from unit to unit. So:

- **Taking a project out** (`extractProject`): its records, and every MY preset they name that the store holds. A
  reference to a preset that is gone travels as it is.
- **Putting it into a slot** (`insertProject`): the slot's records are all replaced (every other project's records,
  and the settings record, stay byte for byte). Each preset the file carries is looked for in MY PRESETS by its name
  and patch: found, its id is used; else it is added to a free place with a new id (above every id given before, the
  next id kept in the factory tags' record, as `persist.c lib_new_id` does) and marked imported. The references are
  rewritten to those ids; one to a preset the file does not carry becomes 0xFFFF, an id no preset has, so the firmware
  drops it as it would have where the project came from. MY PRESETS full: refused, nothing written.
- The store is then written whole and packed (`egstore.js writeStore`), as RESTORE writes a backup. On the FM-1 the
  manager reads and keeps the store first (CABINET's backups), checks the new one, and writes it; the unit starts
  again.

A track sound written whole in a pattern (not a reference) carries the id of the preset it was loaded from. That id
is not rewritten. The sound itself is in the record, and the firmware writes a track sound back as a reference only
when that preset's name and patch match it (`persist.c tsound_ref`), so a stale id does not change what plays.

## What reads it

- The manager (browser library, EXPORT, IMPORT, SEND TO SLOT), on the FM-1 over USB and on the virtual FM-1.
- Later: a VST or native app linking the core (`--host`), which opens the file, rewrites the keys for its slot as
  above, and loads the project with `persist.c`'s own readers.
