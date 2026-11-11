/** The editor's state: a character and a route of one or more sections, with undo and saving in the browser. */
import { useCallback, useEffect, useReducer } from "react";
import { DEFAULT_CHARACTER, type Character } from "./character";
import { NO_GOALS, type Goals, type Report } from "./generate";
import { guideTag, parseGuide, readAction, serializeGuide, type Guide, type Step } from "./guide";
import { ROUTE_GROUP, guideFaction, newGuide, setGuideFaction, setGuideName } from "./route";

const STORAGE_KEY = "openxp-routes:project";
const OLD_KEY = "openxp-routes:route";
const HISTORY = 100;

/** One part of a route: usually one visit to a zone. Exports as one guide. */
export interface Section {
  guide: Guide;
  /** The zone the section is built in. */
  zone: number | null;
}

export interface Project {
  name: string;
  character: Character;
  sections: Section[];
  /** Index of the section being worked on. */
  active: number;
  /** Quests ticked on the board that aren't on the route yet. */
  wanted: number[];
  /** False until the character has been set up once. */
  ready: boolean;
  /** What the player asked for when the route was generated. */
  goals: Goals;
  /** How generating went: what was included and what wasn't. */
  report?: Report;
}

export interface RouteState {
  project: Project;
  /** Index of the selected step in the active section; new steps go after it. */
  selected: number | null;
  past: Project[];
  future: Project[];
}

export type RouteEvent =
  | { type: "steps"; steps: Step[]; selected?: number | null; section?: number; wanted?: number[] }
  | { type: "allSteps"; steps: Step[][]; wanted?: number[] }
  | { type: "select"; index: number | null }
  | { type: "name"; name: string }
  | { type: "sectionName"; index: number; name: string }
  | { type: "character"; character: Character }
  | { type: "wanted"; wanted: number[] }
  | { type: "activate"; index: number }
  | { type: "addSection"; zone: number | null; name: string }
  | { type: "removeSection"; index: number }
  | { type: "moveSection"; from: number; to: number }
  | { type: "sectionZone"; index: number; zone: number; name?: string }
  | { type: "load"; project: Project }
  | { type: "undo" }
  | { type: "redo" };

export function newSection(name: string, character: Character, zone: number | null): Section {
  return { guide: newGuide(name, character.faction), zone };
}

export function newProject(character: Character = DEFAULT_CHARACTER, ready = false): Project {
  return { name: "My route", character, sections: [newSection("Section 1", character, null)], active: 0, wanted: [], ready, goals: NO_GOALS };
}

function change(state: RouteState, project: Project, selected = state.selected): RouteState {
  return { project, selected, past: [...state.past.slice(-HISTORY), state.project], future: [] };
}

function withSection(project: Project, index: number, update: (section: Section) => Section): Project {
  return { ...project, sections: project.sections.map((s, i) => (i === index ? update(s) : s)) };
}

function reduce(state: RouteState, event: RouteEvent): RouteState {
  const p = state.project;
  switch (event.type) {
    case "steps": {
      const index = event.section ?? p.active;
      const next = withSection(p, index, (s) => ({ ...s, guide: { ...s.guide, steps: event.steps } }));
      return change(state, event.wanted ? { ...next, wanted: event.wanted } : next, event.selected === undefined ? state.selected : event.selected);
    }
    case "allSteps": {
      const sections = p.sections.map((s, i) => ({ ...s, guide: { ...s.guide, steps: event.steps[i] ?? s.guide.steps } }));
      return change(state, { ...p, sections, wanted: event.wanted ?? p.wanted }, null);
    }
    case "select":
      return { ...state, selected: event.index };
    case "name":
      return change(state, { ...p, name: event.name });
    case "sectionName":
      return change(state, withSection(p, event.index, (s) => ({ ...s, guide: setGuideName(s.guide, event.name) })));
    case "character": {
      const sections = p.sections.map((s) => ({ ...s, guide: setGuideFaction(s.guide, event.character.faction) }));
      return change(state, { ...p, character: event.character, sections, ready: true });
    }
    case "wanted":
      return { ...state, project: { ...p, wanted: event.wanted } };
    case "activate":
      return { ...state, project: { ...p, active: event.index }, selected: null };
    case "addSection": {
      const sections = [...p.sections, newSection(event.name, p.character, event.zone)];
      return change(state, { ...p, sections, active: sections.length - 1, wanted: [] }, null);
    }
    case "removeSection": {
      if (p.sections.length <= 1) return state;
      const sections = p.sections.filter((_, i) => i !== event.index);
      return change(state, { ...p, sections, active: Math.min(p.active > event.index ? p.active - 1 : p.active, sections.length - 1) }, null);
    }
    case "moveSection": {
      const sections = [...p.sections];
      const [moved] = sections.splice(event.from, 1);
      sections.splice(event.to, 0, moved!);
      return change(state, { ...p, sections, active: event.to }, null);
    }
    case "sectionZone":
      return change(
        state,
        withSection(p, event.index, (s) => ({ zone: event.zone, guide: event.name ? setGuideName(s.guide, event.name) : s.guide })),
      );
    case "load":
      return change(state, event.project, null);
    case "undo": {
      const project = state.past[state.past.length - 1];
      if (!project) return state;
      return { project, selected: null, past: state.past.slice(0, -1), future: [p, ...state.future] };
    }
    case "redo": {
      const project = state.future[0];
      if (!project) return state;
      return { project, selected: null, past: [...state.past, p], future: state.future.slice(1) };
    }
  }
}

