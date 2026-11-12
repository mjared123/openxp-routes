/**
 * Builds a whole route from a character and a list of wishes.
 *
 * Zone by zone: go where the most quest XP is for your level, pick the
 * quests that suit you, put them in order, and move on, until the target
 * level. Dungeons, goal items, profession quests and recipes are worked in
 * when their time comes.
 */
import { Book } from "./book";
import { canTake, startZone, type Character } from "./character";
import type { DataIndex, GoalData, QuestRow, ZoneData } from "./data";
import type { Step } from "./guide";
import { pickQuests, planRoute, removeQuest, suggestZones } from "./planner";
import { grindStep, lastPlaceOf, newGuide, questUse, sameStep, travelStep, type ZoneNames } from "./route";
import { simulate, type SimState } from "./sim";
import { levelOf, xpAtLevel } from "./xp";

/** What the player asked the route to include. */
export interface Goals {
  /** Level to stop at. */
  target: number;
  /** Dungeon zone ids. */
  dungeons: number[];
  /** Item ids: quest rewards and boss drops. */
  items: number[];
  /** Recipe item ids. */
  recipes: number[];
}

export const NO_GOALS: Goals = { target: 60, dungeons: [], items: [], recipes: [] };

export interface Chapter {
  zone: number | null;
  name: string;
  steps: Step[];
  start: number;
  end: number;
  quests: number;
  kind: "zone" | "dungeon" | "errands";
}

export interface Report {
  /** Level the route ends at. */
  reached: number;
  quests: number;
  steps: number;
  /** Wishes the route includes, in words. */
  included: string[];
  /** Wishes it couldn't, with the reason. */
  missed: string[];
}

export interface Generated {
  chapters: Chapter[];
  report: Report;
}

export interface Progress {
  level: number;
  target: number;
  /** What is being worked on, to show while waiting. */
  doing: string;
  chapters: number;
}

/** Fewest new quests that make a visit worth the trip. */
const MIN_VISIT = { fast: 8, balanced: 8, relaxed: 10, complete: 4 } as const;
/** Levels of grinding a route may hold before it gives up. */
const MAX_GRINDS = 45;
const MAX_CHAPTERS = 160;

