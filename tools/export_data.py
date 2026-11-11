#!/usr/bin/env python3
"""Export WoW Forever quest data for the route builder website.

Reads a checkout of Questie's public database (github.com/Questie/QuestieDB)
and writes plain JSON the website can load:

    <out>/index.json          what was exported, plus the list of zones
    <out>/quests.json         every quest, short form, for search
    <out>/zones/<id>.json     full quests of one zone, with the NPCs, objects
                              and items they need and where those are

QuestieDB's Forever data is layered: raw rows in data/Forever, then several
correction files in src/corrections/Forever (which also hold WoW Forever's new
quests). This script applies the same layers in the same order. It reads the
Lua files as data and never runs them (see lua_values.py).

Optionally, --dump adds what an installed Questie knows in game, saved by
OpenXP's `/oxp questdump` (WTF/Account/<name>/SavedVariables/OpenXP.lua).
Rows from the dump win over the public files.

Questie's data is GPLv3, so the exported JSON is GPLv3 too.

Usage:
    python3 tools/export_data.py --questiedb PATH/TO/QuestieDB [--dump OpenXP.lua] [--out public/data]
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lua_values import UNKNOWN, Parser, parse, tokenize  # noqa: E402

FORMAT = 1

# Forever's requiredRaces bits (QuestieDB src/corrections/enum/expansions.lua).
RACES = {
    "NONE": 0, "HUMAN": 1, "ORC": 2, "DWARF": 4, "NIGHT_ELF": 8, "UNDEAD": 16,
    "TAUREN": 32, "GNOME": 64, "TROLL": 128, "GOBLIN": 256,
    "SKYBORNE_ALLIANCE": 1 << 32, "SKYBORNE_HORDE": 1 << 33,
}
ALLIANCE = 1 | 4 | 8 | 64 | (1 << 32)
HORDE = 2 | 16 | 32 | 128 | (1 << 33)
RACES["ALL_ALLIANCE"] = ALLIANCE
RACES["ALL_HORDE"] = HORDE
RACE_NAMES = [(1, "Human"), (2, "Orc"), (4, "Dwarf"), (8, "Night Elf"), (16, "Undead"),
              (32, "Tauren"), (64, "Gnome"), (128, "Troll"),
              (1 << 32, "Skyborne (Alliance)"), (1 << 33, "Skyborne (Horde)")]
CLASSES = {
    "NONE": 0, "WARRIOR": 1, "PALADIN": 2, "HUNTER": 4, "ROGUE": 8, "PRIEST": 16,
    "DEATH_KNIGHT": 32, "SHAMAN": 64, "MAGE": 128, "WARLOCK": 256, "MONK": 512,
    "DRUID": 1024, "ALL_CLASSES": 1503,
}
CLASS_NAMES = [(1, "Warrior"), (2, "Paladin"), (4, "Hunter"), (8, "Rogue"), (16, "Priest"),
               (64, "Shaman"), (128, "Mage"), (256, "Warlock"), (1024, "Druid")]
PLAYABLE_CLASSES = sum(bit for bit, _ in CLASS_NAMES)
NPC_FLAGS = {
    "NONE": 0, "GOSSIP": 1, "QUEST_GIVER": 2, "VENDOR": 4, "FLIGHT_MASTER": 8, "TRAINER": 16,
    "SPIRIT_HEALER": 32, "SPIRIT_GUIDE": 64, "INNKEEPER": 128, "BANKER": 256,
    "PETITIONER": 512, "TABARD_DESIGNER": 1024, "BATTLEMASTER": 2048, "AUCTIONEER": 4096,
    "STABLEMASTER": 8192, "REPAIR": 16384, "BARBER": 33554432, "TRANSMOGRIFIER": 536870912,
}
# What a zone file lists under "services", by NPC flag.
SERVICES = [("flight", 8), ("inn", 128), ("trainer", 16), ("repair", 16384),
            ("vendor", 4), ("bank", 256), ("stable", 8192)]
CONTINENTS = {0: "Eastern Kingdoms", 1: "Kalimdor"}
# An item dropped by more mobs than this only lists the ones nearest the quest.
MAX_DROP_SOURCES = 40


def read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


# ---------------------------------------------------------------------------
# Constants: field positions and named ids
# ---------------------------------------------------------------------------

def load_keys(qdb, kind):
    """{field name: 1-based position} for quest / npc / object / item rows."""
    text = read(os.path.join(qdb, "src", "meta", kind + "Meta.lua"))
    keys = {m.group(1): int(m.group(2)) for m in re.finditer(r"\['(\w+)'\] = (\d+),", text)}
    if "name" not in keys:
        raise SystemExit("couldn't read field names from src/meta/%sMeta.lua" % kind)
    return keys


def load_named_ids(path, start=None):
    """NAME = number pairs of a Lua constants file (after the line holding `start`)."""
    text = read(path)
    if start:
        at = text.index(start)
        text = text[at:text.index("\n}", at)]
    return {m.group(1): int(m.group(2))
            for m in re.finditer(r"^\s*([A-Z][A-Z0-9_]*) = (-?\d+),", text, re.M)}


def pretty(name):
    """ELWYNN_FOREST -> Elwynn Forest."""
    small = {"of", "the", "and", "to", "in", "at"}
    words = name.lower().split("_")
    return " ".join(w if (w in small and i) else w.capitalize() for i, w in enumerate(words))


# ---------------------------------------------------------------------------
# Rows: raw data, then corrections on top
# ---------------------------------------------------------------------------

def load_raw(path, width):
    """{id: row} from a data/Forever/*.lua file; a row is a list, index 0 = field 1."""
    rows = {}
    for m in re.finditer(r"^\[(\d+)\] = (\{.*\}),?\s*$", read(path), re.M):
        row = parse(m.group(2))
        rows[int(m.group(1))] = row + [None] * (width - len(row))
    if not rows:
        raise SystemExit("no rows found in %s" % path)
    return rows


def _entries(toks, start):
    """Token ranges of the top-level `[id] = value` entries of the table whose
    '{' is toks[start]; lets one unreadable entry be skipped on its own."""
    depth, i, begin = 0, start, None
    while i < len(toks):
        kind, v = toks[i]
        if kind == "sym":
            if v in "{([":
                if depth == 1 and v == "[" and begin is None:
                    begin = i
                depth += 1
            elif v in "})]":
                depth -= 1
                if depth == 0:
                    if begin is not None:
                        yield begin, i
                    return
            elif v == "," and depth == 1 and begin is not None:
                yield begin, i
                begin = None
        i += 1


def load_corrections(path, names, func="Load"):
    """[(id, {(field, op): value})] from a Questie correction file: the table
    its `:<func>()` returns. op is None (set), "add" or "remove"."""
    text = read(path)
    m = re.search(r"^function \w+:%s\(\)" % func, text, re.M)
    if not m:
        raise SystemExit("no :%s() in %s" % (func, path))
    end = re.search(r"^end\b", text[m.end():], re.M)
    body = text[m.end():m.end() + end.start()] if end else text[m.end():]
    body = body[re.search(r"^\s*return \{", body, re.M).end() - 1:]
    toks = tokenize(body)
    out, skipped = [], 0
    for a, b in _entries(toks, 0):
        try:
            p = Parser(toks[a:b], names)
            p.take("[")
            id_ = p.expr()
            p.take("]")
            p.take("=")
            fields = p.expr()
            if p.i != b - a or not isinstance(id_, int) or not isinstance(fields, (dict, list)):
                raise ValueError("unexpected shape")
            out.append((id_, fields if isinstance(fields, dict) else {}))
        except (ValueError, IndexError, KeyError, TypeError):
            skipped += 1
    return out, skipped


def field_names(keys):
    """Lookup for `questKeys.startedBy_add` style names: -> (position, op)."""
    names = {}
    for name, pos in keys.items():
        names[name] = (pos, None)
        names[name + "_add"] = (pos, "add")
        names[name + "_remove"] = (pos, "remove")
    return names


def _merge(old, new):
    """Questie's `_add`: lists grow, nested groups and spawn maps merge."""
    if old is None or old is UNKNOWN:
        return new
    if isinstance(old, dict) or isinstance(new, dict):
        old = dict(old) if isinstance(old, dict) else {i: v for i, v in enumerate(old, 1)}
        new = new if isinstance(new, dict) else {i: v for i, v in enumerate(new, 1)}
        for k, v in new.items():
            old[k] = (old.get(k) or []) + [p for p in v if p not in (old.get(k) or [])] \
                if isinstance(v, list) else v
        return old
    if isinstance(old, list) and isinstance(new, list):
        if any(isinstance(v, list) or v is None for v in new) and \
                all(isinstance(v, list) or v is None for v in old + new):
            n = max(len(old), len(new))
            a, b = old + [None] * (n - len(old)), new + [None] * (n - len(new))
            return [_merge(x, y) if y is not None else x for x, y in zip(a, b)]
        return old + [v for v in new if v not in old]
    return new


def _remove(old, gone):
    if old is None or gone is None:
        return old
    if isinstance(old, dict) and isinstance(gone, dict):
        return {k: (_remove(v, gone[k]) if k in gone else v) for k, v in old.items()}
    if isinstance(old, list) and isinstance(gone, list):
        if any(isinstance(v, list) for v in gone) and all(isinstance(v, list) or v is None for v in old):
            g = gone + [None] * (len(old) - len(gone))
            return [_remove(x, y) for x, y in zip(old, g)]
        return [v for v in old if v not in gone]
    return old


def apply_corrections(rows, corrections, width):
    for id_, fields in corrections:
        row = rows.get(id_)
        if row is None:
            row = rows[id_] = [None] * width
        for key, value in fields.items():
            if not isinstance(key, tuple) or value is UNKNOWN:
                continue
            pos, op = key
            if op == "add":
                row[pos - 1] = _merge(row[pos - 1], value)
            elif op == "remove":
                row[pos - 1] = _remove(row[pos - 1], value)
            else:
                row[pos - 1] = value


def load_dump(path, keys):
    """Rows saved in game by OpenXP's /oxp questdump, as {kind: {id: row}}.
    The dump names its own field order, so rows are re-ordered to ours."""
    text = read(path)
    m = re.search(r"^OXPQuestieDump = ", text, re.M)
    if not m:
        raise SystemExit("no OXPQuestieDump in %s: run /oxp questdump in game, then /reload" % path)
    nxt = re.search(r"^[A-Za-z_]\w* = ", text[m.end():], re.M)
    dump = parse(text[m.end():m.end() + nxt.start()] if nxt else text[m.end():])
    out = {}
    for kind in ("quest", "npc", "object", "item"):
        theirs = (dump.get("keys") or {}).get(kind) or {}
        rows = {}
        for id_, row in (dump.get(kind) or {}).items():
            if isinstance(row, list):
                row = {i: v for i, v in enumerate(row, 1)}
            mine = [None] * len(keys[kind])
            for name, pos in keys[kind].items():
                v = row.get(theirs.get(name, pos))
                if isinstance(v, dict):
                    v.pop("n", None)  # table.pack's count
                mine[pos - 1] = v
            rows[int(id_)] = mine
        out[kind] = rows
    return out


# ---------------------------------------------------------------------------
# Shaping rows for the website
# ---------------------------------------------------------------------------

def as_list(v):
    """A Lua array as a Python list, whatever shape the parser gave it."""
    if v is None or v is UNKNOWN:
        return []
    if isinstance(v, dict):
        ints = [k for k in v if isinstance(k, int)]
        return [v.get(i) for i in range(1, max(ints) + 1)] if ints else []
    return v if isinstance(v, list) else [v]


def ids(v):
    return [x for x in as_list(v) if isinstance(x, int) and x > 0]


def num(v, default=None):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else default


def group(v, i):
    """Member i (0-based) of {npcs, objects, items} style groups."""
    v = as_list(v)
    return ids(v[i]) if i < len(v) else []


def spawns(v):
    """{zone id: [[x, y], ...]} with real coordinates only."""
    out = {}
    if isinstance(v, dict):
        for zone, pts in v.items():
            good = [[round(p[0], 2), round(p[1], 2)] for p in as_list(pts)
                    if isinstance(p, list) and len(p) >= 2 and num(p[0], -1) >= 0 and num(p[1], -1) >= 0]
            if isinstance(zone, int) and good:
                out[zone] = good
    return out


def side(mask):
    mask = num(mask, 0) or 0
    a, h = bool(mask & ALLIANCE), bool(mask & HORDE)
    return "A" if a and not h else "H" if h and not a else "B"


def names_of(mask, table, everything):
    mask = num(mask, 0) or 0
    if not mask or mask & everything == everything:
        return None
    return [name for bit, name in table if mask & bit] or None


class Exporter:
    def __init__(self, db, K, zones, xp):
        self.q, self.n, self.o, self.i = db["quest"], db["npc"], db["object"], db["item"]
        self.K = K
        self.zones = zones  # {id: {"name":..., ...}}
        self.xp = xp
        self.parent = {}

    def f(self, kind, row, name):
        pos = self.K[kind][name]
        return row[pos - 1] if pos <= len(row) else None

    # -- entities ----------------------------------------------------------
    def npc(self, id_):
        row = self.n.get(id_)
        if not row or not isinstance(self.f("npc", row, "name"), str):
            return None
        lo, hi = num(self.f("npc", row, "minLevel"), 0), num(self.f("npc", row, "maxLevel"), 0)
        out = {"name": self.f("npc", row, "name")}
        if isinstance(self.f("npc", row, "subName"), str):
            out["title"] = self.f("npc", row, "subName")
        if lo or hi:
            out["level"] = [lo, hi] if hi != lo else [lo]
        if num(self.f("npc", row, "rank"), 0):
            out["rank"] = self.f("npc", row, "rank")  # 1 elite, 2 rare elite, 3 boss, 4 rare
        if isinstance(self.f("npc", row, "friendlyToFaction"), str):
            out["friendly"] = self.f("npc", row, "friendlyToFaction")  # "A", "H" or "AH"
        out["spawns"] = spawns(self.f("npc", row, "spawns"))
        return out

    def obj(self, id_):
        row = self.o.get(id_)
        if not row or not isinstance(self.f("object", row, "name"), str):
            return None
        return {"name": self.f("object", row, "name"), "spawns": spawns(self.f("object", row, "spawns"))}

    def item(self, id_):
        row = self.i.get(id_)
        if not row or not isinstance(self.f("item", row, "name"), str):
            return None
        out = {"name": self.f("item", row, "name")}
        for key, field in (("npcs", "npcDrops"), ("objects", "objectDrops"),
                           ("items", "itemDrops"), ("vendors", "vendors")):
            v = ids(self.f("item", row, field))
            if v:
                out[key] = v
        return out

    def zone_of_entity(self, kind, id_):
        row = (self.n if kind == "npc" else self.o).get(id_)
        if not row:
            return None
        sp = spawns(self.f(kind, row, "spawns"))
        if sp:
            return max(sp, key=lambda z: (z in self.zones and self.zones[z]["kind"] != "other", len(sp[z])))
        z = num(self.f(kind, row, "zoneID"), 0)
        return z or None

    # -- quests ------------------------------------------------------------
    def quest(self, id_):
        row = self.q[id_]
        g = lambda name: self.f("quest", row, name)  # noqa: E731
        if not isinstance(g("name"), str) or not g("name").strip():
            return None
        q = {"id": id_, "name": g("name"), "level": num(g("questLevel"), 0),
             "minLevel": num(g("requiredLevel"), 0), "side": side(g("requiredRaces"))}
        races = names_of(g("requiredRaces"), RACE_NAMES, ALLIANCE | HORDE)
        if races and (num(g("requiredRaces"), 0) & (ALLIANCE | HORDE)) not in (ALLIANCE, HORDE):
            q["races"] = races
        classes = names_of(g("requiredClasses"), CLASS_NAMES, PLAYABLE_CLASSES)
        if classes:
            q["classes"] = classes
        if id_ in self.xp:
            q["xp"] = self.xp[id_]
        text = [t for t in as_list(g("objectivesText")) if isinstance(t, str)]
        if text:
            q["text"] = " ".join(text)

        start = {k: v for k, v in (("npcs", group(g("startedBy"), 0)), ("objects", group(g("startedBy"), 1)),
                                    ("items", group(g("startedBy"), 2))) if v}
        end = {k: v for k, v in (("npcs", group(g("finishedBy"), 0)), ("objects", group(g("finishedBy"), 1))) if v}
        if start:
            q["start"] = start
        if end:
            q["end"] = end

        objectives = []
        obj = as_list(g("objectives"))
        for i, kind in enumerate(("npc", "object", "item")):
            for e in as_list(obj[i]) if i < len(obj) else []:
                e = as_list(e)
                if e and isinstance(e[0], int):
                    o = {"type": kind, "id": e[0]}
                    if len(e) > 1 and isinstance(e[1], str):
                        o["text"] = e[1]
                    objectives.append(o)
        rep = as_list(obj[3]) if len(obj) > 3 else []
        if len(rep) >= 2 and isinstance(rep[0], int):
            objectives.append({"type": "reputation", "id": rep[0], "value": rep[1]})
        for e in as_list(obj[4]) if len(obj) > 4 else []:
            e = as_list(e)
            if e and ids(e[0]):
                o = {"type": "killCredit", "ids": ids(e[0])}
                if len(e) > 1 and isinstance(e[1], int):
                    o["id"] = e[1]
                if len(e) > 2 and isinstance(e[2], str):
                    o["text"] = e[2]
                objectives.append(o)
        trig = as_list(g("triggerEnd"))
        if trig and isinstance(trig[0], str):
            o = {"type": "event", "text": trig[0]}
            if len(trig) > 1 and spawns(trig[1]):
                o["spawns"] = spawns(trig[1])
            objectives.append(o)
        if objectives:
            q["objectives"] = objectives
        if num(g("sourceItemId"), 0):
            q["givenItem"] = g("sourceItemId")

        # Quest chains. preAll: every one must be done first; preAny: one is enough.
        for key, field in (("preAll", "preQuestGroup"), ("preAny", "preQuestSingle"),
                           ("exclusiveTo", "exclusiveTo"), ("children", "childQuests"),
                           ("breadcrumbs", "breadcrumbs")):
            v = [x for x in ids(g(field)) if x in self.q]
            if v:
                q[key] = v
        for key, field in (("next", "nextQuestInChain"), ("parent", "parentQuest"),
                           ("breadcrumbFor", "breadcrumbForQuestId")):
            if num(g(field), 0) and g(field) in self.q:
                q[key] = g(field)

        sort = num(g("zoneOrSort"), 0) or 0
        if sort < 0:
            q["category"] = self.sort_names.get(sort, "Other")
        q["zone"] = self.quest_zone(sort, start, end)
        return q

    def quest_zone(self, sort, start, end):
        if sort > 0:
            z = self.parent.get(sort, sort)
            if z in self.zones and self.zones[z]["kind"] != "other":
                return z
        for where in (start, end):
            for kind, key in (("npc", "npcs"), ("object", "objects")):
                for id_ in where.get(key, []):
                    z = self.zone_of_entity(kind, id_)
                    if z:
                        return self.parent.get(z, z)
        return self.parent.get(sort, sort) if sort > 0 else 0


def zones_with_maps(zones):
    return {z for z, info in zones.items() if info["kind"] in ("zone", "dungeon")}


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--questiedb", required=True, help="path to a checkout of github.com/Questie/QuestieDB")
    ap.add_argument("--dump", help="OpenXP.lua saved variables holding a /oxp questdump (optional)")
    ap.add_argument("--out", default="public/data", help="output folder (default: public/data)")
    args = ap.parse_args()
    qdb = args.questiedb
    fdir = os.path.join(qdb, "src", "corrections", "Forever")

    K = {kind: load_keys(qdb, kind) for kind in ("quest", "npc", "object", "item")}
    zone_ids = load_named_ids(os.path.join(qdb, "src", "corrections", "enum", "zones.lua"))
    sort_ids = load_named_ids(os.path.join(qdb, "src", "corrections", "enum", "quests.lua"),
                              "constants.sortKeys = {")
    names = {
        "questKeys": field_names(K["quest"]), "npcKeys": field_names(K["npc"]),
        "objectKeys": field_names(K["object"]), "itemKeys": field_names(K["item"]),
        "zoneIDs": zone_ids, "sortKeys": sort_ids, "raceIDs": RACES, "raceKeys": RACES,
        "classIDs": CLASSES, "classKeys": CLASSES, "npcFlags": NPC_FLAGS,
    }

    # raw rows, then Questie's layers in its own order (docs/forever.md):
    # inherited Classic fixes -> generated Forever base -> traces -> Forever fixes
    files = {"quest": ("Quest", "Quest", "Quest"), "npc": ("Npc", "NPC", "Npc"),
             "object": ("Object", "Object", "Object"), "item": ("Item", "Item", "Item")}
    db, report = {}, []
    for kind, (data_name, fix_name, gen_name) in files.items():
        width = max(K[kind].values())
        rows = load_raw(os.path.join(qdb, "data", "Forever", "forever%sDB.lua" % data_name), width)
        raw = len(rows)
        layers = [("legacy/classic%sFixes.lua" % fix_name, "Load")]
        if kind == "item":
            layers.append(("legacy/itemStartFixes.lua", "LoadAutomaticQuestStarts"))
        layers += [("generated/foreverBase%s.lua" % gen_name, "Load"),
                   ("traces/forever%sTraces.lua" % gen_name, "Load"),
                   ("forever%sFixes.lua" % fix_name, "Load")]
        for rel, func in layers:
            path = os.path.join(fdir, rel)
            if not os.path.exists(path):
                report.append("  missing, skipped: %s" % rel)
                continue
            corr, skipped = load_corrections(path, names, func)
            apply_corrections(rows, corr, width)
            report.append("  %-36s %5d entries%s" % (rel, len(corr), ", %d unreadable" % skipped if skipped else ""))
        db[kind] = rows
        report.append("%s: %d raw rows, %d after corrections" % (kind, raw, len(rows)))
    if args.dump:
        for kind, rows in load_dump(args.dump, K).items():
            db[kind].update(rows)
            report.append("%s: %d rows from the in-game dump" % (kind, len(rows)))

    # quest XP: {id: xp}
    xp = {}
    for name in ("xpDB-classic.lua", "xpDB-traces.lua"):
        path = os.path.join(qdb, "support", "Forever", "QuestXP", name)
        if os.path.exists(path):
            for m in re.finditer(r"\[(\d+)\] = \{\s*(\d+),\s*(\d+)\s*\}", read(path)):
                xp[int(m.group(1))] = int(m.group(3))

    # zones: outdoor maps (with their in-game map id), dungeons, then anything else named
    zones = {}
    conv = json.load(open(os.path.join(qdb, "data", "Forever", "conversion.json"), encoding="utf-8"))
    for t in conv["geometry"]["transforms"]:
        zones[t["area_id"]] = {"id": t["area_id"], "name": t["target_name"], "kind": "zone",
                               "uiMapId": t["ui_map_id"], "continent": CONTINENTS.get(t.get("map_id"))}
    zdir = os.path.join(qdb, "support", "Forever", "Zones")
    ui_to_area = {int(m.group(1)): int(m.group(2)) for m in
                  re.finditer(r"\[(\d+)\] = (\d+),", read(os.path.join(zdir, "uiMapIdToAreaId.lua")))}
    for m in conv["geometry"].get("added_maps", []):  # WoW Forever's new zones
        area = ui_to_area.get(m["ui_map_id"])
        if area and area not in zones:
            zones[area] = {"id": area, "name": m["target_name"], "kind": "zone", "uiMapId": m["ui_map_id"]}
    for m in re.finditer(r'^\s*\[(\d+)\] = (\{"[^\n]*\}),', read(os.path.join(zdir, "dungeons.lua")), re.M):
        try:
            d = parse(m.group(2))
        except ValueError:  # an entrance that depends on your faction
            d = [re.match(r'\{"([^"]*)"', m.group(2)).group(1)]
        z = {"id": int(m.group(1)), "name": d[0], "kind": "dungeon"}
        ent = as_list(d[3]) if len(d) > 3 else []
        if ent and len(as_list(ent[0])) >= 3:
            z["entrance"] = {"zone": ent[0][0], "x": ent[0][1], "y": ent[0][2]}
        zones.setdefault(z["id"], z)
    for name, id_ in zone_ids.items():
        if id_ > 0 and id_ not in zones:
            zones[id_] = {"id": id_, "name": pretty(name), "kind": "other"}
    parent = {}
    for m in re.finditer(r"\[(\d+)\] = (\d+),", read(os.path.join(zdir, "subZoneToParentZone.lua"))):
        if int(m.group(1)) != int(m.group(2)):
            parent[int(m.group(1))] = int(m.group(2))

    # subzones without a parent entry: the map they're drawn on says where they are
    for m in re.finditer(r"\[(\d+)\] = (\d+),", read(os.path.join(zdir, "areaIdToUiMapId.lua"))):
        area, on = int(m.group(1)), ui_to_area.get(int(m.group(2)))
        if on and on != area and area not in zones_with_maps(zones) and area not in parent:
            parent[area] = on

    ex = Exporter(db, K, zones, xp)
    ex.parent = parent
    ex.sort_names = {v: pretty(k) for k, v in sort_ids.items()}

    # a zone that holds spawns is a real place even if it has no map of its own
    seen = set()
    for kind, rows in (("npc", db["npc"]), ("object", db["object"])):
        for row in rows.values():
            seen.update(spawns(ex.f(kind, row, "spawns")))
    for z in seen:
        if z in zones and zones[z]["kind"] == "other":
            zones[z]["kind"] = "area"

    quests = {}
    for id_ in sorted(db["quest"]):
        q = ex.quest(id_)
        if q:
            quests[id_] = q

    by_zone = {}
    for q in quests.values():
        by_zone.setdefault(q["zone"], []).append(q)

    out = args.out
    total = 0
    zone_list = []
    for z, qs in sorted(by_zone.items()):
        info = dict(zones.get(z) or {"id": z, "name": "Other" if not z else "Area %d" % z, "kind": "other"})
        info.pop("continent", None) if info.get("continent") is None else None
        npcs, objects, items = {}, {}, {}

        def want_npc(id_):
            if id_ not in npcs:
                n = ex.npc(id_)
                if n:
                    npcs[id_] = n

        def want_obj(id_):
            if id_ not in objects:
                o = ex.obj(id_)
                if o:
                    objects[id_] = o

        def want_item(id_, depth=0):
            if id_ in items:
                return
            it = ex.item(id_)
            if not it:
                return
            items[id_] = it
            if len(it.get("npcs", [])) > MAX_DROP_SOURCES:
                here = [n for n in it["npcs"] if z in spawns(ex.f("npc", db["npc"].get(n) or [], "spawns"))]
                it["npcsTotal"] = len(it["npcs"])
                it["npcs"] = (here + [n for n in it["npcs"] if n not in here])[:MAX_DROP_SOURCES]
            for n in it.get("npcs", []) + it.get("vendors", []):
                want_npc(n)
            for o in it.get("objects", []):
                want_obj(o)
            if depth < 2:  # an item inside another item (a chest, a clam)
                for sub in it.get("items", []):
                    want_item(sub, depth + 1)

        for q in qs:
            for where in ("start", "end"):
                for n in q.get(where, {}).get("npcs", []):
                    want_npc(n)
                for o in q.get(where, {}).get("objects", []):
                    want_obj(o)
                for i in q.get(where, {}).get("items", []):
                    want_item(i)
            for o in q.get("objectives", []):
                if o["type"] == "npc":
                    want_npc(o["id"])
                elif o["type"] == "object":
                    want_obj(o["id"])
                elif o["type"] == "item":
                    want_item(o["id"])
                elif o["type"] == "killCredit":
                    for n in o["ids"]:
                        want_npc(n)
            if q.get("givenItem"):
                want_item(q["givenItem"])

        services = {}
        for id_, row in db["npc"].items():
            flags = num(ex.f("npc", row, "npcFlags"), 0) or 0
            if not flags or z not in spawns(ex.f("npc", row, "spawns")):
                continue
            for key, bit in SERVICES:
                if flags & bit:
                    services.setdefault(key, []).append(id_)
                    want_npc(id_)

        levels = sorted(q["level"] for q in qs if q["level"] and q["level"] > 0)
        if levels:
            info["levels"] = [levels[len(levels) // 10], levels[(len(levels) * 9) // 10 - (len(levels) > 9)]]
        info["quests"] = {"A": sum(q["side"] != "H" for q in qs), "H": sum(q["side"] != "A" for q in qs)}
        zone_list.append(info)
        total += write_json(os.path.join(out, "zones", "%d.json" % z), {
            "zone": info,
            "quests": sorted(qs, key=lambda q: (q["level"], q["minLevel"], q["id"])),
            "npcs": npcs, "objects": objects, "items": items, "services": services,
        })

    total += write_json(os.path.join(out, "quests.json"), {
        "fields": ["id", "name", "level", "minLevel", "side", "zone"],
        "quests": [[q["id"], q["name"], q["level"], q["minLevel"], q["side"], q["zone"]]
                   for q in quests.values()],
    })
    try:
        commit = subprocess.run(["git", "-C", qdb, "rev-parse", "HEAD"], capture_output=True,
                                text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    order = {"zone": 0, "dungeon": 1, "area": 2, "other": 3}
    total += write_json(os.path.join(out, "index.json"), {
        "format": FORMAT,
        "generated": datetime.date.today().isoformat(),
        "source": {"name": "QuestieDB", "url": "https://github.com/Questie/QuestieDB", "commit": commit,
                   "license": "GPL-3.0", "build": conv["geometry"].get("target_build"), "inGameDump": bool(args.dump)},
        "counts": {"quests": len(quests), "zones": len(zone_list)},
        "zones": sorted(zone_list, key=lambda z: (order[z["kind"]], z["name"])),
    })

    print("\n".join(report))
    print("wrote %d quests in %d zones to %s (%.1f MB)" % (len(quests), len(zone_list), out, total / 1e6))


if __name__ == "__main__":
    main()
