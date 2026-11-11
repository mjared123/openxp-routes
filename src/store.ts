/** The editor's state: the route being built, with undo and saving in the browser. */
import { useCallback, useEffect, useReducer } from "react";
import type { Faction } from "./data";
import { guideTag, parseGuide, serializeGuide, type Guide, type Step } from "./guide";
import { guideFaction, newGuide, setGuideFaction, setGuideName } from "./route";

const STORAGE_KEY = "openxp-routes:route";
const HISTORY = 100;

export interface RouteState {
  guide: Guide;
  /** Index of the selected step; new steps go after it. */
  selected: number | null;
  past: Guide[];
  future: Guide[];
}

export type RouteEvent =
  | { type: "steps"; steps: Step[]; selected?: number | null }
  | { type: "select"; index: number | null }
  | { type: "name"; name: string }
  | { type: "faction"; faction: Faction }
  | { type: "load"; guide: Guide }
  | { type: "undo" }
  | { type: "redo" };

function change(state: RouteState, guide: Guide, selected = state.selected): RouteState {
  return { guide, selected, past: [...state.past.slice(-HISTORY), state.guide], future: [] };
}

function reduce(state: RouteState, event: RouteEvent): RouteState {
  switch (event.type) {
    case "steps":
      return change(state, { ...state.guide, steps: event.steps }, event.selected === undefined ? state.selected : event.selected);
    case "select":
      return { ...state, selected: event.index };
    case "name":
      return change(state, setGuideName(state.guide, event.name));
    case "faction":
      return change(state, setGuideFaction(state.guide, event.faction));
    case "load":
      return change(state, event.guide, null);
    case "undo": {
      const guide = state.past[state.past.length - 1];
      if (!guide) return state;
      return { guide, selected: null, past: state.past.slice(0, -1), future: [state.guide, ...state.future] };
    }
    case "redo": {
      const guide = state.future[0];
      if (!guide) return state;
      return { guide, selected: null, past: [...state.past, state.guide], future: state.future.slice(1) };
    }
  }
}

function initial(): RouteState {
  let guide: Guide | undefined;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) guide = parseGuide(saved);
  } catch {
    // private windows and blocked storage: start fresh
  }
  return { guide: guide ?? newGuide("My route", "A"), selected: null, past: [], future: [] };
}

export function useRoute() {
  const [state, dispatch] = useReducer(reduce, undefined, initial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeGuide(state.guide));
    } catch {
      // nothing to do: the route still works, it just isn't remembered
    }
  }, [state.guide]);

  const name = guideTag(state.guide, "name") ?? "";
  const faction: Faction = guideFaction(state.guide) ?? "A";
  const setSteps = useCallback((steps: Step[], selected?: number | null) => dispatch({ type: "steps", steps, selected }), []);
  return { state, dispatch, name, faction, setSteps };
}