export async function generateRoute(
  c: Character,
  goals: Goals,
  goalData: GoalData,
  index: DataIndex,
  rows: QuestRow[],
  load: (zone: number) => Promise<ZoneData>,
  onProgress: (p: Progress) => void,
): Promise<Generated> {
  const zoneNames: ZoneNames = new Map(index.zones.map((z) => [z.id, z.name]));
  const zoneByName = new Map(index.zones.map((z) => [z.name, z.id]));
  const loaded = new Map<number, ZoneData>();
  let book = new Book(rows, index.zones, []);
  const open = async (zone: number) => {
    if (!loaded.has(zone)) {
      loaded.set(zone, await load(zone));
      book = new Book(rows, index.zones, [...loaded.values()]);
    }
    return loaded.get(zone)!;
  };

  // --- wishes -------------------------------------------------------------------
  const included: string[] = [];
  const missed: string[] = [];
  const mine = (id: number) => {
    const meta = book.meta(id);
    return meta !== undefined && canTake(c, meta);
  };
  /** Quests that must be on the route, with the wish they serve. */
  const wanted = new Map<number, string>();
  const want = (quest: number, why: string) => {
    for (const p of book.prerequisites(quest, (m) => canTake(c, m))) if (!wanted.has(p)) wanted.set(p, why);
    wanted.set(quest, why);
  };
  const dungeons = new Set(goals.dungeons);
  for (const id of goals.items) {
    const reward = goalData.items.filter((g) => g.id === id).find((g) => mine(g.quest));
    const drop = goalData.bossItems.find((b) => b.id === id);
    if (reward) want(reward.quest, reward.name);
    else if (drop) dungeons.add(drop.zone);
    else missed.push(`${goalData.items.find((g) => g.id === id)?.name ?? "An item"}: no quest gives it to a ${c.race} ${c.cls}.`);
  }
  /** Recipes to buy, by the zone of the vendor. */
  const errands = new Map<number, { recipe: string; item: number; vendor: string; at: [number, number] }[]>();
  for (const id of goals.recipes) {
    const recipe = goalData.recipes.find((r) => r.id === id);
    if (!recipe) continue;
    const quest = recipe.quests?.find(mine);
    const vendor = recipe.vendors?.find((v) => !v.friendly || v.friendly.includes(c.faction));
    if (vendor) errands.set(vendor.zone, [...(errands.get(vendor.zone) ?? []), { recipe: recipe.name, item: recipe.id, vendor: vendor.name, at: vendor.at }]);
    else if (quest) want(quest, recipe.name);
    else missed.push(`${recipe.name}: nobody sells it to the ${c.faction === "A" ? "Alliance" : "Horde"}.`);
  }
  const errandSteps = (zone: number): Step[] =>
    (errands.get(zone) ?? []).map((e) => ({
      lines: [
        { kind: "command", name: "goto", args: `${zoneNames.get(zone)},${e.at[0].toFixed(2)},${e.at[1].toFixed(2)}` },
        { kind: "text", marker: ">>", text: `Buy |cRXP_BUY_${e.recipe}|r from |cRXP_FRIENDLY_${e.vendor}|r` },
        { kind: "command", name: "collect", args: `${e.item},1` },
        { kind: "command", name: "target", args: e.vendor },
      ],
    }));

  // --- the route ----------------------------------------------------------------
  let state: SimState = { xp: xpAtLevel(c.level), accepted: new Set(), done: new Set() };
  const onRoute = new Set<number>();
  const chapters: Chapter[] = [];
  const lists: Step[][] = [];
  /** Zones not worth another look until the next level. */
  let tired = new Set<number>();
  let tiredAt = Math.floor(c.level);
  let grinds = 0;
  const level = () => levelOf(state.xp);
  const tick = (doing: string) => {
    onProgress({ level: level(), target: goals.target, doing, chapters: chapters.length });
    return new Promise((r) => setTimeout(r, 0));
  };

  /** Wanted quests of a zone that can be done now: high enough, and what they need first is done or comes along. */
  const due = (zone: number, reach: number): number[] => {
    const here = [...wanted.keys()].filter((q) => !onRoute.has(q) && book.meta(q)?.zone === zone);
    const ok = new Set(here.filter((q) => (book.meta(q)?.minLevel ?? 99) <= Math.floor(reach) && (book.meta(q)?.level ?? 99) <= Math.floor(reach) + (c.hardcore ? 1 : 2)));
    for (let changed = true; changed; ) {
      changed = false;
      for (const q of ok) {
        const before = book.prerequisites(q, (m) => canTake(c, m)).filter((p) => !state.done.has(p) && !(c.level > 1 && (book.meta(p)?.level ?? 99) < c.level));
        if (before.some((p) => !ok.has(p))) {
          ok.delete(q);
          changed = true;
        }
      }
    }
    return [...ok];
  };

  const visit = async (zone: number, kind: Chapter["kind"], forced: number[], as: Character = c, fewest?: number): Promise<boolean> => {
    const data = await open(zone);
    const who = kind === "dungeon" ? { ...c, dungeons: true, groups: true } : as;
    const picked = kind === "errands" ? [] : pickQuests(data, who, state, book, onRoute);
    const quests = [...new Set([...picked, ...forced, ...due(zone, level() + 1)])];
    const least = kind === "dungeon" || forced.length || errands.has(zone) ? 0 : (fewest ?? MIN_VISIT[c.style]);
    if (quests.length < Math.max(1, least) && !(errands.has(zone) && kind !== "dungeon")) return false;
    const plan = planRoute({ quests, book, character: who, state, from: lastPlaceOf(lists, zoneByName), viewZone: zone, zoneNames });
    let steps = [...plan.steps, ...errandSteps(zone)];
    if (!steps.length) return false;
    if (kind === "dungeon") steps = [{ lines: [{ kind: "text", marker: "+", text: `Find a group for ${zoneNames.get(zone)}. Pick up its quests on the way in` }] }, ...steps];
    if (chapters.length) steps = [travelStep(zone, data, c.faction, zoneNames), ...steps];
    const before = level();
    state = simulate([steps], c, book, state).end;
    const count = new Set(questUse(plan.steps).keys()).size;
    for (const q of questUse(plan.steps).keys()) onRoute.add(q);
    for (const e of errands.get(zone) ?? []) included.push(`${e.recipe}, bought from ${e.vendor} in ${zoneNames.get(zone)}`);
    errands.delete(zone);
    const previous = chapters[chapters.length - 1];
    if (previous && previous.zone === zone && previous.kind === kind) {
      // straight back into the same zone: one chapter, not two
      const more = steps.slice(1);
      lists[lists.length - 1]!.push(...more);
      previous.end = level();
      previous.quests += count;
    } else {
      lists.push(steps);
      chapters.push({ zone, name: zoneNames.get(zone) ?? "Zone", steps, start: before, end: level(), quests: count, kind });
    }
    return true;
  };

  /** A dungeon the player asked for: with its quests when the character has any, as a plain run otherwise. */
  const run = async (zone: number) => {
    const name = zoneNames.get(zone) ?? "Dungeon";
    const at = Math.floor(level() + 1e-9);
    if (await visit(zone, "dungeon", [])) {
      included.push(`${name}, around level ${at}`);
      return;
    }
    const steps: Step[] = [{ lines: [{ kind: "text", marker: "+", text: `Find a group and run ${name}` }] }];
    if (chapters.length) steps.unshift(travelStep(zone, await open(zone), c.faction, zoneNames));
    lists.push(steps);
    chapters.push({ zone, name, steps, start: level(), end: level(), quests: 0, kind: "dungeon" });
    included.push(`${name}, around level ${at} (no quests for your character there, just the run)`);
  };

  while (level() < goals.target && chapters.length < MAX_CHAPTERS) {
    const whole = Math.floor(level() + 1e-9);
    if (whole > tiredAt) {
      tired = new Set();
      tiredAt = whole;
    }
    // a dungeon you asked for, once you are the level its quests are
    const dungeon = [...dungeons].find((z) => {
      const info = book.zones.get(z);
      return info && whole >= (info.levels?.[0] ?? 99) && !tired.has(z);
    });
    if (dungeon !== undefined) {
      await tick(`Gathering a party for ${zoneNames.get(dungeon)}`);
      dungeons.delete(dungeon);
      await run(dungeon);
      continue;
    }
    // then the zone with the most to do; one holding something you asked for goes first
    const last = chapters[chapters.length - 1]?.zone ?? undefined;
    const options = suggestZones(book, c, level(), tired, onRoute, false, last ?? undefined).map((s) => s.zone.id);
    const goalZone = [...new Set([...wanted.keys()].filter((q) => !onRoute.has(q)).map((q) => book.meta(q)!.zone))].find((z) => !tired.has(z) && due(z, level()).length > 0);
    if (goalZone !== undefined) {
      await tick(`Following a lead to ${zoneNames.get(goalZone)}`);
      if (!(await visit(goalZone, "zone", due(goalZone, level())))) tired.add(goalZone);
      continue;
    }
    let went = false;
    const home = startZone(c, index);
    if (!chapters.length && home !== undefined && c.level < 6) {
      // a new character always begins at home, however little there is to do at level 1
      await tick(`Setting out from ${zoneNames.get(home)}`);
      went = await visit(home, "zone", [], c, 1);
      if (went) continue;
    }
    for (const next of options) {
      await tick(`Scouting ${zoneNames.get(next)}`);
      const before = level();
      went = await visit(next, "zone", []);
      if (!went || level() - before < 0.25) tired.add(next);
      if (went) break;
    }
    if (went) continue;
    // nothing fits the play style here: take what an ordinary route would, before resorting to grinding
    if (c.style !== "complete") {
      const easier: Character = { ...c, style: "balanced" };
      for (const next of suggestZones(book, easier, level(), new Set(), onRoute, false, last ?? undefined).map((s) => s.zone.id)) {
        await tick(`Taking a detour through ${zoneNames.get(next)}`);
        const before = level();
        went = (await visit(next, "zone", [], easier, 4)) && level() - before >= 0.1;
        if (went) break;
      }
      if (went) continue;
    }
    // easy quests left behind in earlier zones still pay better than grinding
    const mopUp: Character = { ...c, style: c.style === "complete" ? "complete" : "balanced" };
    for (const next of suggestZones(book, mopUp, level(), new Set(), onRoute, false, last ?? undefined, true).map((s) => s.zone.id)) {
      await tick(`Tying up loose ends in ${zoneNames.get(next)}`);
      const before = level();
      went = (await visit(next, "zone", [], mopUp, 3)) && level() - before >= 0.08;
      if (went) break;
    }
    if (went) continue;
    if (++grinds > MAX_GRINDS) break;
    if (lists.length) lists[lists.length - 1]!.push(grindStep(whole + 1));
    else if (home !== undefined) {
      // no quest to start with: a few kills at home first
      const steps = [grindStep(whole + 1)];
      lists.push(steps);
      chapters.push({ zone: home, name: zoneNames.get(home) ?? "Zone", steps, start: level(), end: level(), quests: 0, kind: "zone" });
    } else break;
    state = { ...state, xp: Math.max(state.xp, xpAtLevel(whole + 1)) };
    chapters[chapters.length - 1]!.end = level();
  }

  // --- what is left of the wishes ---------------------------------------------------
  for (let progress = true; progress; ) {
    progress = false;
    const leftZones = new Set([...wanted.keys()].filter((q) => !onRoute.has(q)).map((q) => book.meta(q)!.zone));
    for (const z of leftZones) {
      const forced = due(z, level());
      if (!forced.length) continue;
      await tick(`One more trip to ${zoneNames.get(z)}`);
      if (await visit(z, "zone", forced, c, 0)) progress = true;
    }
  }
  for (const [z] of [...errands]) {
    await tick(`Shopping in ${zoneNames.get(z)}`);
    await visit(z, "errands", []);
  }
  for (const z of [...dungeons]) {
    if ((book.zones.get(z)?.levels?.[0] ?? 99) <= goals.target) await run(z);
    else missed.push(`${zoneNames.get(z)}: it is for characters above level ${goals.target}.`);
  }
  // --- tidy up: nothing on the route that the character can't do when they get there -----
  for (let pass = 0; pass < 40; pass++) {
    const sim = simulate(chapters.map((ch) => ch.steps), c, book);
    const bad = new Set(sim.problems.filter((p) => p.severity === "error" && p.questId).map((p) => p.questId!));
    if (!bad.size) {
      chapters.forEach((ch, i) => {
        ch.start = sim.sections[i]!.start;
        ch.end = sim.sections[i]!.end;
      });
      state = sim.end;
      break;
    }
    for (const ch of chapters) for (const id of bad) ch.steps = removeQuest(ch.steps, id, sameStep);
    for (const id of bad) onRoute.delete(id);
  }
  for (let i = chapters.length - 1; i >= 0; i--) if (!chapters[i]!.steps.length) chapters.splice(i, 1);

  const byWish = new Map<string, boolean>();
  for (const [q, why] of wanted) byWish.set(why, (byWish.get(why) ?? true) && onRoute.has(q));
  for (const [why, ok] of byWish) (ok ? included : missed).push(ok ? why : `${why}: its quest chain needs a higher level than ${goals.target}, or a quest this character can't take.`);

  onProgress({ level: level(), target: goals.target, doing: "Done", chapters: chapters.length });
  return {
    chapters,
    report: { reached: level(), quests: onRoute.size, steps: chapters.reduce((n, ch) => n + ch.steps.length, 0), included, missed },
  };
}

/** The chapters as route sections, named by zone and the levels you spend there. */
export function chaptersToSections(chapters: Chapter[], c: Character) {
  return chapters.map((ch) => {
    const name = `${ch.name} ${Math.floor(ch.start + 1e-9)}-${Math.floor(ch.end + 1e-9)}`;
    return { zone: ch.zone, guide: { ...newGuide(name, c.faction), steps: ch.steps } };
  });
}
