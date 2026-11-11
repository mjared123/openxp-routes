import { describe, expect, it } from "vitest";
import type { ZoneData } from "./data";
import { parseGuide, serializeGuide } from "./guide";
import { addStep, colourParts, guideFaction, newGuide, objectiveStep, questGiverStep, questUse, setGuideFaction, setGuideName, summarize, type ZoneNames } from "./route";

const zones: ZoneNames = new Map([[12, "Elwynn Forest"]]);
const data: ZoneData = {
  zone: { id: 12, name: "Elwynn Forest", kind: "zone", quests: { A: 2, H: 0 } },
  quests: [
    { id: 783, name: "A Threat Within", level: 1, minLevel: 1, side: "A", zone: 12, start: { npcs: [823] }, end: { npcs: [197] } },
    {
      id: 7, name: "Kobold Camp Cleanup", level: 2, minLevel: 1, side: "A", zone: 12, start: { npcs: [197] }, end: { npcs: [197] },
      objectives: [{ type: "npc", id: 6 }, { type: "item", id: 50 }],
    },
  ],
  npcs: {
    823: { name: "Deputy Willem", spawns: { 12: [[48.17, 42.94]] } },
    197: { name: "Marshal McBride", spawns: { 12: [[48.92, 41.61]] } },
    6: { name: "Kobold Vermin", spawns: { 12: [[47, 36], [47.5, 36.5], [48, 36], [60, 60]] } },
  },
  objects: { 9: { name: "Kobold Chest", spawns: { 12: [[46, 35]] } } },
  items: { 50: { name: "Gold Dust", objects: [9] } },
  services: {},
};
const [threat, cleanup] = data.quests as [ZoneData["quests"][number], ZoneData["quests"][number]];

describe("building steps", () => {
  it("accepts at the quest giver", () => {
    const { step, place } = questGiverStep("accept", threat, data, zones, 12);
    expect(place).toEqual({ zone: 12, point: [48.17, 42.94] });
    expect(serializeGuide({ header: [], steps: [step] })).toBe(
      "step\n    .goto Elwynn Forest,48.17,42.94\n    >>Talk to |cRXP_FRIENDLY_Deputy Willem|r\n    .accept 783 >>Accept A Threat Within\n    .target Deputy Willem\n",
    );
  });

  it("puts a kill objective where the mobs are thickest", () => {
    const { step, place } = objectiveStep(cleanup, 0, data, zones, 12);
    expect(place!.point[0]).toBeCloseTo(47.5);
    expect(place!.point[1]).toBeCloseTo(36.17, 1);
    expect(step.lines.map((l) => (l.kind === "command" ? `${l.name} ${l.args}` : l.kind))).toEqual(["goto Elwynn Forest,47.50,36.17", "text", "complete 7,1", "mob Kobold Vermin"]);
  });

  it("sends an item objective to what holds the item", () => {
    const { step } = objectiveStep(cleanup, 1, data, zones, 12);
    expect(serializeGuide({ header: [], steps: [step] })).toContain(">>Loot the |cRXP_PICK_Kobold Chest|r for |cRXP_LOOT_Gold Dust|r\n    .complete 7,2 --Kobold Camp Cleanup (2)");
  });

  it("joins a second quest at the same quest giver into one step", () => {
    let steps = addStep([], questGiverStep("turnin", threat, data, zones, 12), 0).steps;
    const joined = addStep(steps, questGiverStep("accept", cleanup, data, zones, 12), 1);
    steps = joined.steps;
    expect(steps).toHaveLength(1);
    expect(joined.index).toBe(0);
    expect(steps[0]!.lines.map((l) => (l.kind === "command" ? l.name : l.kind))).toEqual(["goto", "text", "turnin", "accept", "target"]);
    expect([...questUse(steps).entries()].map(([id, use]) => [id, [...use]])).toEqual([[783, ["turnin"]], [7, ["accept"]]]);
  });
});

describe("reading steps", () => {
  it("summarizes steps, keeping lines it doesn't know", () => {
    const guide = parseGuide("#name x\nstep << Hunter\n    #completewith next\n    .goto Elwynn Forest,48.17,42.94\n    >>Talk to |cRXP_FRIENDLY_Deputy Willem|r\n    .accept 783 >>Accept A Threat Within\n    .train 2973 >>Train Raptor Strike\n");
    const s = summarize(guide.steps[0]!, (l) => (l.kind === "command" ? `.${l.name}` : l.kind === "tag" ? `#${l.tag}` : ""));
    expect(s).toMatchObject({ kind: "accept", title: "Talk to |cRXP_FRIENDLY_Deputy Willem|r", goto: { zone: "Elwynn Forest", x: 48.17, y: 42.94 }, other: ["#completewith", ".train"], condition: "Hunter" });
  });

  it("turns colour codes into parts", () => {
    expect(colourParts("Kill |cRXP_ENEMY_Kobold Vermin|r. |T123:0|tLoot |cRXP_LOOT_Dust|r")).toEqual([
      { text: "Kill " }, { text: "Kobold Vermin", colour: "enemy" }, { text: ". Loot " }, { text: "Dust", colour: "loot" },
    ]);
  });
});

describe("guide header", () => {
  it("tracks name and faction", () => {
    let guide = newGuide("My route", "A");
    expect(guideFaction(guide)).toBe("A");
    guide = setGuideFaction(setGuideName(guide, "Horde 1-10"), "H");
    expect(serializeGuide(guide)).toBe("#forever\n#version 1\n<< Horde\n#group OpenXP Routes\n#name Horde 1-10\n");
    expect(guideFaction(parseGuide(serializeGuide(guide)))).toBe("H");
  });
});
