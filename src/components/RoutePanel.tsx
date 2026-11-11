import { useMemo, useState } from "react";
import type { Book } from "../book";
import { guideTag } from "../guide";
import { suggestZones } from "../planner";
import type { StepSummary } from "../route";
import { levelParts, type Problem, type Simulation } from "../sim";
import type { Project } from "../store";
import { Icon } from "./Icon";
import { StepList } from "./StepList";

interface Props {
  project: Project;
  active: number;
  selected: number | null;
  sim: Simulation;
  summaries: StepSummary[];
  book: Book;
  onRoute: Set<number>;
  onActivate: (index: number) => void;
  onAddSection: (zone: number | null) => void;
  onRemoveSection: (index: number) => void;
  onMoveSection: (from: number, to: number) => void;
  onRenameSection: (index: number, name: string) => void;
  onSelect: (index: number | null) => void;
  onProblem: (problem: Problem) => void;
  onFix: (problem: Problem) => void;
  onMove: (from: number, to: number) => void;
  onDelete: (index: number) => void;
  onText: (index: number, text: string) => void;
}

const FIX_LABEL = { addQuest: "Add it and re-plan", grind: "Add grinding", removeQuest: "Remove quest" } as const;
const ORDER = { error: 0, warn: 1, info: 2 } as const;

function levelText(level: number): string {
  const { whole, percent } = levelParts(level);
  return percent ? `${whole} (${percent}%)` : String(whole);
}

