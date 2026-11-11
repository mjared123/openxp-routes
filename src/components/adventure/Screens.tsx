import { STYLES } from "../../character";
import type { DataIndex, GoalData } from "../../data";
import { ItemIcon, ItemTip } from "../Item";
import type { Progress } from "../../generate";
import { guideTag } from "../../guide";
import { questUse } from "../../route";
import type { Simulation } from "../../sim";
import type { Project } from "../../store";
import { Backdrop, CLASS_COLOURS, Flourish, Glyph } from "./art";

/** The front door. */
export function Home({ hasRoute, onBegin, onContinue, onImport }: { hasRoute: boolean; onBegin: () => void; onContinue: () => void; onImport: () => void }) {
  return (
    <div className="adv home">
      <Backdrop />
      <header className="adv-top">
        <div className="brand">
          <span className="logo">XP</span>
          <span>
            OpenXP <b>Routes</b>
          </span>
        </div>
        <span />
        <button type="button" className="adv-quiet" onClick={onImport}>
          Import a route
        </button>
      </header>
      <main className="hero">
        <p className="eyebrow rise">World of Warcraft: Forever</p>
        <h1 className="rise d1">
          Craft your <span className="gold">adventure</span>
        </h1>
        <p className="lead rise d2">Tell us how you want to level, the dungeons you want to run and the treasures you are after. We plan every step of the road, from your first quest to your last.</p>
        <div className="hero-actions rise d3">
          <button type="button" className="forge" onClick={onBegin}>
            <span>Begin a new adventure</span>
            <Glyph name="arrow" size={20} />
          </button>
          {hasRoute && (
            <button type="button" className="adv-ghost" onClick={onContinue}>
              Continue my route
            </button>
          )}
        </div>
        <ul className="promises rise d4">
          <li>
            <Glyph name="compass" size={26} />
            <b>A route made for you</b>
            <span>Your class, your pace, hardcore or not. Only quests you can take, in the right order.</span>
          </li>
          <li>
            <Glyph name="treasure" size={26} />
            <b>The rewards you want</b>
            <span>Pick a weapon, a dungeon or the new sleeping bag, and the route follows the chain to it.</span>
          </li>
          <li>
            <Glyph name="scroll" size={26} />
            <b>Ready for the addon</b>
            <span>Export guides for OpenXP and follow the arrow in game, step by step.</span>
          </li>
        </ul>
      </main>
    </div>
  );
}

/** Shown while the route is being generated. */
export function Forging({ progress, start, tone }: { progress: Progress | null; start: number; tone: "alliance" | "horde" }) {
  const level = progress?.level ?? start;
  const target = progress?.target ?? 60;
  const share = Math.min(1, Math.max(0.02, (level - start) / Math.max(1, target - start)));
  return (
    <div className="adv forging">
      <Backdrop tone={tone} />
      <main className="forging-stage">
        <div className="compass">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="ring" cx="60" cy="60" r="54" />
            <circle className="ring fill" cx="60" cy="60" r="54" style={{ strokeDashoffset: 339.3 * (1 - share) }} />
            <g className="needle">
              <path d="M60 18 68 60 60 102 52 60Z" />
              <path className="north" d="M60 18 68 60H52Z" />
            </g>
            <circle cx="60" cy="60" r="4" className="hub" />
          </svg>
          <div className="compass-level">
            <b>{Math.floor(level)}</b>
            <span>level</span>
          </div>
        </div>
        <h1>Charting your road</h1>
        <p className="doing" key={progress?.doing ?? "start"}>
          {progress?.doing ?? "Reading the quest log"}…
        </p>
        <div className="forge-bar">
          <span style={{ width: `${share * 100}%` }} />
        </div>
        <p className="adv-note center">
          {progress?.chapters ?? 0} {progress?.chapters === 1 ? "chapter" : "chapters"} written
        </p>
      </main>
    </div>
  );
}

interface JourneyProps {
  project: Project;
  sim: Simulation;
  index: DataIndex;
  goalData: GoalData;
  onOpen: (section: number) => void;
  onExport: () => void;
  onNew: () => void;
  onName: (name: string) => void;
}