// --- saving -------------------------------------------------------------------------

interface Saved {
  name: string;
  character: Character;
  sections: { zone: number | null; text: string }[];
  active: number;
  wanted: number[];
  goals?: Goals;
  report?: Report;
}

export function saveProject(p: Project): string {
  const saved: Saved = { name: p.name, character: p.character, sections: p.sections.map((s) => ({ zone: s.zone, text: serializeGuide(s.guide) })), active: p.active, wanted: p.wanted, goals: p.goals, report: p.report };
  return JSON.stringify(saved);
}

export function loadProject(json: string): Project {
  const saved = JSON.parse(json) as Saved;
  const sections = saved.sections.map((s) => ({ zone: s.zone, guide: parseGuide(s.text) }));
  if (!sections.length) throw new Error("no sections");
  return {
    name: saved.name || "My route",
    character: { ...DEFAULT_CHARACTER, ...saved.character },
    sections,
    active: Math.min(Math.max(0, saved.active || 0), sections.length - 1),
    wanted: saved.wanted ?? [],
    ready: true,
    goals: { ...NO_GOALS, ...saved.goals },
    report: saved.report,
  };
}

/** The zone most of a guide's steps are in, by name. */
export function mainZone(guide: Guide): string | undefined {
  const counts = new Map<string, number>();
  for (const step of guide.steps) {
    for (const line of step.lines) {
      const a = readAction(line);
      if (a?.type === "goto") counts.set(a.zone, (counts.get(a.zone) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** A route from imported guides: each guide becomes a section. */
export function projectFromGuides(guides: Guide[], character: Character, zoneByName: Map<string, number>, name = "Imported route"): Project {
  const faction = guides.map(guideFaction).find((f) => f) ?? character.faction;
  const sections = guides.map((guide, i) => {
    const title = (guideTag(guide, "name") ?? `Section ${i + 1}`).replace(/^\d+\.\s+/, "");
    return { zone: zoneByName.get(mainZone(guide) ?? "") ?? null, guide: setGuideName(guide, title) };
  });
  return { name, character: { ...character, faction }, sections, active: 0, wanted: [], ready: true, goals: NO_GOALS };
}

/** The route's guides as the addon reads them: numbered, and each one leading to the next. */
export function exportGuides(p: Project, only?: number): Guide[] {
  const many = p.sections.length > 1;
  const title = (i: number) => {
    const name = guideTag(p.sections[i]!.guide, "name") || `Section ${i + 1}`;
    return many ? `${i + 1}. ${name}` : name;
  };
  return p.sections.flatMap((s, i) => {
    if (only !== undefined && only !== i) return [];
    let header = setGuideName(s.guide, title(i)).header.filter((l) => !(l.kind === "tag" && l.tag === "next"));
    if (!header.some((l) => l.kind === "tag" && l.tag === "group")) header = [...header, { kind: "tag", tag: "group", value: ROUTE_GROUP }];
    if (i + 1 < p.sections.length) header = [...header, { kind: "tag", tag: "next", value: title(i + 1) }];
    return [{ header, steps: s.guide.steps }];
  });
}

function initial(): RouteState {
  let project: Project | undefined;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) project = loadProject(saved);
    else {
      const old = localStorage.getItem(OLD_KEY); // a route from before sections existed
      const guide = old ? parseGuide(old) : undefined;
      if (guide?.steps.length) {
        project = { ...newProject({ ...DEFAULT_CHARACTER, faction: guideFaction(guide) ?? "A" }), name: guideTag(guide, "name") ?? "My route", sections: [{ guide, zone: null }] };
      }
    }
  } catch {
    // private windows, blocked storage or a broken save: start fresh
  }
  return { project: project ?? newProject(), selected: null, past: [], future: [] };
}

export function useRoute() {
  const [state, dispatch] = useReducer(reduce, undefined, initial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, saveProject(state.project));
    } catch {
      // nothing to do: the route still works, it just isn't remembered
    }
  }, [state.project]);

  const setSteps = useCallback((steps: Step[], selected?: number | null, wanted?: number[]) => dispatch({ type: "steps", steps, selected, wanted }), []);
  return { state, dispatch, setSteps };
}
