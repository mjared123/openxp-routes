/**
 * Turning quests into guide steps, and guide steps into something to show.
 *
 * A route is a Guide (see guide/types.ts). The editor adds steps built here;
 * anything else in an imported guide is kept and shown as it is written.
 */
import { bestSpot, type Faction, type Point, type Quest, type Spawns, type ZoneData } from "./data";
import { readAction, writeAction, type Action, type CommandLine, type Guide, type Step, type StepLine, type TextLine } from "./guide";

export const ROUTE_GROUP = "OpenXP Routes";

const text = (t: string): TextLine => ({ kind: "text", marker: ">>", text: t });
const friendly = (name: string) => `|cRXP_FRIENDLY_${name}|r`;
const enemy = (name: string) => `|cRXP_ENEMY_${name}|r`;
const loot = (name: string) => `|cRXP_LOOT_${name}|r`;
const pick = (name: string) => `|cRXP_PICK_${name}|r`;

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// --- step identity (for React keys and drag and drop) -------------------------

const keys = new WeakMap<Step, number>();
let nextKey = 1;
export function keyOf(step: Step): number {
  let key = keys.get(step);
  if (!key) keys.set(step, (key = nextKey++));
  return key;
}
/** A changed copy of a step that keeps its identity. */
export function sameStep(next: Step, previous: Step): Step {
  keys.set(next, keyOf(previous));
  return next;
}

// --- guide header ---------------------------------------------------------------

export function newGuide(name: string, faction: Faction): Guide {
  return {
    header: [
      { kind: "tag", tag: "forever", value: "" },
      { kind: "tag", tag: "version", value: "1" },
      { kind: "text", marker: "", text: "", condition: faction === "A" ? "Alliance" : "Horde" },
      { kind: "tag", tag: "group", value: ROUTE_GROUP },
      { kind: "tag", tag: "name", value: name },
    ],
    steps: [],
  };
}

export function guideFaction(guide: Guide): Faction | undefined {
  for (const line of guide.header) {
    if (line.kind === "text" && line.text === "" && line.condition) {
      if (/\bAlliance\b/.test(line.condition)) return "A";
      if (/\bHorde\b/.test(line.condition)) return "H";
    }
  }
  return undefined;
}

export function setGuideName(guide: Guide, name: string): Guide {
  let found = false;
  const header = guide.header.map((line) => {
    if (line.kind !== "tag" || line.tag !== "name") return line;
    found = true;
    return { ...line, value: name };
  });
  if (!found) header.push({ kind: "tag", tag: "name", value: name });
  return { ...guide, header };
}

export function setGuideFaction(guide: Guide, faction: Faction): Guide {
  const condition = faction === "A" ? "Alliance" : "Horde";
  let found = false;
  const header = guide.header.map((line) => {
    if (line.kind === "text" && line.text === "" && line.condition && /\b(Alliance|Horde)\b/.test(line.condition)) {
      found = true;
      return { ...line, condition };
    }
    return line;
  });
  if (!found) header.splice(Math.min(2, header.length), 0, { kind: "text", marker: "", text: "", condition });
  return { ...guide, header };
}

// --- building steps ---------------------------------------------------------------

export interface Place {
  zone: number;
  point: Point;
}

/** Zone names by id, for `.goto Zone,x,y`. */
export type ZoneNames = Map<number, string>;

function pickPlace(spawns: Spawns[], preferZone: number): Place | undefined {
  const byZone = new Map<number, Point[]>();
  for (const s of spawns) {
    for (const [zone, points] of Object.entries(s)) {
      byZone.set(Number(zone), [...(byZone.get(Number(zone)) ?? []), ...points]);
    }
  }
  if (!byZone.size) return undefined;
  const zone = byZone.has(preferZone) ? preferZone : [...byZone.entries()].sort((a, b) => b[1].length - a[1].length)[0]![0];
  const point = bestSpot(byZone.get(zone)!);
  return point ? { zone, point } : undefined;
}

function gotoLine(place: Place | undefined, zones: ZoneNames): CommandLine[] {
  const zone = place && zones.get(place.zone);
  return place && zone ? [writeAction({ type: "goto", zone, x: place.point[0], y: place.point[1] })] : [];
}

