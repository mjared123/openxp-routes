# OpenXP Routes

A website for building World of Warcraft: Forever leveling routes visually: an ordered list of steps next to
a zone map, exported as a guide you can paste into the [OpenXP](https://github.com/mjared123/OpenXP) addon
with `/oxp import`.

Status: early. The quest data export is in place; the editor comes next.

## Plan

1. **Data export** (done): `tools/export_data.py` turns Questie's public database into JSON under `public/data`.
2. **Route format**: read and write OpenXP's guide format, so routes go to the addon and back unchanged.
3. **Editor**: zone map plus ordered step list, saved in the browser, with guide import and export.
4. **Sharing**: accounts, publishing, browsing and forking routes.

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

## License

GPL-3.0, see [LICENSE](LICENSE). The quest data comes from [QuestieDB](https://github.com/Questie/QuestieDB),
which is GPLv3; that is why this project is too. World of Warcraft and its art are Blizzard Entertainment's.
This is a fan project, not affiliated with Blizzard, Questie or RestedXP.
