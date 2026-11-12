# OpenXP Routes

A website that builds a World of Warcraft: Forever leveling route for your character. Answer a few questions
about how you want to play and what you want to get, and it plans the whole road for you: every quest in order
on a zone map, the level you'll be along the way, and guides for the
[OpenXP](https://github.com/mjared123/OpenXP) addon.

Status: it works in the browser, from the first question to exported guide files. Sharing routes online comes next.

## Crafting an adventure

1. **Hero.** Faction, race, class, the level you start at and the level you want to reach.
2. **Pace.** Speed leveling, efficient, relaxed or completionist, normal or hardcore, with or without elite quests.
3. **Dungeons.** Pick the ones you want to run. Each card shows boss drops your class can use.
4. **Treasures.** Pick quest rewards worth a detour, such as the weapon at the end of a chain or Forever's Cozy
   Sleeping Bag. Hover any item to see its icon and tooltip.
5. **Trades.** Professions, camping quests, and recipes to buy or earn on the way.
6. **Forge.** The site walks the world for your character: it picks the best zone for each level, takes the
   quests that fit your pace, follows the chains behind everything you asked for, slots dungeons in when you are
   the right level, sends you past the vendors of your recipes, and puts every step in walking order.

The result is your adventure as a list of chapters with the levels you'll be, and a note for every wish on whether
it made the route. **Export for OpenXP** gives you the guide files.

## Fine-tuning

**Fine-tune the steps** opens the editor on any chapter. The quest board on the left lists the zone's quests chain
by chain; tick or untick them and **Re-plan**. The route panel shows your level after every step and lists what
would go wrong in game (a quest before its chain, too low a level, a full quest log), most with a button that fixes
it. **Add a section** suggests the zones with the most quest XP for your level.

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

### A second source: Polestar's forever-db

```sh
git clone --depth 1 https://github.com/fitzforge/polestar ../polestar
python3 tools/export_data.py --questiedb ../QuestieDB --foreverdb ../polestar/forever-db
```

`--foreverdb` lays [forever-db](https://github.com/fitzforge/polestar/tree/main/forever-db) over Questie's data
where Questie has nothing. Questie stays the base and wins wherever both know a value. It adds quest XP that
Questie lacks, marks quests that need a group, have a timer or are an escort, adds drop chances, and gives the
quest board its warnings ("the bauble disappears 5 minutes after you loot it"). The data in `public/data` is
built with it.

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

## Item icons and tooltips

Questie's data has no icons, quality or stats, so those come from two other open sources: the
[wow-classic-items](https://github.com/Nakroma/wow-classic-items) package (MIT) for icon names, quality and
tooltip lines, and [wow-ui-textures](https://github.com/Gethe/wow-ui-textures) for the icon art itself.

```sh
npm pack wow-classic-items && tar xzf wow-classic-items-*.tgz
python3 tools/export_items.py --items package/data/json/data.json --icons <folder of icon PNGs>
```

This writes `public/data/items.json` and `public/icons/`. It needs Pillow for the icons. Items that only exist
in Forever are not in that package: they get an icon that fits their type and a short tooltip from what Questie
knows (type, item level, required level), and say so.

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
| `src/generate.ts` | Builds a whole route from the answers: zones, dungeons, wished-for items and recipes. |
| `src/components/adventure` | The front door: landing, questions, progress and the finished journey. |
| `src/components/Item.tsx` | Item icons and tooltips. |
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
which is GPLv3; that is why this project is too. Group, timer and escort flags, some quest XP and drop chances
come from Polestar's [forever-db](https://github.com/fitzforge/polestar/tree/main/forever-db) (GPL-3.0; its own
NOTICE credits EG Link, CMaNGOS, VMaNGOS, ForeverTDB, Questie and pfQuest). The quest warnings are forever-db's
notes, © the Polestar contributors, used unchanged under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Item tooltips come from
[wow-classic-items](https://github.com/Nakroma/wow-classic-items) (MIT). World of Warcraft, its item icons and
its art are Blizzard Entertainment's.
This is a fan project, not affiliated with Blizzard, Questie or RestedXP.
