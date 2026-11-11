/**
 * Picks quests worth doing and puts them in a good order.
 *
 * The order comes from playing the quests in the planner's head: from where
 * you stand, always do the nearest thing you are able to do (accept, an
 * objective, a turn-in), then try moving single stops to a better place.
 */
import { numberedObjectives, type Book } from "./book";
import { START_ZONE, canTake, type Character } from "./character";
import type { Quest, ZoneData, ZoneInfo } from "./data";
import { writeAction, type Step } from "./guide";
import { addStep, objectiveStep, questGiverStep, type Built, type Place, type ZoneNames } from "./route";
import { missingPrerequisites, type SimState } from "./sim";
import { DUNGEON_KILL_XP, QUEST_LOG_LIMIT, difficulty, levelOf, mobXp, questXp, xpAtLevel } from "./xp";

// --- distance -----------------------------------------------------------------

interface WorldPoint {
  space: string;
  x: number;
  y: number;
}
/** Yards between two places that aren't on one continent's map (a boat, a tram, a dungeon door). */
const FAR = 6000;

function world(place: Place, zones: Map<number, ZoneInfo>): WorldPoint {
  const zone = zones.get(place.zone);
  const [px, py] = place.point;
  if (zone?.bounds && zone.continent) {
    const [left, right, top, bottom] = zone.bounds;
    return { space: zone.continent, x: left + ((right - left) * px) / 100, y: top + ((bottom - top) * py) / 100 };
  }
  return { space: `zone ${place.zone}`, x: px * 45, y: py * 30 };
}

export function distance(a: Place | undefined, b: Place | undefined, zones: Map<number, ZoneInfo>): number {
  if (!a || !b) return 0;
  const [p, q] = [world(a, zones), world(b, zones)];
  return p.space === q.space ? Math.hypot(p.x - q.x, p.y - q.y) : FAR;
}

// --- picking quests -----------------------------------------------------------

export type SkipReason = "side" | "level" | "gray" | "hard" | "group" | "dungeon" | "special" | "slow" | "chain" | "done";

/**
 * Quests outside ordinary leveling: repeatable, raids, events, and profession
 * or camping quests the character hasn't asked for.
 */
export function isSpecial(q: { name: string; repeatable?: boolean; raid?: boolean; category?: string; classes?: unknown; profession?: string; skillNeeded?: number }, c: Character, level: number): boolean {
  if (q.repeatable || q.raid) return true;
  if (q.profession && (!c.professions.includes(q.profession) || (q.skillNeeded ?? 0) > Math.max(75, Math.floor(level) * 5))) return true;
  if (q.category === "Camping") {
    const trade = /^Camping 101: (.+)$/.exec(q.name)?.[1];
    return !c.camping || (trade !== undefined && !c.professions.includes(trade));
  }
  if (q.category && !q.classes && !(q.profession && c.professions.includes(q.category))) return true;
  return false;
}

/** How many levels above the character a quest may be. The first zones are gentle, so they get some slack. */
function stretch(c: Character, reach: number): number {
  const most = c.style === "relaxed" ? (c.hardcore ? 0 : 1) : c.hardcore ? 1 : 2;
  return reach < 10 ? Math.max(most, 1) : most;
}

/**
 * Why "pick for me" would leave a quest out, or nothing when it would take it.
 * `level` is where you are now, `reach` the level you'd get to in this zone.
 */
export function skipReason(quest: Quest, c: Character, level: number, reach: number, book: Book, zone: ZoneInfo | undefined): SkipReason | undefined {
  if (!canTake(c, quest)) return "side";
  if (isSpecial({ ...quest, profession: quest.skill?.[0], skillNeeded: quest.skill?.[1] }, c, level)) return "special";
  if (!quest.start?.npcs?.length && !quest.start?.objects?.length) {
    // starts from an item: only worth planning when something in the world drops or holds it
    const data = book.quest(quest.id)?.data;
    const found = (quest.start?.items ?? []).some((i) => data?.items[i]?.npcs?.length || data?.items[i]?.objects?.length);
    if (!found) return "special";
  }
  if (zone?.kind === "dungeon" && !c.dungeons) return "dungeon";
  if (quest.elite && !c.groups) return "group";
  if (quest.minLevel > Math.floor(reach)) return "level";
  const colour = difficulty(quest.level, level);
  if (colour === "gray" && c.style !== "complete") return "gray";
  if (quest.level > Math.floor(reach) + stretch(c, reach)) return "hard";
  if (c.style === "fast" && (colour === "green" || book.minutes(quest.id) > 12)) return "slow";
  return undefined;
}