export interface Built {
  step: Step;
  place?: Place;
}

/** "Accept" or "turn in" a quest at its quest giver. */
export function questGiverStep(kind: "accept" | "turnin", quest: Quest, data: ZoneData, zones: ZoneNames, viewZone: number): Built {
  const who = kind === "accept" ? quest.start : quest.end;
  const npcs = (who?.npcs ?? []).map((id) => data.npcs[id]).filter((n) => n !== undefined);
  const objects = (who?.objects ?? []).map((id) => data.objects[id]).filter((o) => o !== undefined);
  const items = kind === "accept" ? (quest.start?.items ?? []).map((id) => data.items[id]).filter((i) => i !== undefined) : [];
  const verb = kind === "accept" ? "Accept" : "Turn in";
  const action = writeAction({ type: kind, questId: quest.id }, `${verb} ${quest.name}`);

  const withSpawns = [...npcs, ...objects].filter((e) => Object.keys(e.spawns).length);
  // one giver is enough: the one in the zone being looked at, if any
  const giver = withSpawns.find((e) => e.spawns[viewZone]) ?? withSpawns[0];
  const place = giver && pickPlace([giver.spawns], viewZone);
  const lines: StepLine[] = [...gotoLine(place, zones)];
  if (giver && npcs.includes(giver as (typeof npcs)[number])) {
    lines.push(text(`Talk to ${friendly(giver.name)}`), action, { kind: "command", name: "target", args: giver.name });
  } else if (giver) {
    lines.push(text(`Click the ${pick(giver.name)}`), action);
  } else if (items.length) {
    // the quest starts from an item: go where it drops or lies
    const item = items[0]!;
    const droppers = (item.npcs ?? []).map((id) => data.npcs[id]).filter((n) => n !== undefined);
    const holders = (item.objects ?? []).map((id) => data.objects[id]).filter((o) => o !== undefined);
    const here = droppers.filter((d) => d.spawns[viewZone]);
    const from = here.length ? here : droppers;
    const names = [...new Set(from.map((d) => d.name))];
    const source = pickPlace((from.length ? from : holders).map((e) => e.spawns), viewZone);
    const how = from.length ? `Kill ${list(names.slice(0, 3).map(enemy))} until ${loot(item.name)} drops. Use it` : holders.length ? `Loot ${loot(item.name)} from the ${pick(holders[0]!.name)}. Use it` : `Use ${loot(item.name)}`;
    const itemLines: StepLine[] = [...gotoLine(source, zones), text(`${how} to start the quest`), action, ...names.slice(0, 3).map((name) => writeAction({ type: "mob", name }))];
    return { step: { lines: itemLines }, place: source };
  } else lines.push(action);
  return { step: { lines }, place };
}

/** The number the game gives an objective (creatures, objects, items, kill credit, in that order). */
function objectiveNumber(quest: Quest, index: number): number | undefined {
  const numbered = (quest.objectives ?? []).filter((o) => o.type !== "event" && o.type !== "reputation");
  const at = numbered.indexOf(quest.objectives![index]!);
  return at < 0 ? undefined : at + 1;
}

export function objectiveLabel(quest: Quest, index: number, data: ZoneData): string {
  const o = quest.objectives![index]!;
  switch (o.type) {
    case "npc":
      return o.text ?? `Kill ${data.npcs[o.id!]?.name ?? "the target"}`;
    case "object":
      return o.text ?? `Use ${data.objects[o.id!]?.name ?? "the object"}`;
    case "item":
      return `Collect ${data.items[o.id!]?.name ?? "the item"}`;
    case "killCredit":
      return o.text ?? `Kill ${list((o.ids ?? []).map((id) => data.npcs[id]?.name).filter((n): n is string => !!n).slice(0, 3))}`;
    case "reputation":
      return "Earn reputation";
    case "event":
      return o.text ?? "Complete the objective";
  }
}

