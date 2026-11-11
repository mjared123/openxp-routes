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
  start?: { npcs?: number[]; objects?: number[]; items?: number[] };
  end?: { npcs?: number[]; objects?: number[] };
  objectives?: Objective[];
  preAll?: number[];
  preAny?: number[];
  next?: number;
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
}

export type Service = "flight" | "inn" | "trainer" | "repair" | "vendor" | "bank" | "stable";

export interface ZoneData {
  zone: ZoneInfo;
  quests: Quest[];
  npcs: Record<string, Npc>;
  objects: Record<string, GameObject>;
  items: Record<string, Item>;
  services: Partial<Record<Service, number[]>>;
}

export interface DataIndex {
  generated: string;
  source: { name: string; url: string; commit: string | null; build: string | null };
  counts: { quests: number; zones: number };
  zones: ZoneInfo[];
}

/** [id, name, level, minLevel, side, zone] */
export type QuestRow = [number, string, number, number, Side, number];

const base = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export const loadIndex = () => getJson<DataIndex>("index.json");
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
