/** Who the route is for, and what that character can pick up and use. */
import type { DataIndex, Faction, Item, Side } from "./data";

export type Style = "fast" | "balanced" | "complete";

export interface Character {
  faction: Faction;
  race: string;
  cls: string;
  /** Level the route starts at. */
  level: number;
  hardcore: boolean;
  style: Style;
  /** Include dungeon quests when picking quests automatically. */
  dungeons: boolean;
  /** Include elite (group) quests when picking quests automatically. */
  groups: boolean;
}

export const RACES: Record<Faction, string[]> = {
  A: ["Human", "Dwarf", "Night Elf", "Gnome", "Skyborne"],
  H: ["Orc", "Undead", "Tauren", "Troll", "Skyborne"],
};
export const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];

export const STYLES: Record<Style, { label: string; about: string }> = {
  fast: { label: "Fast", about: "Only quests that pay well for the time. Skips long collection quests and far-away turn-ins." },
  balanced: { label: "Balanced", about: "Every quest that is worth XP at your level." },
  complete: { label: "Everything", about: "Every quest you can pick up, even ones that are low level for you." },
};

export const DEFAULT_CHARACTER: Character = { faction: "A", race: "Human", cls: "Warrior", level: 1, hardcore: false, style: "balanced", dungeons: false, groups: false };

/** The race as quest data names it. */
export function questRace(c: Character): string {
  return c.race === "Skyborne" ? `Skyborne (${c.faction === "A" ? "Alliance" : "Horde"})` : c.race;
}

export const START_ZONE: Record<string, string> = {
  Human: "Elwynn Forest", Dwarf: "Dun Morogh", Gnome: "Dun Morogh", "Night Elf": "Teldrassil",
  Orc: "Durotar", Troll: "Durotar", Undead: "Tirisfal Glades", Tauren: "Mulgore", Skyborne: "Zephras Isle",
};

/** Where a new character of this race starts. */
export function startZone(c: Character, index: DataIndex): number | undefined {
  const named = index.zones.find((z) => z.kind === "zone" && z.name === START_ZONE[c.race]);
  return (named ?? index.zones.find((z) => z.kind === "zone" && z.quests[c.faction] > 0))?.id;
}

/** Can this character ever pick the quest up? (Level and prerequisites aside.) */
export function canTake(c: Character, quest: { side: Side; classes?: string[] | 0; races?: string[] | 0 }): boolean {
  if (quest.side !== "B" && quest.side !== c.faction) return false;
  if (quest.classes && quest.classes.length && !quest.classes.includes(c.cls)) return false;
  if (quest.races && quest.races.length && !quest.races.includes(questRace(c))) return false;
  return true;
}

// The game's item subclasses.
const ARMOUR: Record<number, string> = { 0: "Misc", 1: "Cloth", 2: "Leather", 3: "Mail", 4: "Plate", 6: "Shield", 7: "Libram", 8: "Idol", 9: "Totem" };
const WEAPON: Record<number, string> = {
  0: "Axe", 1: "Two-handed axe", 2: "Bow", 3: "Gun", 4: "Mace", 5: "Two-handed mace", 6: "Polearm", 7: "Sword", 8: "Two-handed sword", 10: "Staff",
  13: "Fist weapon", 14: "Tool", 15: "Dagger", 16: "Thrown", 17: "Spear", 18: "Crossbow", 19: "Wand", 20: "Fishing pole",
};
const WEAPONS_BY_CLASS: Record<string, number[]> = {
  Warrior: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18],
  Paladin: [0, 1, 4, 5, 6, 7, 8],
  Hunter: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18],
  Rogue: [2, 3, 4, 7, 13, 15, 16, 18],
  Priest: [4, 10, 15, 19],
  Shaman: [0, 1, 4, 5, 10, 13, 15],
  Mage: [7, 10, 15, 19],
  Warlock: [7, 10, 15, 19],
  Druid: [4, 5, 10, 13, 15],
};
/** Heaviest armour by class: [below 40, from 40]. */
const ARMOUR_BY_CLASS: Record<string, [number, number]> = {
  Warrior: [3, 4], Paladin: [3, 4], Hunter: [2, 3], Shaman: [2, 3], Rogue: [2, 2], Druid: [2, 2], Priest: [1, 1], Mage: [1, 1], Warlock: [1, 1],
};
const SPECIAL: Record<number, string[]> = { 6: ["Warrior", "Paladin", "Shaman"], 7: ["Paladin"], 8: ["Druid"], 9: ["Shaman"] };

/** "Sword", "Leather"…, or nothing for items that aren't gear. */
export function itemType(item: Item): string | undefined {
  if (item.cls === 2) return WEAPON[item.sub ?? -1] ?? "Weapon";
  if (item.cls === 4) return ARMOUR[item.sub ?? -1] ?? "Armour";
  return undefined;
}

/** Whether a class can equip a piece of gear at a level. Things that aren't gear count as usable. */
export function canUse(item: Item, cls: string, level: number): boolean {
  if (item.cls === 2) return WEAPONS_BY_CLASS[cls]?.includes(item.sub ?? -1) ?? true;
  if (item.cls !== 4) return true;
  const sub = item.sub ?? 0;
  if (SPECIAL[sub]) return SPECIAL[sub]!.includes(cls);
  if (sub === 0) return true;
  const [early, late] = ARMOUR_BY_CLASS[cls] ?? [4, 4];
  return sub <= (level >= 40 ? late : early);
}

/** Gear that is the heaviest armour the class wears, or a weapon it can use: worth pointing out. */
export function isUpgradeType(item: Item, cls: string, level: number): boolean {
  if (!item.cls || !canUse(item, cls, level)) return false;
  if (item.cls === 2 || SPECIAL[item.sub ?? 0] || item.sub === 0) return true;
  const [early, late] = ARMOUR_BY_CLASS[cls] ?? [4, 4];
  return item.sub === (level >= 40 ? late : early);
}