/** A step for one objective of a quest. */
export function objectiveStep(quest: Quest, index: number, data: ZoneData, zones: ZoneNames, viewZone: number): Built {
  const o = quest.objectives![index]!;
  const n = objectiveNumber(quest, index);
  const complete = writeAction(n ? { type: "complete", questId: quest.id, objective: n } : { type: "complete", questId: quest.id });
  complete.comment = `${quest.name}${n ? ` (${n})` : ""}`;
  const mobs = (ids: number[]) => ids.map((id) => data.npcs[id]).filter((m) => m !== undefined);
  const mobLines = (names: string[]): CommandLine[] => names.slice(0, 4).map((name) => writeAction({ type: "mob", name }));
  let spawns: Spawns[] = [];
  let lines: StepLine[] = [];

  if (o.type === "npc" || o.type === "killCredit") {
    const targets = mobs(o.type === "npc" ? [o.id!] : (o.ids ?? []));
    const names = [...new Set(targets.map((t) => t.name))];
    spawns = targets.map((t) => t.spawns);
    lines = [text(o.text ?? `Kill ${list(names.slice(0, 4).map(enemy))}`), complete, ...mobLines(names)];
  } else if (o.type === "object") {
    const obj = data.objects[o.id!];
    spawns = obj ? [obj.spawns] : [];
    lines = [text(o.text ?? `Click the ${pick(obj?.name ?? "object")}`), complete];
  } else if (o.type === "item") {
    const item = data.items[o.id!];
    const name = loot(item?.name ?? "the item");
    const droppers = mobs(item?.npcs ?? []);
    const containers = (item?.objects ?? []).map((id) => data.objects[id]).filter((c) => c !== undefined);
    const vendors = mobs(item?.vendors ?? []);
    if (droppers.length) {
      // the mobs that live where you are come first
      const here = droppers.filter((d) => d.spawns[viewZone]);
      const use = here.length ? here : droppers;
      const names = [...new Set(use.map((d) => d.name))];
      spawns = use.map((d) => d.spawns);
      lines = [text(`Kill ${list(names.slice(0, 4).map(enemy))}. Loot them for ${name}`), complete, ...mobLines(names)];
    } else if (containers.length) {
      spawns = containers.map((c) => c.spawns);
      lines = [text(`Loot the ${pick(containers[0]!.name)} for ${name}`), complete];
    } else if (vendors.length) {
      const vendor = vendors.find((v) => v.spawns[viewZone]) ?? vendors[0]!;
      spawns = [vendor.spawns];
      lines = [text(`Buy ${name} from ${friendly(vendor.name)}`), complete, writeAction({ type: "target", name: vendor.name })];
    } else lines = [text(`Collect ${name}`), complete];
  } else {
    spawns = o.spawns ? [o.spawns] : [];
    lines = [text(o.text ?? `Complete ${quest.name}`), writeAction({ type: "complete", questId: quest.id })];
  }
  const place = pickPlace(spawns, viewZone);
  return { step: { lines: [...gotoLine(place, zones), ...lines] }, place };
}

export function serviceStep(kind: "flight" | "inn", npcName: string, place: Place, placeName: string, zones: ZoneNames): Built {
  const action: Action = kind === "flight" ? { type: "flightPath", place: placeName } : { type: "setHearth", place: placeName };
  const label = kind === "flight" ? `Get the ${placeName} flight path` : `Set your Hearthstone to ${placeName}`;
  return {
    step: {
      lines: [...gotoLine(place, zones), text(`Talk to ${friendly(npcName)}`), writeAction(action, label), writeAction({ type: "target", name: npcName })],
    },
    place,
  };
}

export function waypointStep(place: Place, zones: ZoneNames, note = "Go here"): Built {
  return { step: { lines: [...gotoLine(place, zones), text(note)] }, place };
}

export function noteStep(note: string): Step {
  return { lines: [{ kind: "text", marker: "+", text: note }] };
}

/**
 * Add a built step to the route. Accepting or turning in a second quest at the
 * same spot joins the step that is already there instead of making a new one.
 */
