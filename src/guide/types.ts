/**
 * An OpenXP guide (the RestedXP guide format), as data.
 *
 * The model keeps everything a guide file says, including commands this site
 * doesn't know, so a guide can be read, edited and written back without
 * losing anything.
 *
 *     #name 21-22 Ashenvale            <- header tag
 *     << Alliance                      <- header condition
 *
 *     step << Hunter                   <- step, with a condition
 *         #completewith next           <- step tag
 *         .goto Ashenvale,34.41,47.99  <- command
 *         >>Talk to Daelyshia          <- text
 *         .fp Astranaar >>Get the flight path --a comment
 */

/** `<< Alliance`, `<< !Hunter`, `<< Horde Warrior/Rogue`: who a line, step or guide is for. */
export type Condition = string;

/** `#name value` or `#tag = value`. Before the first step it describes the guide, inside a step the step. */
export interface TagLine {
  kind: "tag";
  tag: string;
  value: string;
  /** Written as `#tag = value`: the value names an addon function. */
  assign?: boolean;
  condition?: Condition;
  comment?: string;
}

/** `.accept 1024 >>Accept Raene's Cleansing`. */
export interface CommandLine {
  kind: "command";
  name: string;
  /** Everything between the name and `>>`, e.g. `Ashenvale,34.41,47.99`. See splitArgs(). */
  args: string;
  text?: string;
  condition?: Condition;
  comment?: string;
}

/** A line of instructions: `>>Talk to X`, `+Do this by hand`, `*A warning`. */
export interface TextLine {
  kind: "text";
  /** `>>` plain text, `+` a step you tick off yourself, `*` a note; "" when the line has only a condition. */
  marker: ">>" | "+" | "*" | "";
  text: string;
  condition?: Condition;
  comment?: string;
}

/** A line that is only a comment. */
export interface CommentLine {
  kind: "comment";
  comment: string;
}

export type HeaderLine = TagLine | TextLine | CommentLine;
export type StepLine = TagLine | CommandLine | TextLine | CommentLine;

export interface Step {
  condition?: Condition;
  comment?: string;
  /** Text after `step` that isn't a condition (a typo such as `step Warrior`). The addon ignores it; kept so nothing is lost. */
  stray?: string;
  lines: StepLine[];
}

export interface Guide {
  header: HeaderLine[];
  steps: Step[];
}
