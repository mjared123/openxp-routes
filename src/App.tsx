import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportDialog, ImportDialog } from "./components/Dialogs";
import { Icon } from "./components/Icon";
import { MapView, type Pin, type RouteStop } from "./components/MapView";
import { QuestPanel } from "./components/QuestPanel";
import { StepList } from "./components/StepList";
import { bestSpot, forFaction, loadIndex, loadQuestRows, loadZone, type DataIndex, type Point, type Quest, type QuestRow, type Spawns, type ZoneData } from "./data";
import { serializeLine, type Step } from "./guide";
import { addStep, newGuide, noteStep, objectiveStep, questGiverStep, questUse, sameStep, serviceStep, summarize, waypointStep, type Built, type ZoneNames } from "./route";
import { useRoute } from "./store";

const ZONE_KEY = "openxp-routes:zone";
const START_ZONE: Record<"A" | "H", number> = { A: 12, H: 14 }; // Elwynn Forest, Durotar

function points(spawns: Spawns | undefined, zone: number): Point[] {
  return spawns?.[zone] ?? [];
}

export function App() {
  const { state, dispatch, name, faction, setSteps } = useRoute();
  const { guide, selected } = state;
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [rows, setRows] = useState<QuestRow[]>([]);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [data, setData] = useState<ZoneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quest, setQuest] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [dialog, setDialog] = useState<"export" | "import" | null>(null);

  useEffect(() => {
    loadIndex()
      .then((ix) => {
        setIndex(ix);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(ZONE_KEY);
        } catch {
          // storage blocked: use the starting zone
        }
        setZoneId(saved !== null && ix.zones.some((z) => z.id === Number(saved)) ? Number(saved) : START_ZONE[faction]);
      })
      .catch((e: Error) => setError(e.message));
    loadQuestRows().then(setRows, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (zoneId === null) return;
    let stale = false;
    setData(null);
    loadZone(zoneId).then(
      (d) => !stale && setData(d),
      (e: Error) => !stale && setError(e.message),
    );
    try {
      localStorage.setItem(ZONE_KEY, String(zoneId));
    } catch {
      // not remembered, that's all
    }
    return () => {
      stale = true;
    };
  }, [zoneId]);

  const zoneNames: ZoneNames = useMemo(() => new Map(index?.zones.map((z) => [z.id, z.name])), [index]);
  const zoneByName = useMemo(() => new Map(index?.zones.map((z) => [z.name, z.id])), [index]);
  const zone = index?.zones.find((z) => z.id === zoneId) ?? null;
  const summaries = useMemo(() => guide.steps.map((s) => summarize(s, serializeLine)), [guide.steps]);
  const use = useMemo(() => questUse(guide.steps), [guide.steps]);
  const questNames = useMemo(() => new Map(rows.map((r) => [r[0], r[1]])), [rows]);

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

  // keyboard: undo, redo, delete, escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Escape") setPlacing(false);
      else if ((e.key === "Delete" || e.key === "Backspace") && !typing && selected !== null && !dialog) {
        setSteps(guide.steps.filter((_, i) => i !== selected), null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, guide.steps, selected, setSteps, dialog]);

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
      if (!forFaction(q.side, faction) || q.id === quest || use.get(q.id)?.has("accept")) continue;
      const p = giver(q.start);
      if (p) out.push({ key: `a${q.id}`, point: p, kind: "available", label: `${q.name} (${q.level})`, onClick: () => setQuest(q.id) });
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
  }, [data, zoneId, faction, quest, use]);

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
  if (!index || !zone) return <div className="fatal">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">XP</span>
          <span>
            OpenXP <b>Routes</b>
          </span>
        </div>
        <input className="route-name" value={name} onChange={(e) => dispatch({ type: "name", name: e.target.value })} aria-label="Route name" placeholder="Route name" spellCheck={false} />
        <div className="segmented" role="group" aria-label="Faction">
          <button className={faction === "A" ? "on alliance" : ""} onClick={() => dispatch({ type: "faction", faction: "A" })}>
            Alliance
          </button>
          <button className={faction === "H" ? "on horde" : ""} onClick={() => dispatch({ type: "faction", faction: "H" })}>
            Horde
          </button>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="ghost" onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button
          onClick={() => {
            if (!guide.steps.length || confirm("Start a new, empty route? Undo brings this one back.")) dispatch({ type: "load", guide: newGuide("My route", faction) });
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

      <QuestPanel
        index={index}
        rows={rows}
        zone={zone}
        data={data}
        faction={faction}
        use={use}
        selectedQuest={quest}
        placing={placing}
        onZone={(id, q) => {
          setZoneId(id);
          setQuest(q ?? null);
        }}
        onSelectQuest={setQuest}
        onAccept={(q) => data && insert(questGiverStep("accept", q, data, zoneNames, zone.id))}
        onTurnIn={(q) => data && insert(questGiverStep("turnin", q, data, zoneNames, zone.id))}
        onObjective={(q, i) => data && insert(objectiveStep(q, i, data, zoneNames, zone.id))}
        onService={(kind, id) => {
          const npc = data?.npcs[id];
          const point = npc && bestSpot(points(npc.spawns, zone.id));
          if (!npc || !point) return;
          const place = prompt(kind === "flight" ? "Name of this flight path (as the game shows it):" : "Name of this inn's town:", zone.name);
          if (place) insert(serviceStep(kind, npc.name, { zone: zone.id, point }, place.trim(), zoneNames));
        }}
        onPlacing={setPlacing}
        onNote={() => {
          const note = prompt("Note for this step:");
          if (note?.trim()) insert({ step: noteStep(note.trim()) });
        }}
      />

      <main className="map-area">
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
      </main>

      <aside className="panel route">
        <div className="panel-head row">
          <h2>Route</h2>
          <span className="count">
            {guide.steps.length} {guide.steps.length === 1 ? "step" : "steps"}
          </span>
        </div>
        <div className="scroll">
          <StepList
            steps={guide.steps}
            summaries={summaries}
            selected={selected}
            questName={(id) => questNames.get(id) ?? `quest ${id}`}
            onSelect={selectStep}
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
        </div>
        <p className="foot">
          {selected === null ? "New steps are added at the end." : `New steps are added after step ${selected + 1}.`} Drag to reorder.
        </p>
      </aside>

      {dialog === "export" && <ExportDialog guide={guide} name={name} onClose={() => setDialog(null)} />}
      {dialog === "import" && <ImportDialog hasSteps={guide.steps.length > 0} onImport={(g) => dispatch({ type: "load", guide: g })} onClose={() => setDialog(null)} />}
    </div>
  );
}
