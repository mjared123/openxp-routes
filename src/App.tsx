import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Book } from "./book";
import { canTake, startZone, type Character } from "./character";
import { CharacterDialog } from "./components/CharacterDialog";
import { ExportDialog, ImportDialog, PromptDialog, type PromptRequest } from "./components/Dialogs";
import { Icon } from "./components/Icon";
import { MapView, type Pin, type RouteStop } from "./components/MapView";
import { QuestBoard } from "./components/QuestBoard";
import { RoutePanel } from "./components/RoutePanel";
import { bestSpot, loadIndex, loadQuestRows, loadZone, type DataIndex, type Point, type Quest, type QuestRow, type Spawns, type ZoneData } from "./data";
import { guideTag, readAction, serializeLine, writeAction, type Step } from "./guide";
import { pickQuests, planRoute, removeQuest, suggestZones } from "./planner";
import { addStep, noteStep, objectiveStep, questGiverStep, questUse, sameStep, serviceStep, summarize, waypointStep, type Built, type Place, type ZoneNames } from "./route";
import { levelParts, simulate, type Problem, type SimState } from "./sim";
import { newProject, useRoute } from "./store";
import { levelOf } from "./xp";

function points(spawns: Spawns | undefined, zone: number): Point[] {
  return spawns?.[zone] ?? [];
}

/** Quests a list of steps accepts. */
function acceptedIn(steps: Step[]): number[] {
  return steps.flatMap((s) => s.lines.flatMap((l) => {
    const a = readAction(l);
    return a?.type === "accept" ? [a.questId] : [];
  }));
}

