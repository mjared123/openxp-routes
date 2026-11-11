#!/usr/bin/env python3
"""Add icons and tooltips for every item the site shows.

Questie's data has no icons, quality or stats, so those come from two other
open sources:

  * the `wow-classic-items` package (MIT, github.com/Nakroma/wow-classic-items):
    icon name, quality and tooltip lines for Classic items
  * github.com/Gethe/wow-ui-textures: the game's icon textures (ICONS folder)

Items that only exist in Forever are not in that package. They get an icon that
fits their type and a short tooltip built from what Questie knows.

    npm pack wow-classic-items            # then unpack the .tgz
    python3 tools/export_items.py --items package/data/json/data.json \
        --icons <folder of icon PNGs named in lower case>

Writes public/data/items.json and public/icons/<name>.webp. Run it after
export_data.py. `--icons` may be left out to refresh the tooltips only.
"""
import argparse
import glob
import json
import os

QUALITY = {"Poor": 0, "Common": 1, "Uncommon": 2, "Rare": 3, "Epic": 4, "Legendary": 5}
FORMAT = {"Misc": "m", "Uncommon": "g", "indent": "i", "Poor": "p", "Rare": "r",
          "Epic": "e", "Legendary": "l"}
DROP = ("Sell Price:", "Phase ")

WEAPON = {0: ("One-Hand", "Axe", "inv_axe_04"), 1: ("Two-Hand", "Axe", "inv_axe_04"),
          2: ("Ranged", "Bow", "inv_weapon_bow_02"), 3: ("Ranged", "Gun", "inv_weapon_rifle_01"),
          4: ("One-Hand", "Mace", "inv_mace_01"), 5: ("Two-Hand", "Mace", "inv_mace_01"),
          6: ("Two-Hand", "Polearm", "inv_staff_08"), 7: ("One-Hand", "Sword", "inv_sword_04"),
          8: ("Two-Hand", "Sword", "inv_sword_04"), 10: ("Two-Hand", "Staff", "inv_staff_08"),
          13: ("One-Hand", "Fist Weapon", "inv_gauntlets_04"),
          15: ("One-Hand", "Dagger", "inv_weapon_shortblade_05"),
          16: ("Thrown", "Thrown", "inv_weapon_shortblade_05"),
          18: ("Ranged", "Crossbow", "inv_weapon_bow_02"), 19: ("Ranged", "Wand", "inv_wand_02"),
          20: ("Two-Hand", "Fishing Pole", "inv_staff_08")}
ARMOUR = {0: ("Miscellaneous", "inv_jewelry_ring_03"), 1: ("Cloth", "inv_chest_cloth_17"),
          2: ("Leather", "inv_chest_cloth_17"), 3: ("Mail", "inv_chest_cloth_17"),
          4: ("Plate", "inv_chest_cloth_17"), 6: ("Shield", "inv_shield_04"),
          7: ("Libram", "inv_jewelry_talisman_01"), 8: ("Idol", "inv_jewelry_talisman_01"),
          9: ("Totem", "inv_jewelry_talisman_01")}
OTHER = {0: "inv_potion_54", 1: "inv_misc_bag_10", 7: "inv_fabric_linen_01",
         9: "inv_scroll_03", 12: "inv_misc_note_01"}
UNKNOWN = "inv_misc_questionmark"
# Forever items worth a hand-picked icon
ICONS = {211527: "inv_misc_bag_08"}


def tooltip(lines):
    """The package's tooltip lines, without the name, as compact rows."""
    out = []
    for line in lines[1:]:
        text = (line.get("label") or "").replace(" ", " ").strip()
        fmt = line.get("format")
        if not text or text.startswith(DROP):
            continue
        if fmt == "alignRight":
            if out:
                last = out[-1]
                out[-1] = [last, "", text] if isinstance(last, str) else [last[0], last[1], text]
            continue
        code = FORMAT.get(fmt, "")
        out.append([text, code] if code else text)
    return out


def guess(item):
    """Icon and tooltip for an item the package doesn't know."""
    cls, sub = item.get("cls"), item.get("sub")
    lines, icon = [], OTHER.get(cls, UNKNOWN)
    if item.get("ilvl"):
        lines.append(["Item Level %d" % item["ilvl"], "m"])
    if cls == 2 and sub in WEAPON:
        slot, kind, icon = WEAPON[sub]
        lines.append([slot, "", kind] if slot != kind else slot)
    elif cls == 4 and sub in ARMOUR:
        kind, icon = ARMOUR[sub]
        lines.append(kind)
    if item.get("req"):
        lines.append("Requires Level %d" % item["req"])
    return icon, lines


def referenced(out):
    """Every item the exported data mentions, with what Questie knows about it."""
    items = {}
    for path in glob.glob(os.path.join(out, "zones", "*.json")):
        with open(path) as f:
            for key, item in json.load(f).get("items", {}).items():
                items.setdefault(int(key), item)
    with open(os.path.join(out, "goals.json")) as f:
        goals = json.load(f)
    for group in ("items", "bossItems", "recipes"):
        for item in goals[group]:
            items.setdefault(item["id"], dict(item, cls=9) if group == "recipes" else item)
    return items


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--items", required=True, help="data/json/data.json of the wow-classic-items package")
    ap.add_argument("--icons", help="folder of icon PNGs, file names in lower case")
    ap.add_argument("--out", default="public/data", help="data folder (default: public/data)")
    ap.add_argument("--icon-out", default="public/icons", help="icon folder (default: public/icons)")
    args = ap.parse_args()

    with open(args.items) as f:
        known = {row["itemId"]: row for row in json.load(f)}
    items = referenced(args.out)
    result, used, guessed = {}, set(), 0
    for item_id in sorted(items):
        row = known.get(item_id)
        if row:
            icon = row["icon"].lower()
            result[item_id] = [icon, QUALITY.get(row.get("quality"), 1), tooltip(row["tooltip"])]
        else:
            icon, lines = guess(items[item_id])
            icon = ICONS.get(item_id, icon)
            result[item_id] = [icon, -1, lines]
            guessed += 1
        used.add(icon)

    missing = set()
    if args.icons:
        from PIL import Image
        os.makedirs(args.icon_out, exist_ok=True)
        for icon in sorted(used | {UNKNOWN}):
            src = os.path.join(args.icons, icon + ".png")
            if not os.path.exists(src):
                missing.add(icon)
                continue
            Image.open(src).convert("RGB").save(
                os.path.join(args.icon_out, icon + ".webp"), "WEBP", quality=82, method=6)
    else:
        missing = {i for i in used if not os.path.exists(os.path.join(args.icon_out, i + ".webp"))}
    for row in result.values():
        if row[0] in missing:
            row[0] = UNKNOWN

    with open(os.path.join(args.out, "items.json"), "w") as f:
        json.dump(result, f, separators=(",", ":"), ensure_ascii=False)
    print("%d items: %d with full tooltips, %d Forever-only with a type icon; %d icons, %d not found"
          % (len(result), len(result) - guessed, guessed, len(used), len(missing)))


if __name__ == "__main__":
    main()
