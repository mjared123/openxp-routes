/** The quest data written by tools/export_data.py (public/data). */

export type Side = "A" | "H" | "B";
export type Faction = "A" | "H";
export type Point = [x: number, y: number];
export type Spawns = Record<string, Point[]>;

export interface ZoneInfo {
  id: number;
  name: string;
  kind: "zone" | "dungeon" | "area" | "other";
  uiMapId?: number;
  continent?: string;
  levels?: [number, number];
  quests: { A: number; H: number };
  entrance?: { zone: number; x: number; y: number };
  /** The map's edges in world yards: left, right, top, bottom. */
  bounds?: [number, number, number, number];
}

export interface Objective {
  type: "npc" | "object" | "item" | "killCredit" | "reputation" | "event";
  id?: number;
  ids?: number[];
  text?: string;
  spawns?: Spawns;
}

export interface Quest {
  id: number;
  name: string;
  level: number;
  minLevel: number;
  side: Side;
  zone: number;
  races?: string[];
  classes?: string[];
  xp?: number;
  text?: string;
  category?: string;
  givenItem?: number;
  start?: { npcs?: number[]; objects?: number[]; items?: number[] };
  end?: { npcs?: number[]; objects?: number[] };
  objectives?: Objective[];
  preAll?: number[];
  preAny?: number[];
  next?: number;
  /** Items the quest gives or lets you choose from. */
  rewards?: number[];
  repeatable?: boolean;
  raid?: boolean;
  /** What it sends you after is elite: a job for a group. */
  elite?: boolean;
  /** A profession and the skill it needs. */
  skill?: [string, number];
  /** Has a timer once accepted. */
  timed?: boolean;
  /** You walk someone to safety. */
  escort?: boolean;
  /** Things worth knowing before you start, from Polestar's forever-db (CC BY 4.0). */
  notes?: string[];
}

export interface Npc {
  name: string;
  title?: string;
  level?: number[];
  rank?: number;
  friendly?: string;
  spawns: Spawns;
}
export interface GameObject {
  name: string;
  spawns: Spawns;
}
export interface Item {
  name: string;
  npcs?: number[];
  objects?: number[];
  vendors?: number[];
  /** 2 weapon, 4 armour, with the game's subclass (see character.ts). */
  cls?: number;
  sub?: number;
  ilvl?: number;
  req?: number;
  /** Drop chance in percent, by NPC id. */
  drop?: Record<string, number>;
}

export type Service = "flight" | "inn" | "trainer" | "repair" | "vendor" | "bank" | "stable";

export interface ZoneData {
  zone: ZoneInfo;
  quests: Quest[];
  npcs: Record<string, Npc>;
  objects: Record<string, GameObject>;
  items: Record<string, Item>;
  services: Partial<Record<Service, number[]>>;
  /** Dungeons: who drops gear, as far as the data knows. */
  bosses?: { npc: number; loot: number[] }[];
}

export interface DataIndex {
  generated: string;
  source: { name: string; url: string; commit: string | null; build: string | null };
  counts: { quests: number; zones: number };
  zones: ZoneInfo[];
}

/**
 * [id, name, level, minLevel, side, zone, xp, preAll, preAny, classes, races, category, profession, flags];
 * empty fields are 0. flags: 1 elite, 2 repeatable, 4 raid, 8 starts from an item.
 */
export type QuestRow = [number, string, number, number, Side, number, number, number[] | 0, number[] | 0, string[] | 0, string[] | 0, string | 0, string | 0, number];

/** A quest reward worth asking a route for. */
export interface GoalItem extends Item {
  id: number;
  quest: number;
  /** How many quests deep in its chain the rewarding quest is. */
  chain: number;
  featured?: string;
}
export interface BossItem extends Item {
  id: number;
  npc: number;
  boss: string;
  zone: number;
}
export interface Recipe {
  id: number;
  name: string;
  profession: string;
  ilvl?: number;
  vendors?: { npc: number; name: string; zone: number; at: Point; friendly?: string }[];
  quests?: number[];
}
export interface GoalData {
  items: GoalItem[];
  bossItems: BossItem[];
  recipes: Recipe[];
}

const base = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export const loadIndex = () => getJson<DataIndex>("index.json");
export const loadGoals = () => getJson<GoalData>("goals.json");

/** A tooltip line: plain text, or [text, format, text on the right]. */
export type TipLine = string | [string, string, string?];
/** [icon name, quality 0-5 (-1 when unknown), tooltip lines] */
export type ItemInfo = [string, number, TipLine[]];
export type ItemTable = Record<number, ItemInfo>;
export const loadItems = () => getJson<ItemTable>("items.json");
export const loadQuestRows = async () => (await getJson<{ quests: QuestRow[] }>("quests.json")).quests;

const zoneCache = new Map<number, Promise<ZoneData>>();
export function loadZone(id: number): Promise<ZoneData> {
  let hit = zoneCache.get(id);
  if (!hit) {
    hit = getJson<ZoneData>(`zones/${id}.json`);
    hit.catch(() => zoneCache.delete(id));
    zoneCache.set(id, hit);
  }
  return hit;
}

export function forFaction(side: Side, faction: Faction): boolean {
  return side === "B" || side === faction;
}

/** Where to stand for a set of spawn points: the point with the most others nearby. */
export function bestSpot(points: Point[], radius = 6): Point | undefined {
  if (points.length <= 2) return points[0];
  let best = points[0]!;
  let bestCount = -1;
  for (const p of points) {
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (const q of points) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= radius) {
        count++;
        sx += q[0];
        sy += q[1];
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = [sx / count, sy / count];
    }
  }
  return best;
}
