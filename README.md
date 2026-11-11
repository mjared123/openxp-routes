# OpenXP Routes

A website for planning a World of Warcraft: Forever leveling route for your character. Tell it who you play,
tick the quests you want (or let it pick), and it builds an ordered list of steps on a zone map, tells you what
level you'll be along the way, and exports guides for the [OpenXP](https://github.com/mjared123/OpenXP) addon.

Status: the builder works in the browser, from character to exported guide files. Sharing routes online comes next.

## Using the builder

1. **Character.** Faction, race, class, starting level, normal or hardcore, and a play style (fast, balanced,
   everything). The builder only shows quests that character can take.
2. **Pick quests.** The board on the left lists a zone's quests chain by chain, coloured the way the game colours
   them for your level, with XP, class quests, elite quests and gear you can use marked. **Pick quests for me**
   ticks everything that suits your level and choices. Ticking a quest yourself also ticks what it needs first.
3. **Build route.** The planner puts the ticked quests in order: from where you stand it always does the nearest
   thing you are able to do, then moves single stops to shorten the walk. Chains, level requirements and the
   20-quest log are respected, and "grind to level" steps are added where nothing else is open.
4. **Check it.** The route panel shows your level after every step and lists what would go wrong in game: a quest
   accepted before its chain, too low a level, a full quest log, quests never turned in, quests that are risky in
   hardcore. Most problems have a button that fixes them.
5. **Go on.** **Add a section** suggests the zones with the most quest XP for your level. Each section is one
   guide; the whole route exports as guides that lead into each other.

You can still work by hand: open a quest to add a single accept, objective or turn-in step; **Travel and notes**
adds flight paths, Hearthstone binds, waypoints, notes and "grind to a level" steps; drag steps to reorder,
double-click a step's text to edit it. Undo is Ctrl+Z, redo is Ctrl+Shift+Z, Delete removes the selected step.

**Export** gives a guide file for the addon, the guide text, or a share string. **Import** reads any of the three;
a file with several guides becomes a route with several sections. Lines the builder doesn't understand are kept.

The route is saved in your browser as you work.

### What the numbers are

WoW Forever uses Classic's XP per level and Classic's quest XP, so levels are worked out from Questie's quest
XP plus an estimate of the mobs the objectives make you kill (counts from the quest text, drop chances where
Questie has them). Kills inside dungeons count for about a third, as in Forever. It is an estimate: it does not
know rested XP, groups, or how you play. Gear is marked by type (what your class can equip) because the open
data has no item stats.

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
| `index.json` | Source commit, game build, and the list of zones with level range, quest counts per faction and the map's edges in world yards. |
| `quests.json` | Every quest in short form (`id, name, level, minLevel, side, zone, xp, preAll, preAny, classes, races`), for search and for checking chains across zones. |
| `zones/<id>.json` | One zone: its full quests, the NPCs, objects and items they need with coordinates, service NPCs (flight masters, innkeepers, trainers, vendors, repair, bank, stable), quest rewards, drop chances, and for dungeons the gear each boss drops. |

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

## How it is put together

| File | What it does |
| --- | --- |
| `src/xp.ts` | Levels, quest XP, kill XP, quest colours. |
| `src/character.ts` | The character: what it can take and wear. |
| `src/book.ts` | Quest knowledge: chains, and how much work an objective is. |
| `src/sim.ts` | Plays a route in its head: level after each step, and the problems. |
| `src/planner.ts` | Picks quests, orders them into steps, suggests the next zone. |
| `src/store.ts` | The route (character plus sections), undo, saving, import and export. |
| `src/route.ts` | Turns quests into guide steps and back. |

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