export function RoutePanel(p: Props) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [problemsOpen, setShowProblems] = useState<boolean | null>(null);
  const c = p.project.character;
  const sections = p.project.sections;
  const steps = sections[p.active]!.guide.steps;
  const levels = p.sim.sections[p.active] ?? { start: c.level, end: c.level, questXp: 0, killXp: 0 };
  const end = p.sim.sections[sections.length - 1]?.end ?? c.level;

  const problems = useMemo(() => [...p.sim.problems].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.section - b.section || a.step - b.step), [p.sim.problems]);
  const errors = problems.filter((x) => x.severity === "error").length;
  const warns = problems.filter((x) => x.severity === "warn").length;
  // notes alone stay folded until asked for
  const showProblems = problemsOpen ?? errors + warns > 0;
  const perSection = (i: number) => p.sim.problems.filter((x) => x.section === i && x.severity === "error").length;

  const suggestions = useMemo(() => {
    const used = new Set(sections.map((s) => s.zone).filter((z): z is number => z !== null));
    return suggestZones(p.book, c, end, used, p.onRoute, c.dungeons, sections[sections.length - 1]?.zone ?? undefined);
  }, [sections, p.book, c, end, p.onRoute]);

  const total = levels.questXp + levels.killXp;

  return (
    <aside className="panel route">
      <div className="panel-head">
        <div className="row">
          <h2>Route</h2>
          <span className="count">
            level {c.level} to {levelText(end)}
          </span>
        </div>
        <ol className="sections">
          {sections.map((s, i) => {
            const name = guideTag(s.guide, "name") || `Section ${i + 1}`;
            const lv = p.sim.sections[i];
            const bad = perSection(i);
            return (
              <li key={i} className={i === p.active ? "active" : ""}>
                <button className="section" onClick={() => p.onActivate(i)} onDoubleClick={() => setRenaming(i)} title="Double-click to rename">
                  <span className="section-num">{i + 1}</span>
                  {renaming === i ? (
                    <input
                      autoFocus
                      defaultValue={name}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value.trim() !== name) p.onRenameSection(i, e.target.value.trim());
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <span className="section-name">{name}</span>
                  )}
                  {bad > 0 && (
                    <span className="section-bad" title={`${bad} ${bad === 1 ? "problem" : "problems"} to fix`}>
                      {bad}
                    </span>
                  )}
                  <span className="section-levels">{lv && s.guide.steps.length ? `${Math.floor(lv.start + 1e-9)} → ${Math.floor(lv.end + 1e-9)}` : "empty"}</span>
                </button>
                {i === p.active && sections.length > 1 && (
                  <span className="section-tools">
                    <button className="ghost" disabled={i === 0} onClick={() => p.onMoveSection(i, i - 1)} title="Move earlier" aria-label="Move section earlier">
                      ↑
                    </button>
                    <button className="ghost" disabled={i === sections.length - 1} onClick={() => p.onMoveSection(i, i + 1)} title="Move later" aria-label="Move section later">
                      ↓
                    </button>
                    <button className="ghost" onClick={() => p.onRemoveSection(i)} title="Remove section" aria-label="Remove section">
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <button className={`add wide add-section${adding ? " active" : ""}`} onClick={() => setAdding(!adding)}>
          <Icon name="plus" /> Add a section{adding ? "" : `: where next at level ${Math.floor(end + 1e-9)}?`}
        </button>
        {adding && (
          <div className="suggest">
            {suggestions.map(({ zone: z, quests, xp }) => (
              <button
                key={z.id}
                onClick={() => {
                  p.onAddSection(z.id);
                  setAdding(false);
                }}
              >
                <b>{z.name}</b>
                <span>
                  {z.kind === "dungeon" ? "Dungeon · " : ""}
                  {quests} quests for you now · {Math.round(xp / 1000)}k XP
                </span>
              </button>
            ))}
            {!suggestions.length && <p className="empty small">No zone starts around level {Math.floor(end)}. Add an empty section and choose its zone on the left.</p>}
            <button
              onClick={() => {
                p.onAddSection(null);
                setAdding(false);
              }}
            >
              <b>Empty section</b>
              <span>Choose the zone yourself</span>
            </button>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div className="level-track" title="Estimated from quest rewards and the mobs the objectives make you kill">
          <div className="level-line">
            <b>Level {levelText(levels.start)}</b>
            <span className="bar">
              <span style={{ width: `${Math.min(100, Math.max(4, (levels.end - Math.floor(levels.end + 1e-9)) * 100))}%` }} />
            </span>
            <b>{levelText(levels.end)}</b>
          </div>
          <small>
            {Math.round(total).toLocaleString()} XP in this section: {total ? Math.round((levels.questXp / total) * 100) : 0}% from quests, the rest from kills. An estimate.
          </small>
        </div>
      )}

      {problems.length > 0 && (
        <div className={`problems${errors ? " has-error" : ""}`}>
          <button className="problems-head" onClick={() => setShowProblems(!showProblems)} aria-expanded={showProblems}>
            <Icon name={errors ? "alert" : "info"} />
            <b>{errors ? `${errors} ${errors === 1 ? "problem" : "problems"} to fix` : warns ? `${warns} ${warns === 1 ? "warning" : "warnings"}` : `${problems.length} ${problems.length === 1 ? "note" : "notes"}`}</b>
            {errors > 0 && warns > 0 && <span>and {warns} {warns === 1 ? "warning" : "warnings"}</span>}
            <span className="spacer" />
            <span className={`chev${showProblems ? " open" : ""}`}>
              <Icon name="chevron" size={14} />
            </span>
          </button>
          {showProblems && (
            <ul>
              {problems.slice(0, 40).map((x, n) => (
                <li key={n} className={x.severity}>
                  <button className="problem" onClick={() => p.onProblem(x)} title="Show the step">
                    <span className="problem-where">
                      {sections.length > 1 ? `${x.section + 1}.` : ""}
                      {x.step + 1}
                    </span>
                    {x.text}
                  </button>
                  {x.fix && (
                    <button className="fix" onClick={() => p.onFix(x)}>
                      {FIX_LABEL[x.fix.type]}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="scroll">
        <StepList
          steps={steps}
          summaries={p.summaries}
          selected={p.selected}
          sim={p.sim.steps[p.active]}
          startLevel={levels.start}
          questName={(id) => p.book.name(id)}
          onSelect={p.onSelect}
          onMove={p.onMove}
          onDelete={p.onDelete}
          onText={p.onText}
        />
      </div>
      <p className="foot">
        {steps.length} {steps.length === 1 ? "step" : "steps"}. {p.selected === null ? "Steps added by hand go at the end." : `Steps added by hand go after step ${p.selected + 1}.`} Drag to reorder.
      </p>
    </aside>
  );
}
