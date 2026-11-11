/**
 * The commands the route editor understands, as typed actions.
 *
 * A guide can hold any command (see types.ts); these are the ones the editor
 * creates and shows on the map. Everything else passes through untouched.
 */
import { splitArgs } from "./parse";
import type { CommandLine, StepLine } from "./types";

export type Action =
  | { type: "goto"; zone: string; x: number; y: number }
  | { type: "accept"; questId: number }
  | { type: "turnin"; questId: number }
  /** objective is the quest's 1-based objective number; absent means the whole quest. */
  | { type: "complete"; questId: number; objective?: number }
  | { type: "flightPath"; place: string }
  | { type: "fly"; place: string }
  | { type: "setHearth"; place: string }
  | { type: "hearth"; place: string }
  | { type: "reachLevel"; level: number }
  | { type: "target"; name: string }
  | { type: "mob"; name: string };

const PLACE_COMMANDS = { fp: "flightPath", fly: "fly", home: "setHearth", hs: "hearth" } as const;

/** Guides write quest ids with a leading "-" to mean "don't warn if the quest is missing"; the id is the same. */
function questId(arg: string | undefined): number | undefined {
  const id = Math.abs(Number.parseInt(arg ?? "", 10));
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

/** What a line does, if it is one of the editor's commands. */
export function readAction(line: StepLine): Action | undefined {
  if (line.kind !== "command") return undefined;
  const args = splitArgs(line.args);
  switch (line.name) {
    case "goto": {
      const [zone, x, y] = [args[0], Number(args[1]), Number(args[2])];
      return zone && Number.isFinite(x) && Number.isFinite(y) ? { type: "goto", zone, x, y } : undefined;
    }
    case "accept":
    case "turnin": {
      const id = questId(args[0]);
      return id ? { type: line.name, questId: id } : undefined;
    }
    case "complete": {
      const id = questId(args[0]);
      if (!id) return undefined;
      const objective = Number.parseInt(args[1] ?? "", 10);
      return Number.isFinite(objective) ? { type: "complete", questId: id, objective } : { type: "complete", questId: id };
    }
    case "fp":
    case "fly":
    case "home":
    case "hs":
      return { type: PLACE_COMMANDS[line.name], place: line.args };
    case "xp": {
      const level = Number.parseFloat(args[0] ?? "");
      return Number.isFinite(level) ? { type: "reachLevel", level } : undefined;
    }
    case "target":
    case "mob":
      return line.args ? { type: line.name, name: line.args } : undefined;
    default:
      return undefined;
  }
}

function coordinate(n: number): string {
  return n.toFixed(2);
}

/** The guide line for an action. `text` is what the player reads next to it. */
export function writeAction(action: Action, text?: string): CommandLine {
  const line = (name: string, args: string): CommandLine =>
    text === undefined ? { kind: "command", name, args } : { kind: "command", name, args, text };
  switch (action.type) {
    case "goto":
      return line("goto", `${action.zone},${coordinate(action.x)},${coordinate(action.y)}`);
    case "accept":
    case "turnin":
      return line(action.type, String(action.questId));
    case "complete":
      return line("complete", action.objective === undefined ? String(action.questId) : `${action.questId},${action.objective}`);
    case "flightPath":
      return line("fp", action.place);
    case "fly":
      return line("fly", action.place);
    case "setHearth":
      return line("home", action.place);
    case "hearth":
      return line("hs", action.place);
    case "reachLevel":
      return line("xp", String(action.level));
    case "target":
    case "mob":
      return line(action.type, action.name);
  }
}