/** The finished route as a story: chapters, levels, and what was asked for. */
export function Journey({ project, sim, index, goalData, onOpen, onExport, onNew, onName }: JourneyProps) {
  const c = project.character;
  const kinds = new Map(index.zones.map((z) => [z.id, z.kind]));
  const end = sim.sections[sim.sections.length - 1]?.end ?? c.level;
  const steps = project.sections.reduce((n, s) => n + s.guide.steps.length, 0);
  const quests = new Set(project.sections.flatMap((s) => [...questUse(s.guide.steps).keys()])).size;
  const errors = sim.problems.filter((p) => p.severity === "error").length;
  const report = project.report;
  const picked = [
    ...project.goals.items.map((id) => goalData.items.find((g) => g.id === id) ?? goalData.bossItems.find((g) => g.id === id)),
    ...project.goals.recipes.map((id) => goalData.recipes.find((g) => g.id === id)),
  ].filter((g) => g !== undefined);
  return (
    <div className="adv journey">
      <Backdrop tone={c.faction === "A" ? "alliance" : "horde"} />
      <header className="adv-top">
        <div className="brand">
          <span className="logo">XP</span>
          <span>
            OpenXP <b>Routes</b>
          </span>
        </div>
        <span />
        <button type="button" className="adv-quiet" onClick={onNew}>
          New adventure
        </button>
      </header>
      <main className="journey-stage">
        <section className="journey-head rise">
          <p className="eyebrow">Your adventure is ready</p>
          <input className="journey-name" value={project.name} onChange={(e) => onName(e.target.value)} aria-label="Route name" spellCheck={false} />
          <p className="lead">
            <b style={{ color: CLASS_COLOURS[c.cls] }}>
              {c.race} {c.cls}
            </b>{" "}
            · {STYLES[c.style].label}
            {c.hardcore ? " · Hardcore" : ""}
          </p>
          <Flourish />
          <ul className="stats">
            <li>
              <b>
                {c.level} <i>to</i> {Math.floor(end + 1e-9)}
              </b>
              <span>levels</span>
            </li>
            <li>
              <b>{project.sections.length}</b>
              <span>chapters</span>
            </li>
            <li>
              <b>{quests.toLocaleString()}</b>
              <span>quests</span>
            </li>
            <li>
              <b>{steps.toLocaleString()}</b>
              <span>steps</span>
            </li>
          </ul>
          <div className="hero-actions">
            <button type="button" className="forge" onClick={onExport}>
              <Glyph name="download" size={20} />
              <span>Export for OpenXP</span>
            </button>
            <button type="button" className="adv-ghost" onClick={() => onOpen(0)}>
              <Glyph name="pen" size={18} /> Fine-tune the steps
            </button>
          </div>
          {errors > 0 && (
            <p className="adv-note center warn">
              {errors} {errors === 1 ? "step needs" : "steps need"} a look. Open the route to see and fix {errors === 1 ? "it" : "them"}.
            </p>
          )}
        </section>

        {report && (report.included.length > 0 || report.missed.length > 0) && (
          <section className="wishes rise d1">
            <h2>What you asked for</h2>
            {picked.length > 0 && (
              <div className="wish-items">
                {picked.map((g) => (
                  <ItemTip key={g.id} id={g.id} name={g.name} className="wish-item">
                    <ItemIcon id={g.id} size={38} />
                    <b>{g.name}</b>
                  </ItemTip>
                ))}
              </div>
            )}
            <ul>
              {report.included.map((w) => (
                <li key={w} className="yes">
                  <Glyph name="check" size={16} /> {w}
                </li>
              ))}
              {report.missed.map((w) => (
                <li key={w} className="no">
                  <span className="cross">×</span> {w}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="chapters rise d2">
          <h2>The road</h2>
          <ol>
            {project.sections.map((s, i) => {
              const lv = sim.sections[i];
              const name = (guideTag(s.guide, "name") ?? `Chapter ${i + 1}`).replace(/\s\d+-\d+$/, "");
              const kind = s.zone !== null ? kinds.get(s.zone) : undefined;
              const count = new Set(questUse(s.guide.steps).keys()).size;
              return (
                <li key={i} style={{ animationDelay: `${Math.min(i, 24) * 40}ms` }}>
                  <button type="button" className="chapter" onClick={() => onOpen(i)} title="Open this chapter">
                    <span className={`chapter-mark${kind === "dungeon" ? " dungeon" : ""}`}>{kind === "dungeon" ? <Glyph name="dungeon" size={18} /> : i + 1}</span>
                    <span className="chapter-text">
                      <b>{name}</b>
                      <span>
                        {kind === "dungeon" ? "Dungeon · " : ""}
                        {count} {count === 1 ? "quest" : "quests"} · {s.guide.steps.length} steps
                      </span>
                    </span>
                    <span className="chapter-levels">
                      {lv ? (
                        <>
                          <b>{Math.floor(lv.start + 1e-9)}</b>
                          <Glyph name="arrow" size={14} />
                          <b>{Math.floor(lv.end + 1e-9)}</b>
                        </>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
        <p className="adv-note center">Levels are estimates from quest XP and the mobs your objectives make you kill. Quest data from Questie.</p>
      </main>
    </div>
  );
}
