"""Tests for the Lua reader and the correction layers.

Run: python3 -m unittest discover -s tools/tests
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import export_data as E  # noqa: E402
from lua_values import UNKNOWN, parse  # noqa: E402


class LuaValues(unittest.TestCase):
    def test_rows(self):
        row = parse("""{"Sharptalon's Claw",{nil,nil,{16305}},{{12696}},20,30,8589934770,nil,'it\\'s'}""")
        self.assertEqual(row, ["Sharptalon's Claw", [None, None, [16305]], [[12696]], 20, 30,
                               8589934770, None, "it's"])

    def test_keyed_tables_and_numbers(self):
        self.assertEqual(parse("{[12]={{36.43,55.89},{-1,-1}}}"), {12: [[36.43, 55.89], [-1, -1]]})
        self.assertEqual(parse("{}"), [])

    def test_names(self):
        names = {"zoneIDs": {"ASHENVALE": 331}, "raceIDs": {"A": 1, "B": 4}}
        self.assertEqual(parse("{[zoneIDs.ASHENVALE] = raceIDs.A + raceIDs.B}", names), {331: 5})
        self.assertIs(parse("Questie.ICON_TYPE_EVENT"), UNKNOWN)
        self.assertIs(parse("Questie.X + 1"), UNKNOWN)
        self.assertEqual(parse('l10n("Kill Xabraxxis")'), "Kill Xabraxxis")

    def test_comments(self):
        self.assertEqual(parse("{1, -- one\n 2, --[[ two ]] 3}"), [1, 2, 3])


FIXES = """
function Fixes:LoadOther()
    return { [1] = { [questKeys.name] = "wrong function" } }
end
function Fixes:Load()
    local questKeys = QuestieDB.questKeys
    return {
        [1] = { -- set
            [questKeys.name] = "New name",
            [questKeys.startedBy_add] = {nil, {500}},
        },
        [2] = {
            [questKeys.name] = isHorde and "a" or "b",
        },
        [3] = { -- a new quest
            [questKeys.name] = "Brand new",
            [questKeys.zoneOrSort] = zoneIDs.ASHENVALE,
            [questKeys.startedBy_remove] = {{7}},
        },
    }
end
"""


class Corrections(unittest.TestCase):
    def setUp(self):
        self.keys = {"name": 1, "startedBy": 2, "zoneOrSort": 3}
        self.names = {"questKeys": E.field_names(self.keys), "zoneIDs": {"ASHENVALE": 331}}

    def load(self):
        with tempfile.NamedTemporaryFile("w", suffix=".lua", delete=False) as f:
            f.write(FIXES)
        try:
            return E.load_corrections(f.name, self.names)
        finally:
            os.unlink(f.name)

    def test_layers(self):
        corr, skipped = self.load()
        self.assertEqual(skipped, 1)  # entry 2 isn't plain data; the rest still load
        rows = {1: ["Old", [[7], [400]], 12], 2: ["Kept", None, 12]}
        E.apply_corrections(rows, corr, 3)
        self.assertEqual(rows[1], ["New name", [[7], [400, 500]], 12])
        self.assertEqual(rows[2], ["Kept", None, 12])
        self.assertEqual(rows[3], ["Brand new", None, 331])

    def test_merge_and_remove(self):
        self.assertEqual(E._merge([1, 2], [2, 3]), [1, 2, 3])
        self.assertEqual(E._merge({12: [[1, 1]]}, {12: [[2, 2]], 40: [[3, 3]]}),
                         {12: [[1, 1], [2, 2]], 40: [[3, 3]]})
        self.assertEqual(E._remove([[7, 8], [9]], [[7]]), [[8], [9]])
        self.assertEqual(E._remove([1, 2, 3], [2]), [1, 3])


DUMP = """
OXPSettings = {
}
OXPQuestieDump = {
["time"] = "2026-11-10 20:00",
["keys"] = {
["quest"] = {
["startedBy"] = 1,
["name"] = 2,
},
},
["quest"] = {
[90001] = {
{
{
123, -- [1]
}, -- [1]
["n"] = 3,
}, -- [1]
"From the game", -- [2]
},
},
}
OXPData = {
}
"""


class Dump(unittest.TestCase):
    def test_dump_rows_follow_our_field_order(self):
        with tempfile.NamedTemporaryFile("w", suffix=".lua", delete=False) as f:
            f.write(DUMP)
        try:
            keys = {"quest": {"name": 1, "startedBy": 2}, "npc": {"name": 1},
                    "object": {"name": 1}, "item": {"name": 1}}
            rows = E.load_dump(f.name, keys)
        finally:
            os.unlink(f.name)
        self.assertEqual(rows["quest"][90001][0], "From the game")
        self.assertEqual(E.group(rows["quest"][90001][1], 0), [123])


class Shaping(unittest.TestCase):
    def test_side(self):
        self.assertEqual(E.side(E.ALLIANCE), "A")
        self.assertEqual(E.side(1 << 33), "H")
        self.assertEqual(E.side(None), "B")
        self.assertEqual(E.side(1 | 2), "B")

    def test_spawns_drop_placeholders(self):
        self.assertEqual(E.spawns({12: [[1.234, 5], [-1, -1]], 209: [[-1, -1]]}), {12: [[1.23, 5]]})


if __name__ == "__main__":
    unittest.main()
