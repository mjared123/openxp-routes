import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeShareString,
  encodeShareString,
  extractGuides,
  guideTag,
  parseGuide,
  readAction,
  serializeGuide,
  writeAction,
} from "./index";

const SAMPLE = `#forever
#version 1
<< Alliance
#group OpenXP Forever Guide (A)
#name 21-22 Ashenvale
#next 21-22 Stonetalon Mountains

step
    #completewith next
    .zone Ashenvale >>Travel to Astranaar in Ashenvale
step << Hunter/Warrior
    .goto Ashenvale,34.41,47.99
    >>Talk to |cRXP_FRIENDLY_Daelyshia|r
    .fp Astranaar >>Get the Astranaar flight path
    .target Daelyshia
step
    #xprate >1.49 << Hunter
    .goto Ashenvale,39.61,36.31
    .complete -1054,1 --Culling the Threat
    .turnin -1054 >>Turn in Culling the Threat << !Rogue
    +Sell your junk
    *|cRXP_WARN_Careful, he hits hard|r << Mage
    --a note for guide writers
    .somethingNew 1,2,3
`;

/**
 * What the addon sees of a guide: no indentation or blank lines, and no
 * difference between `>> text` and `>>text`, which hand-written guides mix.
 */
function normalize(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/\s+/g, " ")
        .replace(/ ?(>>|<<|--) ?/g, "$1"),
    )
    .filter((l) => l !== "");
}

describe("parseGuide", () => {
  const guide = parseGuide(SAMPLE);

  it("reads the header", () => {
    expect(guideTag(guide, "name")).toBe("21-22 Ashenvale");
    expect(guideTag(guide, "forever")).toBe("");
    expect(guide.header).toContainEqual({ kind: "text", marker: "", text: "", condition: "Alliance" });
  });

  it("reads steps, conditions, text and comments", () => {
    expect(guide.steps).toHaveLength(3);
    expect(guide.steps[1]!.condition).toBe("Hunter/Warrior");
    expect(guide.steps[0]!.lines).toEqual([
      { kind: "tag", tag: "completewith", value: "next" },
      { kind: "command", name: "zone", args: "Ashenvale", text: "Travel to Astranaar in Ashenvale" },
    ]);
    const last = guide.steps[2]!.lines;
    expect(last[0]).toEqual({ kind: "tag", tag: "xprate", value: ">1.49", condition: "Hunter" });
    expect(last[2]).toEqual({ kind: "command", name: "complete", args: "-1054,1", comment: "Culling the Threat" });
    expect(last[3]).toEqual({ kind: "command", name: "turnin", args: "-1054", text: "Turn in Culling the Threat", condition: "!Rogue" });
    expect(last[4]).toEqual({ kind: "text", marker: "+", text: "Sell your junk" });
    expect(last[5]).toMatchObject({ kind: "text", marker: "*", condition: "Mage" });
    expect(last[6]).toEqual({ kind: "comment", comment: "a note for guide writers" });
    expect(last[7]).toEqual({ kind: "command", name: "somethingNew", args: "1,2,3" });
  });

  it("writes back exactly what it read", () => {
    expect(serializeGuide(guide)).toBe(SAMPLE);
  });
});

describe("actions", () => {
  it("reads the commands the editor knows", () => {
    const lines = parseGuide(SAMPLE).steps.flatMap((s) => s.lines);
    expect(lines.map(readAction).filter(Boolean)).toEqual([
      { type: "goto", zone: "Ashenvale", x: 34.41, y: 47.99 },
      { type: "flightPath", place: "Astranaar" },
      { type: "target", name: "Daelyshia" },
      { type: "goto", zone: "Ashenvale", x: 39.61, y: 36.31 },
      { type: "complete", questId: 1054, objective: 1 },
      { type: "turnin", questId: 1054 },
    ]);
  });

  it("writes them", () => {
    expect(writeAction({ type: "goto", zone: "Ashenvale", x: 34.4, y: 48 })).toEqual({
      kind: "command",
      name: "goto",
      args: "Ashenvale,34.40,48.00",
    });
    const accept = writeAction({ type: "accept", questId: 1024 }, "Accept Raene's Cleansing");
    expect(readAction(accept)).toEqual({ type: "accept", questId: 1024 });
    expect(accept.text).toBe("Accept Raene's Cleansing");
  });
});

describe("share strings", () => {
  it("survive a round trip", () => {
    const share = encodeShareString([SAMPLE, "#name Second\n\nstep\n    .hs Astranaar\n"]);
    expect(share).toMatch(/^OXP1:[A-Za-z0-9+/=]+$/);
    expect(decodeShareString(` ${share}\n`)).toEqual([SAMPLE, "#name Second\n\nstep\n    .hs Astranaar\n"]);
  });

  it("reject anything else", () => {
    expect(() => decodeShareString("hello")).toThrow(/share string/);
    expect(() => decodeShareString("OXP1:not-base64!")).toThrow(/damaged/);
  });
});

/**
 * The real thing: every guide OpenXP ships. Its guides aren't part of this
 * repository (they have a different license), so point OPENXP_DIR at a
 * checkout of github.com/mjared123/OpenXP to run this.
 */
const openxp = process.env.OPENXP_DIR;
describe.skipIf(!openxp || !existsSync(join(openxp, "Guides")))("OpenXP's own guides", () => {
  // describe bodies run even when skipped, so don't touch the folder unless it is there
  const files = (openxp ? ["forever", "openxp"] : []).flatMap((dir) => {
    const path = join(openxp!, "Guides", dir);
    return existsSync(path) ? readdirSync(path).filter((f) => f.endsWith(".lua")).map((f) => join(path, f)) : [];
  });

  it("round-trip line for line", () => {
    let guides = 0;
    let steps = 0;
    for (const file of files) {
      for (const text of extractGuides(readFileSync(file, "utf8"))) {
        const guide = parseGuide(text);
        const written = serializeGuide(guide);
        expect(normalize(written), file).toEqual(normalize(text));
        expect(parseGuide(written), file).toEqual(guide);
        guides++;
        steps += guide.steps.length;
      }
    }
    expect(guides).toBeGreaterThan(100);
    console.log(`round-tripped ${guides} guides, ${steps} steps`);
  });
});
