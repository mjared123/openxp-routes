import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Book, countInText } from "./book";
import { DEFAULT_CHARACTER, canUse, type Character } from "./character";
import type { DataIndex, QuestRow, ZoneData } from "./data";
import { readAction } from "./guide";
import { pickQuests, planRoute, removeQuest, suggestZones } from "./planner";
import { simulate } from "./sim";
import { difficulty, levelOf, questXp, xpAtLevel } from "./xp";

const load = <T,>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, "utf8")) as T;
const index = load<DataIndex>("index.json");
const rows = load<{ quests: QuestRow[] }>("quests.json").quests;
const zoneId = (name: string) => index.zones.find((z) => z.name === name)!.id;
const zoneNames = new Map(index.zones.map((z) => [z.id, z.name]));

function build(c: Character, zones: string[]) {
  const loaded = zones.map((z) => load<ZoneData>(`zones/${zoneId(z)}.json`));
  const book = new Book(rows, index.zones, loaded);
  const sections: ReturnType<typeof planRoute>["steps"][] = [];
  for (const data of loaded) {
    const sim = simulate(sections, c, book);
    const onRoute = new Set([...sim.end.done, ...sim.end.accepted]);
    const quests = pickQuests(data, c, sim.end, book, onRoute);
    sections.push(planRoute({ quests, book, character: c, state: sim.end, viewZone: data.zone.id, zoneNames }).steps);
  }
  return { book, sections, sim: simulate(sections, c, book) };
}

describe("levels", () => {
  it("converts between XP and level", () => {
    expect(xpAtLevel(1)).toBe(0);
    expect(xpAtLevel(60)).toBe(4084700);
    expect(levelOf(xpAtLevel(17.5))).toBeCloseTo(17.5);
  });
  it("pays less for quests far below you", () => {
    expect(questXp(1000, 10, 15)).toBe(1000);
    expect(questXp(1000, 10, 17)).toBe(600);
    expect(difficulty(10, 20)).toBe("gray");
    expect(difficulty(12, 10)).toBe("yellow");
    expect(difficulty(15, 10)).toBe("red");
  });
  it("finds the count an objective asks for", () => {
    expect(countInText("Kill 10 Kobold Vermin, then return to Marshal McBride.", "Kobold Vermin")).toBe(10);
    expect(countInText("Bring 8 Kobold Candles to William Pestle.", "Kobold Candle")).toBe(8);
    expect(countInText("Speak with Marshal Dughan.", "Marshal Dughan")).toBeUndefined();
  });
  it("knows what a class can wear", () => {
    expect(canUse({ name: "x", cls: 4, sub: 3 }, "Hunter", 20)).toBe(false);
    expect(canUse({ name: "x", cls: 4, sub: 3 }, "Hunter", 40)).toBe(true);
    expect(canUse({ name: "x", cls: 2, sub: 19 }, "Warrior", 20)).toBe(false);
  });
});

describe("planning a zone", () => {
  const { sections, sim, book } = build(DEFAULT_CHARACTER, ["Elwynn Forest"]);
  const steps = sections[0]!;

  it("plans a route with no problems to fix", () => {
    expect(steps.length).toBeGreaterThan(30);
    expect(sim.problems.filter((p) => p.severity === "error")).toEqual([]);
  });
  it("levels a new human through Elwynn Forest", () => {
    expect(sim.sections[0]!.end).toBeGreaterThan(8);
    expect(sim.sections[0]!.end).toBeLessThan(14);
  });
  it("accepts every quest before its objectives and turns each in once", () => {
    const seen = new Map<number, string[]>();
    for (const step of steps) for (const line of step.lines) {
      const a = readAction(line);
      if (a?.type === "accept" || a?.type === "turnin" || a?.type === "complete") seen.set(a.questId, [...(seen.get(a.questId) ?? []), a.type]);
    }
    for (const [id, order] of seen) {
      expect(order[0], book.name(id)).toBe("accept");
      expect(order.filter((o) => o === "turnin").length, book.name(id)).toBe(1);
      expect(order[order.length - 1], book.name(id)).toBe("turnin");
    }
  });
  it("leaves out quests for other classes", () => {
    const ids = new Set(steps.flatMap((s) => s.lines.map(readAction).flatMap((a) => (a?.type === "accept" ? [a.questId] : []))));
    for (const id of ids) expect(book.meta(id)!.classes.every((c) => c === "Warrior") || book.meta(id)!.classes.includes("Warrior"), book.name(id)).toBe(true);
  });
  it("removes a quest cleanly", () => {
    const first = steps.flatMap((s) => s.lines.map(readAction)).find((a) => a?.type === "accept")!;
    const id = (first as { questId: number }).questId;
    const without = removeQuest(steps, id, (next) => next);
    expect(JSON.stringify(without)).not.toContain(`"args":"${id}"`);
    expect(without.length).toBeLessThanOrEqual(steps.length);
  });
});

describe("a route over several zones", () => {
  it("carries the level from one section into the next", () => {
    const { sim } = build(DEFAULT_CHARACTER, ["Elwynn Forest", "Westfall"]);
    expect(sim.sections[1]!.start).toBeCloseTo(sim.sections[0]!.end);
    expect(sim.sections[1]!.end).toBeGreaterThan(sim.sections[1]!.start + 2);
    expect(sim.problems.filter((p) => p.severity === "error")).toEqual([]);
  });
  it("plans Horde zones too", () => {
    const { sim } = build({ ...DEFAULT_CHARACTER, faction: "H", race: "Orc", cls: "Shaman" }, ["Durotar", "The Barrens"]);
    expect(sim.sections[1]!.end).toBeGreaterThan(12);
    expect(sim.problems.filter((p) => p.severity === "error")).toEqual([]);
  });
  it("suggests zones for a level", () => {
    const book = new Book(rows, index.zones, []);
    const names = suggestZones(book, DEFAULT_CHARACTER, 11, new Set([zoneId("Elwynn Forest")]), new Set(), false, zoneId("Elwynn Forest")).map((s) => s.zone.name);
    expect(names[0]).toBe("Westfall");
    expect(names).not.toContain("The Barrens");
    const horde = suggestZones(book, { ...DEFAULT_CHARACTER, faction: "H", race: "Orc" }, 11, new Set()).map((s) => s.zone.name);
    expect(horde.slice(0, 3)).toContain("The Barrens");
  });
});