export function App() {
  const { state, dispatch, setSteps } = useRoute();
  const { project, selected } = state;
  const c = project.character;
  const active = Math.min(project.active, project.sections.length - 1);
  const section = project.sections[active]!;
  const guide = section.guide;

  const [index, setIndex] = useState<DataIndex | null>(null);
  const [rows, setRows] = useState<QuestRow[]>([]);
  const [zones, setZones] = useState<Map<number, ZoneData>>(new Map());
  const [zoneId, setZoneId] = useState<number | null>(section.zone);
  const [error, setError] = useState<string | null>(null);
  const [quest, setQuest] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [dialog, setDialog] = useState<"export" | "import" | "character" | null>(null);
  const [ask, setAsk] = useState<PromptRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    loadIndex().then(setIndex, (e: Error) => setError(e.message));
    loadQuestRows().then(setRows, (e: Error) => setError(e.message));
  }, []);

  // the board shows the active section's zone
  useEffect(() => {
    if (section.zone !== null) setZoneId(section.zone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, section.zone]);

  // a section without a zone yet gets one that fits the character
  useEffect(() => {
    if (!index || !project.ready || section.zone !== null) return;
    const zone = guide.steps.length ? undefined : startZone(c, index);
    if (zone !== undefined && c.level <= 5) dispatch({ type: "sectionZone", index: active, zone, name: index.zones.find((z) => z.id === zone)?.name });
    else if (zoneId === null) setZoneId(suggestZones(book, c, c.level, new Set())[0]?.zone.id ?? startZone(c, index) ?? index.zones[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, project.ready, section.zone, active]);

  const zoneOfQuest = useMemo(() => new Map(rows.map((r) => [r[0], r[5]])), [rows]);

  // load every zone the route touches, so levels and problems can be worked out
  const needed = useMemo(() => {
    const ids = new Set<number>();
    if (zoneId !== null) ids.add(zoneId);
    for (const s of project.sections) {
      if (s.zone !== null) ids.add(s.zone);
      for (const id of acceptedIn(s.guide.steps)) {
        const zone = zoneOfQuest.get(id);
        if (zone !== undefined) ids.add(zone);
      }
    }
    for (const id of project.wanted) {
      const zone = zoneOfQuest.get(id);
      if (zone !== undefined) ids.add(zone);
    }
    return [...ids].sort((a, b) => a - b).join(",");
  }, [zoneId, project.sections, project.wanted, zoneOfQuest]);

  useEffect(() => {
    let stale = false;
    for (const id of needed.split(",").filter(Boolean).map(Number)) {
      if (zones.has(id)) continue;
      loadZone(id).then(
        (d) => !stale && setZones((prev) => (prev.has(id) ? prev : new Map(prev).set(id, d))),
        (e: Error) => !stale && id === zoneId && setError(e.message),
      );
    }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed]);

  const book = useMemo(() => new Book(rows, index?.zones ?? [], [...zones.values()]), [rows, index, zones]);
  const zoneNames: ZoneNames = useMemo(() => new Map(index?.zones.map((z) => [z.id, z.name])), [index]);
  const zoneByName = useMemo(() => new Map(index?.zones.map((z) => [z.name, z.id])), [index]);
  const zone = index?.zones.find((z) => z.id === zoneId) ?? null;
  const data = zoneId === null ? null : (zones.get(zoneId) ?? null);

  const allSteps = useMemo(() => project.sections.map((s) => s.guide.steps), [project.sections]);
  const sim = useMemo(() => simulate(allSteps, c, book), [allSteps, c, book]);
  const summaries = useMemo(() => guide.steps.map((s) => summarize(s, serializeLine)), [guide.steps]);
  const onRoute = useMemo(() => new Set(allSteps.flatMap((steps) => [...questUse(steps).keys()])), [allSteps]);
  const wanted = useMemo(() => new Set(project.wanted), [project.wanted]);
  /** XP and quest log at the end of the active section: where new quests would join. */
  const here: SimState = sim.before[active + 1] ?? sim.end;
  const levelHere = levelOf(here.xp);

  const lastPlace = useCallback(
    (lists: Step[][]): Place | undefined => {
      for (let s = lists.length - 1; s >= 0; s--) {
        for (let i = lists[s]!.length - 1; i >= 0; i--) {
          for (const line of lists[s]![i]!.lines) {
            const a = readAction(line);
            const id = a?.type === "goto" ? zoneByName.get(a.zone) : undefined;
            if (a?.type === "goto" && id !== undefined) return { zone: id, point: [a.x, a.y] };
          }
        }
      }
      return undefined;
    },
    [zoneByName],
  );

  /** Plan quests into a section: add them after what is there, or plan the whole section again. */
  const build = useCallback(
    async (mode: "append" | "replan", at = active, extra: number[] = []) => {
      if (!index) return;
      const target = project.sections[at]!;
      const ids = [...new Set([...(mode === "replan" ? acceptedIn(target.guide.steps) : []), ...project.wanted, ...extra])];
      if (!ids.length) return;
      setBusy("Planning the route…");
      try {
        const zoneIds = new Set(ids.map((id) => zoneOfQuest.get(id)).filter((z): z is number => z !== undefined));
        if (target.zone !== null) zoneIds.add(target.zone);
        const loaded = await Promise.all([...zoneIds].map(loadZone));
        const all = new Map(zones);
        for (const d of loaded) all.set(d.zone.id, d);
        setZones(all);
        await new Promise((r) => setTimeout(r, 30)); // let "Planning…" show
        const full = new Book(rows, index.zones, [...all.values()]);
        const before = allSteps.slice(0, mode === "append" ? at + 1 : at);
        const start = simulate(before, c, full).end;
        const viewZone = target.zone ?? zoneId ?? 0;
        const plan = planRoute({ quests: ids, book: full, character: c, state: start, from: lastPlace(before), viewZone, zoneNames });
        let steps = mode === "append" ? [...target.guide.steps, ...plan.steps] : plan.steps;
        const fresh = mode === "replan" || !target.guide.steps.length;
        if (fresh && at > 0 && plan.steps.length && target.zone !== null) {
          const name = zoneNames.get(target.zone) ?? "the next zone";
          const master = (all.get(target.zone)?.services.flight ?? []).map((id) => all.get(target.zone!)!.npcs[id]).find((n) => n && (!n.friendly || n.friendly.includes(c.faction)) && n.spawns[target.zone!]);
          const spot = master && bestSpot(points(master.spawns, target.zone));
          const travel: Step = spot
            ? { lines: [writeAction({ type: "goto", zone: name, x: spot[0], y: spot[1] }), { kind: "text", marker: ">>", text: `Travel to ${name}. Get the flight path from |cRXP_FRIENDLY_${master!.name}|r` }, writeAction({ type: "target", name: master!.name })] }
            : { lines: [{ kind: "text", marker: "+", text: `Travel to ${name}` }] };
          steps = [travel, ...steps];
        }
        const next = allSteps.map((s, i) => (i === at ? steps : s));
        dispatch({ type: "allSteps", steps: next, wanted: [] });
        const count = new Set(acceptedIn(plan.steps)).size;
        say(mode === "append" ? `Added ${count} ${count === 1 ? "quest" : "quests"} in ${plan.steps.length} steps.` : `Planned ${count} quests in ${plan.steps.length} steps.`);
      } catch (e) {
        say(e instanceof Error ? e.message : "Couldn't plan the route.");
      } finally {
        setBusy(null);
      }
    },
    [active, allSteps, c, dispatch, index, lastPlace, project.sections, project.wanted, rows, say, zoneId, zoneNames, zoneOfQuest, zones],
  );

  const toggleQuest = useCallback(
    (id: number) => {
      if (onRoute.has(id)) {
        dispatch({ type: "allSteps", steps: allSteps.map((steps) => removeQuest(steps, id, sameStep)) });
        say(`Took ${book.name(id)} off the route.`);
      } else if (wanted.has(id)) {
        // unticking also unticks what needed it
        const gone = new Set([id]);
        for (let changed = true; changed; ) {
          changed = false;
          for (const w of project.wanted) {
            if (!gone.has(w) && book.prerequisites(w, (m) => canTake(c, m)).some((p) => gone.has(p))) {
              gone.add(w);
              changed = true;
            }
          }
        }
        dispatch({ type: "wanted", wanted: project.wanted.filter((w) => !gone.has(w)) });
      } else {
        const first = book
          .prerequisites(id, (m) => canTake(c, m))
          .filter((p) => !onRoute.has(p) && !wanted.has(p) && !(c.level > 1 && (book.meta(p)?.level ?? 99) < c.level));
        dispatch({ type: "wanted", wanted: [...project.wanted, ...first, id] });
        if (first.length) say(`Also ticked ${first.length === 1 ? book.name(first[0]!) : `${first.length} quests`}, needed first.`);
      }
    },
    [allSteps, book, c, dispatch, onRoute, project.wanted, say, wanted],
  );

  const insert = useCallback(
    (built: Built) => {
      const at = selected === null ? guide.steps.length : selected + 1;
      const next = addStep(guide.steps, built, at);
      setSteps(next.steps, next.index);
    },
    [guide.steps, selected, setSteps],
  );

  const selectStep = useCallback(
    (i: number | null) => {
      dispatch({ type: "select", index: i });
      const goto = i === null ? undefined : summaries[i]?.goto;
      const id = goto && zoneByName.get(goto.zone);
      if (id && id !== zoneId) setZoneId(id);
    },
    [dispatch, summaries, zoneByName, zoneId],
  );

  const fix = useCallback(
    (p: Problem) => {
      if (!p.fix) return;
      const steps = allSteps[p.section]!;
      if (p.fix.type === "removeQuest") {
        const id = p.fix.questId;
        dispatch({ type: "allSteps", steps: allSteps.map((s) => removeQuest(s, id, sameStep)) });
      } else if (p.fix.type === "grind") {
        const level = p.fix.level;
        const step: Step = { lines: [{ kind: "text", marker: ">>", text: `Grind to level ${level}` }, writeAction({ type: "reachLevel", level })] };
        dispatch({ type: "steps", section: p.section, steps: [...steps.slice(0, p.step), step, ...steps.slice(p.step)], selected: null });
      } else {
        const id = p.fix.questId;
        const more = book.prerequisites(id, (m) => canTake(c, m)).filter((q) => !onRoute.has(q));
        void build("replan", p.section, [...more, id]);
      }
    },
    [allSteps, book, build, c, dispatch, onRoute],
  );

  // keyboard: undo, redo, delete, escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && (e.target as HTMLInputElement).type !== "checkbox";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Escape") setPlacing(false);
      else if ((e.key === "Delete" || e.key === "Backspace") && !typing && selected !== null && !dialog && !ask) {
        setSteps(guide.steps.filter((_, i) => i !== selected), null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, guide.steps, selected, setSteps, dialog, ask]);

  const pins = useMemo<Pin[]>(() => {
    if (!data || zoneId === null) return [];
    const out: Pin[] = [];
    const spot = (ids: number[] | undefined, from: ZoneData["npcs"] | ZoneData["objects"]) => {
      for (const id of ids ?? []) {
        const p = bestSpot(points(from[id]?.spawns, zoneId));
        if (p) return p;
      }
      return undefined;
    };
    const giver = (who: Quest["start"] | Quest["end"]) => spot(who?.npcs, data.npcs) ?? spot(who?.objects, data.objects);
    for (const q of data.quests) {
      if (!canTake(c, q) || q.id === quest || onRoute.has(q.id)) continue;
      const p = giver(q.start);
      if (p) out.push({ key: `a${q.id}`, point: p, kind: wanted.has(q.id) ? "start" : "available", label: `${q.name} (${q.level})`, onClick: () => setQuest(q.id) });
    }
    const open = data.quests.find((q) => q.id === quest);
    if (open) {
      const seen = new Set<string>();
      const dots = (spawns: Spawns | undefined, label: string) => {
        for (const p of points(spawns, zoneId).slice(0, 120)) {
          const key = `${p[0]},${p[1]}`;
          if (!seen.has(key)) out.push({ key: `o${key}`, point: p, kind: "objective", label });
          seen.add(key);
        }
      };
      for (const o of open.objectives ?? []) {
        if (o.type === "npc") dots(data.npcs[o.id!]?.spawns, data.npcs[o.id!]?.name ?? "");
        else if (o.type === "killCredit") for (const id of o.ids ?? []) dots(data.npcs[id]?.spawns, data.npcs[id]?.name ?? "");
        else if (o.type === "object") dots(data.objects[o.id!]?.spawns, data.objects[o.id!]?.name ?? "");
        else if (o.type === "event") dots(o.spawns, o.text ?? open.name);
        else if (o.type === "item") {
          const item = data.items[o.id!];
          for (const id of item?.npcs ?? []) dots(data.npcs[id]?.spawns, `${data.npcs[id]?.name} (drops ${item!.name})`);
          for (const id of item?.objects ?? []) dots(data.objects[id]?.spawns, `${data.objects[id]?.name} (holds ${item!.name})`);
        }
      }
      const s = giver(open.start);
      const e = giver(open.end);
      if (e) out.push({ key: "end", point: e, kind: "end", label: `Turn in: ${open.name}` });
      if (s) out.push({ key: "start", point: s, kind: "start", label: `Accept: ${open.name}` });
    }
    return out;
  }, [data, zoneId, c, quest, onRoute, wanted]);

  const stops = useMemo<RouteStop[]>(
    () =>
      zone
        ? summaries.flatMap((s, i) =>
            s.goto && s.goto.zone === zone.name ? [{ index: i, point: [s.goto.x, s.goto.y] as Point, label: `${i + 1}. ${s.title.replace(/\|c\w+?_([^|]*)\|r/g, "$1").replace(/\|[cr]\w*/g, "")}` }] : [],
          )
        : [],
    [summaries, zone],
  );

  if (error) {
    return (
      <div className="fatal">
        <h1>Couldn't load the quest data</h1>
        <p>{error}</p>
        <button className="primary" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!index || !rows.length) return <div className="fatal">Loading…</div>;

  const saveCharacter = (next: Character) => {
    const first = !project.ready;
    dispatch({ type: "character", character: next });
    setDialog(null);
    if (first || (!allSteps.some((s) => s.length) && project.sections.length === 1)) {
      const zoneFor = next.level <= 5 ? startZone(next, index) : suggestZones(book, next, next.level, new Set())[0]?.zone.id;
      if (zoneFor !== undefined) dispatch({ type: "sectionZone", index: 0, zone: zoneFor, name: zoneNames.get(zoneFor) });
    }
  };
  const start = levelParts(levelHere);
  const totalSteps = allSteps.reduce((n, s) => n + s.length, 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">XP</span>
          <span>
            OpenXP <b>Routes</b>
          </span>
        </div>
        <input className="route-name" value={project.name} onChange={(e) => dispatch({ type: "name", name: e.target.value })} aria-label="Route name" placeholder="Route name" spellCheck={false} />
        <button className={`character ${c.faction === "A" ? "alliance" : "horde"}`} onClick={() => setDialog("character")} title="Change the character this route is for">
          <Icon name="user" />
          <span>
            {c.race} {c.cls}
          </span>
          <em>starts at {c.level}</em>
          {c.hardcore && (
            <em className="hc">
              <Icon name="skull" size={13} /> Hardcore
            </em>
          )}
        </button>
        <div className="spacer" />
        <button className="ghost" onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="ghost" onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button
          onClick={() => {
            if (!totalSteps || confirm("Start a new, empty route? Undo brings this one back.")) {
              dispatch({ type: "load", project: newProject(c) });
              setDialog("character");
            }
          }}
        >
          New
        </button>
        <button onClick={() => setDialog("import")}>
          <Icon name="upload" /> Import
        </button>
        <button className="primary" onClick={() => setDialog("export")}>
          <Icon name="download" /> Export
        </button>
      </header>

      {zone ? (
        <QuestBoard
          index={index}
          rows={rows}
          zone={zone}
          data={data}
          book={book}
          character={c}
          level={levelHere}
          state={here}
          onRoute={onRoute}
          wanted={wanted}
          selectedQuest={quest}
          placing={placing}
          busy={busy !== null}
          sectionHasQuests={acceptedIn(guide.steps).length > 0}
          onZone={(id, q) => {
            setZoneId(id);
            setQuest(q ?? null);
            if (!guide.steps.length && q === undefined) {
              const name = guideTag(guide, "name") ?? "";
              const rename = /^Section \d+$/.test(name) || zoneByName.has(name);
              dispatch({ type: "sectionZone", index: active, zone: id, name: rename ? zoneNames.get(id) : undefined });
            }
          }}
          onSelectQuest={setQuest}
          onToggle={toggleQuest}
          onPick={() => {
            if (!data) return;
            const picked = pickQuests(data, c, here, book, onRoute);
            dispatch({ type: "wanted", wanted: [...new Set([...project.wanted, ...picked])] });
            say(picked.length ? `Ticked ${picked.length} quests that fit a level ${start.whole} ${c.cls}.` : "Nothing new here fits your level and choices.");
          }}
          onClear={() => dispatch({ type: "wanted", wanted: [] })}
          onBuild={() => void build("append")}
          onReplan={() => {
            if (confirm("Plan this section again from its quests? Steps you added by hand (notes, waypoints) are dropped. Undo brings them back.")) void build("replan");
          }}
          onAccept={(q) => data && insert(questGiverStep("accept", q, data, zoneNames, zone.id))}
          onTurnIn={(q) => data && insert(questGiverStep("turnin", q, data, zoneNames, zone.id))}
          onObjective={(q, i) => data && insert(objectiveStep(q, i, data, zoneNames, zone.id))}
          onService={(kind, id) => {
            const npc = data?.npcs[id];
            const point = npc && bestSpot(points(npc.spawns, zone.id));
            if (!npc || !point) return;
            setAsk({
              title: kind === "flight" ? "Get a flight path" : "Set your Hearthstone",
              label: kind === "flight" ? "Name of the flight path, as the game shows it" : "Name of the inn's town",
              initial: zone.name,
              onDone: (place) => insert(serviceStep(kind, npc.name, { zone: zone.id, point }, place, zoneNames)),
            });
          }}
          onPlacing={setPlacing}
          onNote={() => setAsk({ title: "Add a note", label: "What should the player know or do here?", initial: "", onDone: (note) => insert({ step: noteStep(note) }) })}
          onLevel={() =>
            setAsk({
              title: "Reach a level",
              label: "Grind until this level before going on",
              initial: String(Math.min(60, start.whole + 1)),
              onDone: (value) => {
                const level = Number.parseInt(value, 10);
                if (level > 1 && level <= 60) insert({ step: { lines: [{ kind: "text", marker: ">>", text: `Grind to level ${level}` }, writeAction({ type: "reachLevel", level })] } });
              },
            })
          }
        />
      ) : (
        <aside className="panel quests" />
      )}

      <main className="map-area">
        {zone && (
          <MapView
            zone={zone}
            pins={pins}
            stops={stops}
            selectedStop={selected}
            placing={placing}
            onSelectStop={selectStep}
            onPlace={(point) => {
              insert(waypointStep({ zone: zone.id, point }, zoneNames));
              setPlacing(false);
            }}
          />
        )}
        {busy && <div className="busy">{busy}</div>}
        {toast && !busy && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </main>

      <RoutePanel
        project={project}
        active={active}
        selected={selected}
        sim={sim}
        summaries={summaries}
        book={book}
        onRoute={onRoute}
        onActivate={(i) => dispatch({ type: "activate", index: i })}
        onAddSection={(zoneFor) => dispatch({ type: "addSection", zone: zoneFor, name: zoneFor === null ? `Section ${project.sections.length + 1}` : (zoneNames.get(zoneFor) ?? "Section") })}
        onRemoveSection={(i) => {
          if (!allSteps[i]!.length || confirm("Remove this section and its steps? Undo brings it back.")) dispatch({ type: "removeSection", index: i });
        }}
        onMoveSection={(from, to) => dispatch({ type: "moveSection", from, to })}
        onRenameSection={(i, name) => dispatch({ type: "sectionName", index: i, name })}
        onSelect={selectStep}
        onProblem={(p) => {
          if (p.section !== active) dispatch({ type: "activate", index: p.section });
          dispatch({ type: "select", index: p.step });
        }}
        onFix={fix}
        onMove={(from, to) => {
          const next = [...guide.steps];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved!);
          setSteps(next, to);
        }}
        onDelete={(i) => setSteps(guide.steps.filter((_, n) => n !== i), selected === null || selected === i ? null : selected > i ? selected - 1 : selected)}
        onText={(i, text) => {
          const step = guide.steps[i]!;
          const at = step.lines.findIndex((l) => l.kind === "text" && l.text);
          const lines = [...step.lines];
          if (at >= 0) lines[at] = { ...lines[at]!, text } as Step["lines"][number];
          else lines.push({ kind: "text", marker: ">>", text });
          const next = [...guide.steps];
          next[i] = sameStep({ ...step, lines }, step);
          setSteps(next);
        }}
      />

      {(dialog === "character" || !project.ready) && <CharacterDialog character={c} first={!project.ready} onSave={saveCharacter} onClose={project.ready ? () => setDialog(null) : undefined} />}
      {dialog === "export" && project.ready && <ExportDialog project={project} active={active} onClose={() => setDialog(null)} />}
      {dialog === "import" && project.ready && (
        <ImportDialog
          hasSteps={totalSteps > 0}
          character={c}
          zoneByName={zoneByName}
          onImport={(p) => dispatch({ type: "load", project: p })}
          onClose={() => setDialog(null)}
        />
      )}
      {ask && <PromptDialog request={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
