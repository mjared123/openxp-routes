import type { CommandLine, Guide, HeaderLine, Step, StepLine, TagLine, TextLine } from "./types";

/** Split a line into its code and its `--comment`, the way the addon drops comments. */
function splitComment(line: string): [code: string, comment: string | undefined] {
  const at = line.indexOf("--");
  return at < 0 ? [line, undefined] : [line.slice(0, at), line.slice(at + 2)];
}

/** Take a trailing `<< condition` off a line. */
function splitCondition(code: string): [rest: string, condition: string | undefined] {
  const m = /\s*<<\s*(.+)$/.exec(code);
  return m ? [code.slice(0, m.index), m[1]!.trim()] : [code, undefined];
}

function withExtras<T extends object>(line: T, condition?: string, comment?: string): T {
  if (condition !== undefined) Object.assign(line, { condition });
  if (comment !== undefined) Object.assign(line, { comment });
  return line;
}

function parseTag(code: string): TagLine | undefined {
  const m = /^#(\S+)\s*(=?)\s*(.*)$/.exec(code);
  if (!m) return undefined;
  const tag: TagLine = { kind: "tag", tag: m[1]!, value: m[3]! };
  if (m[2]) tag.assign = true;
  return tag;
}

function parseLine(raw: string): StepLine | undefined {
  const [codeRaw, comment] = splitComment(raw);
  const trimmed = codeRaw.trim();
  if (!trimmed) return comment === undefined ? undefined : { kind: "comment", comment };

  const [code, condition] = splitCondition(trimmed);

  const tag = parseTag(code);
  if (tag) return withExtras(tag, condition, comment);

  if (code.startsWith(".")) {
    const at = code.indexOf(">>");
    const call = (at < 0 ? code : code.slice(0, at)).trim();
    const m = /^\.(\S+)\s*(.*)$/.exec(call)!;
    const line: CommandLine = { kind: "command", name: m[1]!, args: m[2]!.trim() };
    if (at >= 0) line.text = code.slice(at + 2).trim();
    return withExtras(line, condition, comment);
  }

  let marker: TextLine["marker"] = "";
  let text = code;
  if (code.startsWith(">>")) [marker, text] = [">>", code.slice(2)];
  else if (code.startsWith("+")) [marker, text] = ["+", code.slice(1)];
  else if (code.startsWith("*")) [marker, text] = ["*", code.slice(1)];
  return withExtras<TextLine>({ kind: "text", marker, text: text.trim() }, condition, comment);
}

/** Read one guide: the text between `RegisterGuide([[` and `]])`, or a guide on its own. */
export function parseGuide(text: string): Guide {
  const guide: Guide = { header: [], steps: [] };
  let step: Step | undefined;
  for (const raw of text.split(/\r?\n|\r/)) {
    const [codeRaw, comment] = splitComment(raw);
    const code = codeRaw.trim();
    // The addon starts a step at any line beginning with "step".
    if (/^step(\s|<<|$)/.test(code)) {
      const [rest, condition] = splitCondition(code);
      step = withExtras<Step>({ lines: [] }, condition, comment);
      const stray = rest.slice(4).trim();
      if (stray) step.stray = stray;
      guide.steps.push(step);
      continue;
    }
    const line = parseLine(raw);
    if (!line) continue;
    if (step) step.lines.push(line);
    else if (line.kind === "command") {
      // Commands can't appear before the first step; keep the line as text so nothing is lost.
      guide.header.push({ kind: "text", marker: "", text: raw.trim() });
    } else guide.header.push(line as HeaderLine);
  }
  return guide;
}

/** The guides inside an addon guide file (`RXPGuides.RegisterGuide([[ ... ]])`, once per guide). */
export function extractGuides(luaFile: string): string[] {
  return [...luaFile.matchAll(/RegisterGuide\(\s*\[\[([\s\S]*?)\]\]/g)].map((m) => m[1]!);
}

/** A command's arguments: `Ashenvale, 34.41,47.99` -> ["Ashenvale", "34.41", "47.99"]. */
export function splitArgs(args: string): string[] {
  return args
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a !== "");
}
