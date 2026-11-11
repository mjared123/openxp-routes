/**
 * What the editor knows about quests: a short entry for every quest (from
 * quests.json) and the full quest for zones that are loaded.
 */
import type { Item, Npc, Objective, Quest, QuestRow, Side, ZoneData, ZoneInfo } from "./data";

export interface QuestMeta {
  id: number;
  name: string;
  level: number;
  minLevel: number;
  side: Side;
  zone: number;
  xp: number;
  preAll: number[];
  preAny: number[];
  classes: string[];
  races: string[];
}

/** An estimate of what one objective takes. */
export interface Work {
  /** How many the quest asks for. */
  count: number;
  /** Mobs you kill for it (more than `count` when the item doesn't always drop). */
  kills: number;
  mobLevel: number;
  minutes: number;
}

const MINUTES_PER_KILL = 0.55;
const MINUTES_PER_CLICK = 0.4;
const DEFAULT_DROP = 50;
const MAX_KILLS = 40;

function metaOf(row: QuestRow): QuestMeta {
  return { id: row[0], name: row[1], level: row[2], minLevel: row[3], side: row[4], zone: row[5], xp: row[6] || 0, preAll: row[7] || [], preAny: row[8] || [], classes: row[9] || [], races: row[10] || [] };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Kill 10 Kobold Vermin" → 10, for the thing named. */
export function countInText(text: string | undefined, name: string | undefined): number | undefined {
  if (!text || !name) return undefined;
  const stem = name.length >= 6 ? name.slice(0, -2) : name;
  const m = new RegExp(`(\\d+)\\s+(?:of\\s+)?(?:the\\s+)?${escape(stem)}`, "i").exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n <= 200 ? n : undefined;
}

function spawnCount(e: { spawns: Record<string, unknown[]> } | undefined): number {
  return e ? Object.values(e.spawns).reduce((n, points) => n + points.length, 0) : 0;
}

function levelOfNpcs(npcs: (Npc | undefined)[], fallback: number): number {
  const levels = npcs.flatMap((n) => (n?.level?.length ? [n.level.reduce((a, b) => a + b, 0) / n.level.length] : []));
  return levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : fallback;
}

export function objectiveWork(quest: Quest, o: Objective, data: ZoneData): Work {
  const level = quest.level > 0 ? quest.level : quest.minLevel;
  if (o.type === "npc" || o.type === "killCredit") {
    const npcs = (o.type === "npc" ? [o.id!] : (o.ids ?? [])).map((id) => data.npcs[id]);
    const single = npcs.length === 1 && spawnCount(npcs[0]) <= 2;
    const count = countInText(quest.text, npcs[0]?.name) ?? countInText(quest.text, o.text) ?? (single ? 1 : 8);
    return { count, kills: count, mobLevel: levelOfNpcs(npcs, level), minutes: count * MINUTES_PER_KILL };
  }
  if (o.type === "object") {
    const count = countInText(quest.text, data.objects[o.id!]?.name) ?? (spawnCount(data.objects[o.id!]) <= 1 ? 1 : 5);
    return { count, kills: 0, mobLevel: level, minutes: count * MINUTES_PER_CLICK };
  }
  if (o.type === "item") {
    const item: Item | undefined = data.items[o.id!];
    const droppers = (item?.npcs ?? []).map((id) => data.npcs[id]);
    const single = droppers.length === 1 && spawnCount(droppers[0]) <= 2;
    const count = countInText(quest.text, item?.name) ?? (single || !droppers.length ? 1 : 6);
    if (!droppers.length) return { count, kills: 0, mobLevel: level, minutes: count * MINUTES_PER_CLICK };
    const chances = Object.values(item?.drop ?? {});
    const chance = single ? 100 : chances.length ? Math.max(5, chances.reduce((a, b) => a + b, 0) / chances.length) : DEFAULT_DROP;
    const kills = Math.min(MAX_KILLS, Math.ceil(count / Math.min(1, chance / 100)));
    return { count, kills, mobLevel: levelOfNpcs(droppers, level), minutes: kills * MINUTES_PER_KILL };
  }
  return { count: 1, kills: 0, mobLevel: level, minutes: 0.5 };
}

/** The objectives the game numbers (for `.complete id,n`), in order. */
export function numberedObjectives(quest: Quest): Objective[] {
  return (quest.objectives ?? []).filter((o) => o.type !== "event" && o.type !== "reputation");
}

export class Book {
  readonly metas = new Map<number, QuestMeta>();
  readonly zones = new Map<number, ZoneInfo>();
  private readonly loaded = new Map<number, ZoneData>();
  private readonly full = new Map<number, { quest: Quest; data: ZoneData }>();
  private readonly works = new Map<number, Work[]>();

  constructor(rows: QuestRow[], zones: ZoneInfo[], loaded: ZoneData[]) {
    for (const row of rows) this.metas.set(row[0], metaOf(row));
    for (const zone of zones) this.zones.set(zone.id, zone);
    for (const data of loaded) {
      this.loaded.set(data.zone.id, data);
      for (const quest of data.quests) this.full.set(quest.id, { quest, data });
    }
  }

  meta(id: number): QuestMeta | undefined {
    return this.metas.get(id);
  }
  name(id: number): string {
    return this.metas.get(id)?.name ?? `quest ${id}`;
  }
  /** The full quest, when its zone is loaded. */
  quest(id: number): { quest: Quest; data: ZoneData } | undefined {
    return this.full.get(id);
  }
  zoneData(id: number): ZoneData | undefined {
    return this.loaded.get(id);
  }
  isDungeon(questId: number): boolean {
    const meta = this.metas.get(questId);
    return meta ? this.zones.get(meta.zone)?.kind === "dungeon" : false;
  }

  /** Work per numbered objective; a single rough entry when the quest's zone isn't loaded. */
  work(id: number): Work[] {
    let work = this.works.get(id);
    if (work) return work;
    const full = this.full.get(id);
    if (full) work = numberedObjectives(full.quest).map((o) => objectiveWork(full.quest, o, full.data));
    else {
      const level = this.metas.get(id)?.level ?? 1;
      work = [{ count: 8, kills: 8, mobLevel: level, minutes: 8 * MINUTES_PER_KILL }];
    }
    if (full) this.works.set(id, work);
    return work;
  }

  /** Rough minutes of objectives for a quest, travel aside. */
  minutes(id: number): number {
    return this.work(id).reduce((n, w) => n + w.minutes, 0);
  }

  /** Every quest that must be turned in before this one, nearest first, for this character's side. */
  prerequisites(id: number, ok: (meta: QuestMeta) => boolean): number[] {
    const out: number[] = [];
    const seen = new Set<number>([id]);
    const visit = (quest: number) => {
      const meta = this.metas.get(quest);
      if (!meta) return;
      const need = [...meta.preAll.filter((p) => this.metas.has(p) && ok(this.metas.get(p)!))];
      // one of several is enough: take the first this character can do
      const any = meta.preAny.find((p) => this.metas.has(p) && ok(this.metas.get(p)!));
      if (any !== undefined) need.push(any);
      for (const p of need) {
        if (seen.has(p)) continue;
        seen.add(p);
        visit(p);
        out.push(p);
      }
    };
    visit(id);
    return out;
  }
}