/** XP a set of quests gives, done from `level` on: turn-ins plus the kills on the way. */
export function xpFrom(ids: Iterable<number>, level: number, book: Book): number {
  let xp = 0;
  for (const id of ids) {
    const meta = book.meta(id);
    if (!meta) continue;
    xp += questXp(meta.xp, meta.level, level);
    for (const w of book.work(id)) xp += w.kills * mobXp(w.mobLevel, Math.max(level, w.mobLevel - 1)) * (book.isDungeon(id) ? DUNGEON_KILL_XP : 1);
  }
  return xp;
}

/**
 * The quests of a zone worth doing for this character at this point of the
 * route. Doing quests levels you, which opens more quests, so this repeats
 * until nothing new opens.
 */
export function pickQuests(data: ZoneData, c: Character, state: SimState, book: Book, onRoute: Set<number>): number[] {
  const level = levelOf(state.xp);
  let picked = new Set<number>();
  const byId = new Map(data.quests.map((q) => [q.id, q]));
  for (let round = 0; round < 8; round++) {
    const reach = levelOf(state.xp + xpFrom(picked, level, book));
    const next = new Set<number>();
    for (const quest of data.quests) {
      if (!onRoute.has(quest.id) && !state.done.has(quest.id) && !skipReason(quest, c, level, reach, book, data.zone)) next.add(quest.id);
    }
    // a quest whose chain can't be finished here is left out, and so is what follows it
    const dropped = new Set<number>();
    for (let changed = true; changed; ) {
      changed = false;
      const done = new Set([...state.done, ...onRoute, ...next]);
      for (const id of next) {
        const missing = missingPrerequisites(id, done, c, book);
        if (!missing.length) continue;
        // a slow quest is still worth it when it opens the rest of a chain
        const slow = missing.map((m) => byId.get(m)).filter((q) => q && !dropped.has(q.id) && skipReason(q, c, level, reach, book, data.zone) === "slow");
        if (slow.length === missing.length) for (const q of slow) next.add(q!.id);
        else {
          next.delete(id);
          dropped.add(id);
        }
        changed = true;
      }
    }
    if (next.size === picked.size) break;
    picked = next;
  }
  return [...picked];
}

export interface Suggestion {
  zone: ZoneInfo;
  /** Quests there this character could do around this level, and the XP they give. */
  quests: number;
  xp: number;
}

/**
 * Zones worth going to at a level: the ones with the most quest XP for this character right now, best first.
 * `catchUp` also counts easy quests left behind in zones you have outgrown.
 */
export function suggestZones(book: Book, c: Character, level: number, used: Set<number>, onRoute: Set<number> = new Set(), dungeons = false, from?: number, catchUp = false): Suggestion[] {
  const whole = Math.floor(level + 1e-9);
  const found = new Map<number, Suggestion>();
  const other = c.faction === "A" ? "H" : "A";
  const starters = new Set(Object.values(START_ZONE));
  const cities = new Set(["Stormwind City", "Ironforge", "Darnassus", "Orgrimmar", "Thunder Bluff", "Undercity"]);
  const fits = (zone: ZoneInfo) =>
    // not the other faction's land, not a starting zone you have outgrown (or another race's), and not one you are past
    zone.quests[c.faction] >= zone.quests[other] * 0.5 &&
    !cities.has(zone.name) &&
    !(starters.has(zone.name) && (whole >= 6 || zone.name !== START_ZONE[c.race])) &&
    (catchUp || !zone.levels || zone.levels[1] > whole);
  for (const meta of book.metas.values()) {
    const zone = book.zones.get(meta.zone);
    if (!zone || !fits(zone) || used.has(zone.id) || onRoute.has(meta.id) || (zone.kind !== "zone" && !(dungeons && zone.kind === "dungeon"))) continue;
    // quests at your level or a little above: the ones a zone is worth the trip for
    if (meta.fromItem || (meta.elite && !c.groups) || isSpecial({ ...meta, classes: meta.classes.length ? meta.classes : undefined }, c, level)) continue;
    if (!canTake(c, meta) || meta.level < whole - (catchUp ? 7 : c.style === "complete" ? 4 : 1) || (catchUp && difficulty(meta.level, level) === "gray") || meta.minLevel > whole + 1 || meta.level > whole + (c.style === "relaxed" ? 1 : c.hardcore ? 2 : 3)) continue;
    const entry = found.get(zone.id) ?? { zone, quests: 0, xp: 0 };
    entry.quests++;
    entry.xp += questXp(meta.xp, meta.level, level);
    found.set(zone.id, entry);
  }
  // a boat ride away counts for less
  const home = from === undefined ? undefined : book.zones.get(from)?.continent;
  const score = (s: Suggestion) => s.xp * (home && s.zone.continent && s.zone.continent !== home ? 0.45 : 1);
  return [...found.values()]
    .filter((s) => s.quests >= (s.zone.kind === "dungeon" ? 2 : catchUp ? 3 : 6))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6);
}

