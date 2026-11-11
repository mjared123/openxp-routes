import { useState } from "react";
import type { Step } from "../guide";
import { keyOf, type StepSummary } from "../route";
import type { SimStep } from "../sim";
import { GameText } from "./GameText";
import { Icon } from "./Icon";

interface Props {
  steps: Step[];
  summaries: StepSummary[];
  selected: number | null;
  /** Level and problems per step. */
  sim?: SimStep[];
  /** Level before the first step. */
  startLevel: number;
  questName: (id: number) => string;
  onSelect: (index: number | null) => void;
  onMove: (from: number, to: number) => void;
  onDelete: (index: number) => void;
  onText: (index: number, text: string) => void;
}

const KIND: Record<StepSummary["kind"], { glyph: string; label: string }> = {
  accept: { glyph: "!", label: "Accept" },
  turnin: { glyph: "?", label: "Turn in" },
  complete: { glyph: "⚔", label: "Objective" },
  travel: { glyph: "➤", label: "Travel" },
  level: { glyph: "★", label: "Level" },
  note: { glyph: "✎", label: "Note" },
};

function actionLabel(a: StepSummary["actions"][number], questName: (id: number) => string): string {
  if (a.text) return a.text;
  switch (a.action.type) {
    case "accept":
      return `Accept ${questName(a.action.questId)}`;
    case "turnin":
      return `Turn in ${questName(a.action.questId)}`;
    case "complete":
      return `For ${questName(a.action.questId)}`;
    case "flightPath":
      return `Get the ${a.action.place} flight path`;
    case "fly":
      return `Fly to ${a.action.place}`;
    case "setHearth":
      return `Set Hearthstone to ${a.action.place}`;
    case "hearth":
      return `Hearth to ${a.action.place}`;
    case "reachLevel":
      return `Reach level ${a.action.level}`;
    default:
      return "";
  }
}

export function StepList({ steps, summaries, selected, sim, startLevel, questName, onSelect, onMove, onDelete, onText }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  if (!steps.length) {
    return (
      <div className="empty-route">
        <div className="empty-art">!</div>
        <h3>Your route is empty</h3>
        <p>Tick quests on the left (or press "Pick quests for me"), then press Build route. The planner turns them into ordered steps here and on the map.</p>
      </div>
    );
  }

  return (
    <ol className="steps">
      {steps.map((step, i) => {
        const s = summaries[i]!;
        const isSelected = i === selected;
        const after = sim?.[i];
        const before = i === 0 ? startLevel : (sim?.[i - 1]?.level ?? startLevel);
        const ding = after && Math.floor(after.level + 1e-9) > Math.floor(before + 1e-9) ? Math.floor(after.level + 1e-9) : null;
        const worst = after?.problems.some((x) => x.severity === "error") ? "error" : after?.problems.some((x) => x.severity === "warn") ? "warn" : null;
        const lines = s.actions.map((a) => actionLabel(a, questName)).filter((l) => l && l !== s.title);
        return (
          <li
            key={keyOf(step)}
            className={`step kind-${s.kind}${worst ? ` has-${worst}` : ""}${isSelected ? " selected" : ""}${drag === i ? " dragging" : ""}${over === i && drag !== null && drag !== i ? (drag < i ? " drop-after" : " drop-before") : ""}`}
            draggable={editing !== i}
            onDragStart={(e) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragOver={(e) => {
              if (drag === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null && drag !== i) onMove(drag, i);
              setDrag(null);
              setOver(null);
            }}
            onClick={() => onSelect(isSelected ? null : i)}
          >
            <span className="grip" title="Drag to reorder">
              <Icon name="grip" size={14} />
            </span>
            <span className="num">{i + 1}</span>
            <span className={`badge badge-${s.kind}`} title={KIND[s.kind].label}>
              {KIND[s.kind].glyph}
            </span>
            <div className="body">
              {editing === i ? (
                <input
                  autoFocus
                  defaultValue={s.title}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== s.title) onText(i, e.target.value.trim());
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <div className="title" onDoubleClick={() => setEditing(i)} title="Double-click to edit">
                  <GameText text={s.title} />
                </div>
              )}
              {lines.map((l, n) => (
                <div key={n} className="line">
                  <GameText text={l} />
                </div>
              ))}
              {s.other.map((l, n) => (
                <code key={n} className="raw">
                  {l}
                </code>
              ))}
              <div className="where">
                {s.goto && (
                  <span>
                    {s.goto.zone} {s.goto.x.toFixed(1)}, {s.goto.y.toFixed(1)}
                  </span>
                )}
                {s.condition && <span className="cond">{s.condition}</span>}
                {after && after.xp > 0 && <span className="gain">+{Math.round(after.xp).toLocaleString()} XP</span>}
                {ding && <span className="ding">Level {ding}</span>}
              </div>
              {after?.problems
                .filter((x) => x.severity !== "info")
                .map((x, n) => (
                  <div key={n} className={`step-problem ${x.severity}`}>
                    {x.text}
                  </div>
                ))}
            </div>
            <button
              className="ghost del"
              title="Remove step"
              aria-label={`Remove step ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(i);
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