export function addStep(steps: Step[], built: Built, at: number): { steps: Step[]; index: number } {
  const previous = steps[at - 1];
  const action = built.step.lines.map(readAction).find((a) => a?.type === "accept" || a?.type === "turnin");
  const here = built.step.lines.map(readAction).find((a) => a?.type === "goto");
  if (previous && action && here?.type === "goto") {
    const there = previous.lines.map(readAction);
    const sameSpot = there.some((a) => a?.type === "goto" && a.zone === here.zone && Math.hypot(a.x - here.x, a.y - here.y) < 0.3);
    const talks = there.some((a) => a?.type === "accept" || a?.type === "turnin") && !there.some((a) => a?.type === "complete");
    if (sameSpot && talks) {
      const line = built.step.lines.find((l) => readAction(l) === undefined ? false : ["accept", "turnin"].includes(readAction(l)!.type))!;
      const lines = [...previous.lines];
      const target = lines.findIndex((l) => l.kind === "command" && l.name === "target");
      lines.splice(target < 0 ? lines.length : target, 0, line);
      const next = [...steps];
      next[at - 1] = sameStep({ ...previous, lines }, previous);
      return { steps: next, index: at - 1 };
    }
  }
  const next = [...steps];
  next.splice(at, 0, built.step);
  return { steps: next, index: at };
}

// --- reading steps ----------------------------------------------------------------

export type StepKind = "accept" | "turnin" | "complete" | "travel" | "level" | "note";

export interface StepSummary {
  kind: StepKind;
  /** The step's instructions, in the game's colour markup. */
  title: string;
  actions: { action: Action; text?: string }[];
  goto?: { zone: string; x: number; y: number };
  /** Lines the editor doesn't understand, shown as written. */
  other: string[];
  condition?: string;
}

export function summarize(step: Step, describe: (line: StepLine) => string): StepSummary {
  const actions: StepSummary["actions"] = [];
  const texts: string[] = [];
  const other: string[] = [];
  let goto: StepSummary["goto"];
  for (const line of step.lines) {
    const action = readAction(line);
    if (action?.type === "goto") goto ??= action;
    else if (action?.type === "target" || action?.type === "mob") continue;
    else if (action) actions.push({ action, text: (line as CommandLine).text });
    else if (line.kind === "text" && line.text) texts.push(line.text);
    else if (line.kind === "command" && line.text && !texts.length) texts.push(line.text);
    else if (line.kind !== "comment") other.push(describe(line));
  }
  const types = new Set(actions.map((a) => a.action.type));
  const kind: StepKind = types.has("complete")
    ? "complete"
    : types.has("accept")
      ? "accept"
      : types.has("turnin")
        ? "turnin"
        : types.has("flightPath") || types.has("fly") || types.has("hearth") || types.has("setHearth")
          ? "travel"
          : types.has("reachLevel")
            ? "level"
            : goto
              ? "travel"
              : "note";
  const title = texts[0] ?? actions.find((a) => a.text)?.text ?? (goto ? `Go to ${goto.zone}` : (other[0] ?? "Empty step"));
  return { kind, title, actions, goto, other: texts[0] === undefined && !actions.length && !goto ? other.slice(1) : other, condition: step.condition };
}

/** Quest ids a route accepts and turns in, to mark quests as used in the browser. */
export function questUse(steps: Step[]): Map<number, Set<"accept" | "turnin" | "complete">> {
  const use = new Map<number, Set<"accept" | "turnin" | "complete">>();
  for (const step of steps) {
    for (const line of step.lines) {
      const a = readAction(line);
      if (a?.type === "accept" || a?.type === "turnin" || a?.type === "complete") {
        if (!use.has(a.questId)) use.set(a.questId, new Set());
        use.get(a.questId)!.add(a.type);
      }
    }
  }
  return use;
}

/** The game's `|cRXP_FRIENDLY_Name|r` colour markup as pieces to render. */
export function colourParts(markup: string): { text: string; colour?: string }[] {
  const parts: { text: string; colour?: string }[] = [];
  const clean = markup.replace(/\|T[^|]*\|t/g, "");
  const re = /\|c(?:RXP_([A-Z]+)_|[0-9a-fA-F]{8})(.*?)\|r/g;
  let last = 0;
  for (const m of clean.matchAll(re)) {
    if (m.index > last) parts.push({ text: clean.slice(last, m.index) });
    parts.push(...colourParts(m[2]!).map((p) => ({ text: p.text, colour: p.colour ?? m[1]?.toLowerCase() ?? "warn" })));
    last = m.index + m[0].length;
  }
  if (last < clean.length) parts.push({ text: clean.slice(last).replace(/\|r/g, "") });
  return parts;
}