// --- ordering -----------------------------------------------------------------

interface Task {
  kind: "accept" | "objective" | "turnin";
  quest: Quest;
  /** For objectives: index among the numbered objectives, or -1 for an event. */
  number: number;
  built: Built;
  place?: Place;
}

export interface PlanInput {
  quests: number[];
  book: Book;
  character: Character;
  /** XP and quests before the first planned step. */
  state: SimState;
  from?: Place;
  viewZone: number;
  zoneNames: ZoneNames;
}

export interface Plan {
  steps: Step[];
  /** Quests left out because their zone's data wasn't loaded. */
  skipped: number[];
}

function tasksFor(quest: Quest, data: ZoneData, zones: ZoneNames, viewZone: number): Task[] {
  const tasks: Task[] = [];
  const push = (kind: Task["kind"], number: number, built: Built) => tasks.push({ kind, quest, number, built, place: built.place });
  push("accept", -1, questGiverStep("accept", quest, data, zones, viewZone));
  const numbered = numberedObjectives(quest);
  (quest.objectives ?? []).forEach((o, i) => {
    if (o.type !== "reputation") push("objective", numbered.indexOf(o), objectiveStep(quest, i, data, zones, viewZone));
  });
  push("turnin", -1, questGiverStep("turnin", quest, data, zones, viewZone));
  return tasks;
}

function pathLength(order: Task[], from: Place | undefined, zones: Map<number, ZoneInfo>): number {
  let total = 0;
  let at = from;
  for (const task of order) {
    if (!task.place) continue;
    total += distance(at, task.place, zones);
    at = task.place;
  }
  return total;
}

/** XP a finished task gives at a level. */
function gain(task: Task, level: number, book: Book): number {
  if (task.kind === "turnin") return questXp(task.quest.xp, task.quest.level, level);
  if (task.kind !== "objective" || task.number < 0) return 0;
  const w = book.work(task.quest.id)[task.number];
  return w ? Math.round(w.kills * mobXp(w.mobLevel, level) * (book.isDungeon(task.quest.id) ? DUNGEON_KILL_XP : 1)) : 0;
}

/** Accept before objectives before turn-in, chains in order, high enough level, and never more than a full quest log. */
function valid(order: Task[], state: SimState, c: Character, book: Book, startXp = state.xp): boolean {
  const accepted = new Set(state.accepted);
  const done = new Set(state.done);
  let xp = startXp;
  const left = new Map<number, number>();
  for (const t of order) if (t.kind === "objective") left.set(t.quest.id, (left.get(t.quest.id) ?? 0) + 1);
  for (const t of order) {
    const id = t.quest.id;
    const level = levelOf(xp);
    xp += gain(t, level, book);
    if (t.kind === "accept") {
      if (t.quest.minLevel > Math.floor(level)) return false;
      if (missingPrerequisites(id, done, c, book).some((p) => order.some((o) => o.quest.id === p))) return false;
      accepted.add(id);
      if (accepted.size > QUEST_LOG_LIMIT) return false;
    } else if (!accepted.has(id)) return false;
    else if (t.kind === "objective") left.set(id, left.get(id)! - 1);
    else {
      if (left.get(id)) return false;
      accepted.delete(id);
      done.add(id);
    }
  }
  return true;
}

