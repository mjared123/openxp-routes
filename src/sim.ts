/**
 * Plays a route in its head: the level you'd be after every step, how full
 * the quest log is, and everything that would go wrong in game.
 */
import type { Book } from "./book";
import { canTake, type Character } from "./character";
import { readAction, type Step } from "./guide";
import { DUNGEON_KILL_XP, MAX_LEVEL, QUEST_LOG_LIMIT, difficulty, levelOf, mobXp, questXp, xpAtLevel } from "./xp";

export type Fix = { type: "addQuest"; questId: number } | { type: "grind"; level: number } | { type: "removeQuest"; questId: number };

export interface Problem {
  section: number;
  step: number;
  severity: "error" | "warn" | "info";
  text: string;
  questId?: number;
  fix?: Fix;
}

export interface SimStep {
  /** Level after the step, with a fraction. */
  level: number;
  /** XP the step gives. */
  xp: number;
  /** Quests in the log after the step. */
  log: number;
  problems: Problem[];
}

export interface SimState {
  xp: number;
  accepted: Set<number>;
  done: Set<number>;
}

export interface Simulation {
  steps: SimStep[][];
  problems: Problem[];
  /** Level at the start and end of each section. */
  sections: { start: number; end: number; questXp: number; killXp: number }[];
  /** The state before each section, to plan from. */
  before: SimState[];
  end: SimState;
}

function copy(state: SimState): SimState {
  return { xp: state.xp, accepted: new Set(state.accepted), done: new Set(state.done) };
}

/** Whether what a quest needs first is done. Quests below the starting level count as done before the route began. */
export function missingPrerequisites(id: number, done: Set<number>, c: Character, book: Book): number[] {
  const meta = book.meta(id);
  if (!meta) return [];
  const counts = (p: number) => {
    const m = book.meta(p);
    return m !== undefined && canTake(c, m);
  };
  const before = (p: number) => done.has(p) || (c.level > 1 && (book.meta(p)?.level ?? 99) < c.level);
  const missing = meta.preAll.filter((p) => counts(p) && !before(p));
  const any = meta.preAny.filter(counts);
  if (any.length && !any.some(before)) missing.push(any[0]!);
  return missing;
}

/** `from` continues a route: the XP and quest log to start with. */
export function simulate(sections: Step[][], c: Character, book: Book, from?: SimState): Simulation {
  const state: SimState = from ? copy(from) : { xp: xpAtLevel(c.level), accepted: new Set(), done: new Set() };
  const counted = new Map<number, Set<number>>();
  const out: Simulation = { steps: [], problems: [], sections: [], before: [], end: state };

  sections.forEach((steps, s) => {
    out.before.push(copy(state));
    const start = levelOf(state.xp);
    let fromQuests = 0;
    let fromKills = 0;
    const sims: SimStep[] = [];
    steps.forEach((step, i) => {
      const problems: Problem[] = [];
      const add = (severity: Problem["severity"], text: string, questId?: number, fix?: Fix) => problems.push({ section: s, step: i, severity, text, questId, fix });
      const xpBefore = state.xp;
      for (const line of step.lines) {
        const a = readAction(line);
        if (!a) continue;
        const level = levelOf(state.xp);
        const whole = Math.floor(level);
        if (a.type === "accept") {
          const meta = book.meta(a.questId);
          const name = book.name(a.questId);
          if (state.done.has(a.questId)) add("error", `${name} is already turned in earlier on the route.`, a.questId);
          else if (state.accepted.has(a.questId)) add("error", `${name} is accepted twice.`, a.questId);
          state.accepted.add(a.questId);
          if (meta) {
            if (!canTake(c, meta)) add("error", `${name} isn't available to a ${c.race} ${c.cls}.`, a.questId, { type: "removeQuest", questId: a.questId });
            if (meta.minLevel > whole) add("error", `${name} needs level ${meta.minLevel}. You are level ${whole} here.`, a.questId, { type: "grind", level: meta.minLevel });
            for (const p of missingPrerequisites(a.questId, state.done, c, book)) {
              add("error", `${name} only opens after ${book.name(p)} is turned in.`, a.questId, { type: "addQuest", questId: p });
            }
            const colour = difficulty(meta.level, level);
            if (colour === "red" || (c.hardcore && colour === "orange")) {
              add("warn", `${name} is level ${meta.level}, ${meta.level - whole} levels above you here${c.hardcore ? ": dangerous in hardcore" : ""}.`, a.questId);
            }
          }
          if (state.accepted.size > QUEST_LOG_LIMIT) add("error", `The quest log is full here (${state.accepted.size} of ${QUEST_LOG_LIMIT}).`);
        } else if (a.type === "turnin") {
          const meta = book.meta(a.questId);
          const name = book.name(a.questId);
          if (state.done.has(a.questId)) add("error", `${name} is turned in twice.`, a.questId);
          else if (!state.accepted.has(a.questId)) add("error", `${name} is turned in before it is accepted.`, a.questId, { type: "addQuest", questId: a.questId });
          state.accepted.delete(a.questId);
          state.done.add(a.questId);
          if (meta) {
            const gain = questXp(meta.xp, meta.level, level);
            if (meta.level > 0 && difficulty(meta.level, level) === "gray") add("info", `${name} is gray by now and gives little XP.`, a.questId);
            state.xp += gain;
            fromQuests += gain;
          }
        } else if (a.type === "complete") {
          if (!state.accepted.has(a.questId) && !state.done.has(a.questId)) add("error", `${book.name(a.questId)} has an objective before it is accepted.`, a.questId);
          const work = book.work(a.questId);
          const seen = counted.get(a.questId) ?? new Set<number>();
          counted.set(a.questId, seen);
          const which = a.objective ? [a.objective - 1] : work.map((_, n) => n);
          for (const n of which) {
            const w = work[n];
            if (!w || seen.has(n)) continue;
            seen.add(n);
            const gain = Math.round(w.kills * mobXp(w.mobLevel, level) * (book.isDungeon(a.questId) ? DUNGEON_KILL_XP : 1));
            state.xp += gain;
            fromKills += gain;
          }
        } else if (a.type === "reachLevel" && level < a.level) {
          const target = xpAtLevel(Math.min(MAX_LEVEL, a.level));
          const gain = target - state.xp;
          const kills = Math.ceil(gain / Math.max(1, mobXp(whole, level)));
          if (a.level - level > 0.25) add("info", `About ${Math.round(gain).toLocaleString()} XP of grinding to reach level ${a.level} (around ${kills} kills).`);
          state.xp = target;
          fromKills += gain;
        }
      }
      sims.push({ level: levelOf(state.xp), xp: state.xp - xpBefore, log: state.accepted.size, problems });
      out.problems.push(...problems);
    });
    out.steps.push(sims);
    out.sections.push({ start, end: levelOf(state.xp), questXp: fromQuests, killXp: fromKills });
  });

  const last = sections.length - 1;
  if (last >= 0 && state.accepted.size) {
    const names = [...state.accepted].map((id) => book.name(id));
    out.problems.push({
      section: last,
      step: Math.max(0, sections[last]!.length - 1),
      severity: "info",
      text: `${names.length === 1 ? "1 quest is" : `${names.length} quests are`} never turned in: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}.`,
    });
  }
  return out;
}

/** "7" and how far into the level, for display. */
export function levelParts(level: number): { whole: number; percent: number } {
  const whole = Math.floor(level + 1e-9);
  return { whole, percent: Math.min(99, Math.floor((level - whole) * 100 + 1e-6)) };
}
