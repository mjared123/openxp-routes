import type { Guide, HeaderLine, StepLine } from "./types";

const INDENT = "    ";

function tail(line: { condition?: string; comment?: string }): string {
  return (line.condition !== undefined ? ` << ${line.condition}` : "") + (line.comment !== undefined ? ` --${line.comment}` : "");
}

export function serializeLine(line: StepLine | HeaderLine): string {
  switch (line.kind) {
    case "comment":
      return `--${line.comment}`;
    case "tag": {
      const value = line.assign ? ` = ${line.value}` : line.value ? ` ${line.value}` : "";
      return `#${line.tag}${value}${tail(line)}`;
    }
    case "command": {
      const args = line.args ? ` ${line.args}` : "";
      const text = line.text !== undefined ? ` >>${line.text}` : "";
      return `.${line.name}${args}${text}${tail(line)}`;
    }
    case "text":
      return `${line.marker}${line.text}${tail(line)}`.trimStart();
  }
}

/** Write a guide in the format the addon reads. */
export function serializeGuide(guide: Guide): string {
  const out: string[] = guide.header.map(serializeLine);
  if (out.length && guide.steps.length) out.push("");
  for (const step of guide.steps) {
    out.push(`step${step.stray ? ` ${step.stray}` : ""}${tail(step)}`);
    for (const line of step.lines) out.push(INDENT + serializeLine(line));
  }
  return out.join("\n") + "\n";
}

/** The guide's `#name`, `#group` and so on. */
export function guideTag(guide: Guide, tag: string): string | undefined {
  for (const line of guide.header) if (line.kind === "tag" && line.tag === tag) return line.value;
  return undefined;
}