export function planRoute(input: PlanInput): Plan {
  const { book, character: c, viewZone, zoneNames } = input;
  const zones = book.zones;
  const skipped: number[] = [];
  let tasks: Task[] = [];
  for (const id of new Set(input.quests)) {
    const full = book.quest(id);
    if (!full) skipped.push(id);
    else if (input.state.done.has(id)) continue;
    else {
      const all = tasksFor(full.quest, full.data, zoneNames, viewZone);
      tasks.push(...(input.state.accepted.has(id) ? all.filter((t) => t.kind !== "accept") : all));
    }
  }
  const planned = new Set(tasks.map((t) => t.quest.id));

  // play it: nearest thing you can do next
  const accepted = new Set(input.state.accepted);
  const done = new Set(input.state.done);
  let xp = input.state.xp;
  let at = input.from;
  const order: (Task | { grind: number })[] = [];
  const objectivesLeft = (id: number) => tasks.some((t) => t.kind === "objective" && t.quest.id === id);
  while (tasks.length) {
    const level = levelOf(xp);
    const whole = Math.floor(level);
    let best: Task | undefined;
    let bestCost = Infinity;
    let lowest: Task | undefined;
    for (const t of tasks) {
      const id = t.quest.id;
      let cost = distance(at, t.place, zones);
      const above = t.quest.level - whole;
      if (t.kind === "accept") {
        if (accepted.size >= QUEST_LOG_LIMIT) continue;
        if (missingPrerequisites(id, done, c, book).some((p) => planned.has(p))) continue;
        if (t.quest.minLevel > whole) {
          if (!lowest || t.quest.minLevel < lowest.quest.minLevel) lowest = t;
          continue;
        }
        cost *= 0.6; // picking quests up first saves trips
        if (above > 1) cost += (above - 1) * (c.hardcore ? 900 : 400);
      } else if (!accepted.has(id)) continue;
      else if (t.kind === "objective") {
        if (above > 2) cost += (above - 2) * (c.hardcore ? 1500 : 600);
      } else if (objectivesLeft(id)) continue;
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    if (!best) {
      if (!lowest) break; // nothing can be done: the rest can't be ordered
      order.push({ grind: lowest.quest.minLevel });
      xp = Math.max(xp, xpAtLevel(lowest.quest.minLevel));
      continue;
    }
    tasks = tasks.filter((t) => t !== best);
    order.push(best);
    if (best.place) at = best.place;
    const id = best.quest.id;
    if (best.kind === "accept") accepted.add(id);
    else if (best.kind === "turnin") {
      accepted.delete(id);
      done.add(id);
    }
    xp += gain(best, level, book);
  }

  // improve it: between grinding stops, move a single objective or turn-in to where it shortens the walk
  const startLevel = Math.floor(levelOf(input.state.xp));
  const runs: (Task[] | { grind: number })[] = [];
  for (const item of order) {
    const last = runs[runs.length - 1];
    if ("grind" in item) runs.push(item);
    else if (Array.isArray(last)) last.push(item);
    else runs.push([item]);
  }
  const flat = (upTo?: number) => runs.slice(0, upTo).flatMap((r) => (Array.isArray(r) ? r : []));
  let runXp = input.state.xp;
  runs.forEach((run, r) => {
    if (!Array.isArray(run)) {
      runXp = Math.max(runXp, xpAtLevel(run.grind));
      return;
    }
    const startXp = runXp;
    const before = flat(r);
    const finish = () => {
      for (const t of run) runXp += gain(t, levelOf(runXp), book);
    };
    if (run.length > 220) return finish();
    // the state the run starts from
    const base: SimState = { xp: startXp, accepted: new Set(input.state.accepted), done: new Set(input.state.done) };
    for (const t of before) {
      if (t.kind === "accept") base.accepted.add(t.quest.id);
      else if (t.kind === "turnin") {
        base.accepted.delete(t.quest.id);
        base.done.add(t.quest.id);
      }
    }
    const start = [...before].reverse().find((t) => t.place)?.place ?? input.from;
    let length = pathLength(run, start, zones);
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (let i = 0; i < run.length; i++) {
        const task = run[i]!;
        if (task.kind === "accept" || !task.place) continue;
        const without = [...run.slice(0, i), ...run.slice(i + 1)];
        let bestAt = -1;
        let bestLength = length - 1; // a yard isn't worth a change
        for (let j = 0; j <= without.length; j++) {
          if (j === i || (j < i && task.quest.level > startLevel + 2)) continue;
          const candidate = [...without.slice(0, j), task, ...without.slice(j)];
          const l = pathLength(candidate, start, zones);
          if (l < bestLength && valid(candidate, base, c, book)) {
            bestLength = l;
            bestAt = j;
          }
        }
        if (bestAt >= 0) {
          run.splice(0, run.length, ...without.slice(0, bestAt), task, ...without.slice(bestAt));
          length = bestLength;
          improved = true;
        }
      }
      if (!improved) break;
    }
    finish();
  });

  let steps: Step[] = [];
  for (const run of runs) {
    if (Array.isArray(run)) for (const task of run) steps = addStep(steps, task.built, steps.length).steps;
    else steps.push({ lines: [{ kind: "text", marker: ">>", text: `Grind to level ${run.grind}` }, writeAction({ type: "reachLevel", level: run.grind })] });
  }
  return { steps, skipped };
}

/** The route without a quest: its lines go, and steps left with nothing to do go too. */
export function removeQuest(steps: Step[], questId: number, keep: (next: Step, previous: Step) => Step): Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    const mine = (l: Step["lines"][number]) => l.kind === "command" && ["accept", "turnin", "complete"].includes(l.name) && Math.abs(Number.parseInt(l.args, 10)) === questId;
    if (!step.lines.some(mine)) {
      out.push(step);
      continue;
    }
    const lines = step.lines.filter((l) => !mine(l));
    const stillActs = lines.some((l) => l.kind === "command" && !["goto", "target", "mob"].includes(l.name));
    if (stillActs) out.push(keep({ ...step, lines }, step));
  }
  return out;
}
