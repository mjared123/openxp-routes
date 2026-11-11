# OpenXP Routes

A website for building World of Warcraft: Forever leveling routes visually: an ordered list of steps next to
a zone map, exported as a guide you can paste into the [OpenXP](https://github.com/mjared123/OpenXP) addon
with `/oxp import`.

Status: the editor works for building a route in the browser and exporting it. Sharing routes online comes next.

## Plan

1. **Data export** (done): `tools/export_data.py` turns Questie's public database into JSON under `public/data`.
2. **Route format** (done): `src/guide` reads and writes OpenXP's guide format, so routes go to the addon and back unchanged.
3. **Editor** (done): zone map plus ordered step list, saved in the browser, with guide import and export.
4. **Sharing**: accounts, publishing, browsing and forking routes.

## Using the editor

- Pick a zone and a faction. Quests you can still pick up show as `!` pins on the map and in the list on the left.
- Open a quest and press **Accept**, an objective, or **Turn in**. Each one becomes a step on the right and a numbered
  stop on the map. Accepting or turning in a second quest at the same quest giver joins the step that is already there.
- **Travel and notes** adds flight paths, Hearthstone binds, waypoints you place on the map, and free-text notes.
- Click a step to select it; new steps go in after it. Drag steps to reorder, double-click a step's text to edit it.
  Undo is Ctrl+Z, redo is Ctrl+Shift+Z, Delete removes the selected step.
- **Export** gives a share string, the guide text, or a guide file for the addon. **Import** reads any of the three.
  Lines of an imported guide that the editor doesn't understand are kept and shown as written.

The route is saved in your browser as you work.

### Zone maps

The map shows `public/maps/<zone id>.jpg` when that file exists. Otherwise it tries the address in `VITE_MAP_URL`
(see `.env`; `{id}` is the zone id), and falls back to a plain grid. Zone ids are in `public/data/index.json`.
Map art is Blizzard's and is not part of this repository.

## Quest data

`public/data` is generated. Don't edit it by hand; run the export again instead.

```sh
git clone --depth 1 https://github.com/Questie/QuestieDB ../QuestieDB
python3 tools/export_data.py --questiedb ../QuestieDB
```

It needs Python 3.9 or newer and nothing else. The script reads Questie's Lua files as data and never runs
them. It applies Questie's Forever layers in Questie's own order: raw rows, inherited Classic corrections,
the generated Forever base (which holds Forever's new quests), traces, then hand-written Forever corrections.

Add `--dump path/to/OpenXP.lua` to put what your installed Questie knows in game on top. Make that file with
`/oxp questdump` in OpenXP, then `/reload`; it is saved in `WTF/Account/<name>/SavedVariables/OpenXP.lua`.

What gets written:

| File | Contents |
| --- | --- |
| `index.json` | Source commit, game build, and the list of zones with level range and quest counts per faction. |
| `quests.json` | Every quest in short form (`id, name, level, minLevel, side, zone`), for search. |
| `zones/<id>.json` | One zone: its full quests, the NPCs, objects and items they need with coordinates, and service NPCs (flight masters, innkeepers, trainers, vendors, repair, bank, stable). |

Coordinates are the 0-100 map percentages the game and OpenXP's `.goto Zone,x,y` use, keyed by zone id.
A quest belongs to the zone Questie files it under, or to its quest giver's zone when that is a category
such as a class or profession.

Tests: `python3 -m unittest discover -s tools/tests`.

## Develop

```sh
npm install
npm run dev      # the site, at http://localhost:5173
npm test         # unit tests
npm run build    # type-check and build into dist/
```

To also test the guide reader against every guide OpenXP ships, point `OPENXP_DIR` at a checkout of the addon:
`OPENXP_DIR=../OpenXP npm test`. Those guides aren't copied here because their license differs.

## Guide format

`src/guide` turns a guide into data and back (`parseGuide`, `serializeGuide`). It keeps every line, including
commands the editor doesn't know, so reading and writing a guide changes nothing but whitespace.
`readAction` and `writeAction` cover the commands the editor creates: `.goto`, `.accept`, `.turnin`,
`.complete`, `.fp`, `.fly`, `.home`, `.hs`, `.xp`, `.target` and `.mob`.

Routes are shared as a single line of text; see [docs/share-string.md](docs/share-string.md).

## License

GPL-3.0, see [LICENSE](LICENSE). The quest data comes from [QuestieDB](https://github.com/Questie/QuestieDB),
which is GPLv3; that is why this project is too. World of Warcraft and its art are Blizzard Entertainment's.
This is a fan project, not affiliated with Blizzard, Questie or RestedXP.
