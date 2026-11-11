import { useState } from "react";
import { CLASSES, RACES, STYLES, type Character, type Style } from "../character";
import { Dialog } from "./Dialogs";
import { Icon } from "./Icon";

interface Props {
  character: Character;
  /** The first visit: there is nothing to go back to. */
  first: boolean;
  onSave: (character: Character) => void;
  onClose?: () => void;
}

export function CharacterDialog({ character, first, onSave, onClose }: Props) {
  const [c, setC] = useState(character);
  const set = (change: Partial<Character>) => setC((prev) => ({ ...prev, ...change }));

  return (
    <Dialog title={first ? "Who is this route for?" : "Character and play style"} onClose={onClose} wide>
      {first && <p className="lead">Tell the builder about your character. It uses this to show only quests you can take, work out your level along the way, and warn you before something goes wrong.</p>}

      <div className="form-row">
        <span className="form-label">Faction</span>
        <div className="segmented" role="group" aria-label="Faction">
          {(["A", "H"] as const).map((f) => (
            <button key={f} className={c.faction === f ? `on ${f === "A" ? "alliance" : "horde"}` : ""} onClick={() => set({ faction: f, race: RACES[f].includes(c.race) ? c.race : RACES[f][0]! })}>
              {f === "A" ? "Alliance" : "Horde"}
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <span className="form-label">Race</span>
        <div className="chips" role="group" aria-label="Race">
          {RACES[c.faction].map((r) => (
            <button key={r} className={c.race === r ? "on" : ""} onClick={() => set({ race: r })}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <span className="form-label">Class</span>
        <div className="chips" role="group" aria-label="Class">
          {CLASSES.map((k) => (
            <button key={k} className={c.cls === k ? `on class-${k.toLowerCase()}` : ""} onClick={() => set({ cls: k })}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="start-level">
          Starting level
        </label>
        <div className="inline">
          <input id="start-level" type="number" min={1} max={59} value={c.level} onChange={(e) => set({ level: Math.min(59, Math.max(1, Number.parseInt(e.target.value, 10) || 1)) })} />
          <span className="hint">The level you are when the route begins. Quests below it count as already done.</span>
        </div>
      </div>

      <div className="form-row">
        <span className="form-label">Mode</span>
        <div className="cards two">
          <button className={c.hardcore ? "" : "on"} onClick={() => set({ hardcore: false })}>
            <b>Normal</b>
            <span>Dying costs a walk back. Quests up to four levels above you are fine.</span>
          </button>
          <button className={c.hardcore ? "on danger" : ""} onClick={() => set({ hardcore: true })}>
            <b>
              <Icon name="skull" size={14} /> Hardcore
            </b>
            <span>One life. The builder keeps quests closer to your level and warns about risky ones.</span>
          </button>
        </div>
      </div>

      <div className="form-row">
        <span className="form-label">Play style</span>
        <div className="cards">
          {(Object.keys(STYLES) as Style[]).map((s) => (
            <button key={s} className={c.style === s ? "on" : ""} onClick={() => set({ style: s })}>
              <b>{STYLES[s].label}</b>
              <span>{STYLES[s].about}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-row">
        <span className="form-label">Also pick</span>
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={c.groups} onChange={(e) => set({ groups: e.target.checked })} /> Elite quests that need a group
          </label>
          <label className="check">
            <input type="checkbox" checked={c.dungeons} onChange={(e) => set({ dungeons: e.target.checked })} /> Dungeon quests
          </label>
          <span className="hint">These only change what "Pick for me" ticks. You can always tick any quest yourself.</span>
        </div>
      </div>

      <footer>
        {onClose && <button onClick={onClose}>Cancel</button>}
        <button className="primary" onClick={() => onSave(c)}>
          {first ? "Start building" : "Save"}
        </button>
      </footer>
    </Dialog>
  );
}
