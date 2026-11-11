import { useMemo, useState } from "react";
import { forFaction, type DataIndex, type Faction, type Quest, type QuestRow, type ZoneData, type ZoneInfo } from "../data";
import { objectiveLabel } from "../route";
import { Icon } from "./Icon";

type Use = Map<number, Set<"accept" | "turnin" | "complete">>;

interface Props {
  index: DataIndex;
  rows: QuestRow[];
  zone: ZoneInfo;
  data: ZoneData | null;
  faction: Faction;
  use: Use;
  selectedQuest: number | null;
  placing: boolean;
  onZone: (id: number, quest?: number) => void;
  onSelectQuest: (id: number | null) => void;
  onAccept: (quest: Quest) => void;
  onTurnIn: (quest: Quest) => void;
  onObjective: (quest: Quest, index: number) => void;
  onService: (kind: "flight" | "inn", npcId: number) => void;
  onPlacing: (on: boolean) => void;
  onNote: () => void;
}

const KIND_LABEL: Record<ZoneInfo["kind"], string> = { zone: "Zones", dungeon: "Dungeons and raids", area: "Other places", other: "Other places" };

function levels(zone: ZoneInfo): string {
  if (!zone.levels) return "";
  return zone.levels[0] === zone.levels[1] ? ` (${zone.levels[0]})` : ` (${zone.levels[0]}-${zone.levels[1]})`;
}

function QuestState({ use }: { use?: Set<string> }) {
  if (!use) return null;
  const done = use.has("accept") && use.has("turnin");
  return (
    <span className={`quest-state${done ? " done" : ""}`} title={done ? "Accepted and turned in on your route" : "Partly on your route"}>
      <Icon name="check" size={13} />
    </span>
  );
}

export function QuestPanel(p: Props) {
  const [tab, setTab] = useState<"quests" | "travel">("quests");
  const [query, setQuery] = useState("");
  const [hideUsed, setHideUsed] = useState(false);
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const out = new Map<string, ZoneInfo[]>();
    for (const z of p.index.zones) {
      if (!z.quests[p.faction]) continue;
      const label = KIND_LABEL[z.kind];
      out.set(label, [...(out.get(label) ?? []), z]);
    }
    return [...out.entries()];
  }, [p.index, p.faction]);

  const quests = useMemo(
    () =>
      (p.data?.quests ?? []).filter(
        (quest) =>
          forFaction(quest.side, p.faction) &&
          (!q || quest.name.toLowerCase().includes(q)) &&
          (!hideUsed || !(p.use.get(quest.id)?.has("accept") && p.use.get(quest.id)?.has("turnin"))),
      ),
    [p.data, p.faction, p.use, q, hideUsed],
  );

  const elsewhere = useMemo(() => {
    if (q.length < 2) return [];
    const zoneNames = new Map(p.index.zones.map((z) => [z.id, z.name]));
    return p.rows
      .filter((r) => r[5] !== p.zone.id && forFaction(r[4], p.faction) && r[1].toLowerCase().includes(q))
      .slice(0, 30)
      .map((r) => ({ id: r[0], name: r[1], level: r[2], zone: r[5], zoneName: zoneNames.get(r[5]) ?? "Elsewhere" }));
  }, [q, p.rows, p.zone.id, p.faction, p.index]);

  const services = (kind: "flight" | "inn") =>
    (p.data?.services[kind] ?? [])
      .map((id) => ({ id, npc: p.data!.npcs[id] }))
      .filter((s) => s.npc && (!s.npc.friendly || s.npc.friendly.includes(p.faction)) && s.npc.spawns[p.zone.id]);

  return (
    <aside className="panel quests">
      <div className="panel-head">
        <label className="field">
          <span>Zone</span>
          <select value={p.zone.id} onChange={(e) => p.onZone(Number(e.target.value))}>
            {groups.map(([label, zones]) => (
              <optgroup key={label} label={label}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                    {levels(z)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "quests"} onClick={() => setTab("quests")}>
            Quests <em>{quests.length}</em>
          </button>
          <button role="tab" aria-selected={tab === "travel"} onClick={() => setTab("travel")}>
            Travel and notes
          </button>
        </div>
      </div>

      {tab === "quests" ? (
        <>
          <div className="search">
            <Icon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search quests" aria-label="Search quests" />
            {query && (
              <button className="ghost" onClick={() => setQuery("")} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={hideUsed} onChange={(e) => setHideUsed(e.target.checked)} /> Hide quests already on the route
          </label>
          <div className="scroll">
            {!p.data && <p className="empty">Loading {p.zone.name}…</p>}
            {p.data && !quests.length && <p className="empty">{q ? "No quests here match that." : "No quests here for this faction."}</p>}
            <ul className="quest-list">
              {quests.map((quest) => {
                const open = quest.id === p.selectedQuest;
                const use = p.use.get(quest.id);
                return (
                  <li key={quest.id} className={open ? "open" : ""}>
                    <button className="quest-row" onClick={() => p.onSelectQuest(open ? null : quest.id)} aria-expanded={open}>
                      <span className="lvl">{quest.level > 0 ? quest.level : "–"}</span>
                      <span className="name">{quest.name}</span>
                      {quest.classes && <span className="tag">{quest.classes.length === 1 ? quest.classes[0] : "Class"}</span>}
                      <QuestState use={use} />
                    </button>
                    {open && p.data && (
                      <div className="quest-detail">
                        {quest.text && <p>{quest.text}</p>}
                        <p className="meta">
                          Requires level {quest.minLevel}
                          {quest.xp ? ` · ${quest.xp.toLocaleString()} XP` : ""}
                          {quest.races ? ` · ${quest.races.join(", ")}` : ""}
                          {quest.classes ? ` · ${quest.classes.join(", ")}` : ""}
                        </p>
                        {(quest.preAll ?? quest.preAny) && (
                          <p className="meta">
                            Follows{" "}
                            {(quest.preAll ?? quest.preAny)!
                              .map((id) => p.rows.find((r) => r[0] === id)?.[1] ?? `quest ${id}`)
                              .join(quest.preAll ? " and " : " or ")}
                          </p>
                        )}
                        <div className="actions">
                          <button className={`add accept${use?.has("accept") ? " used" : ""}`} onClick={() => p.onAccept(quest)}>
                            <b>!</b> Accept
                          </button>
                          {(quest.objectives ?? []).map((o, i) =>
                            o.type === "reputation" ? null : (
                              <button key={i} className="add objective" onClick={() => p.onObjective(quest, i)}>
                                <Icon name="plus" size={13} /> {objectiveLabel(quest, i, p.data!)}
                              </button>
                            ),
                          )}
                          <button className={`add turnin${use?.has("turnin") ? " used" : ""}`} onClick={() => p.onTurnIn(quest)}>
                            <b>?</b> Turn in
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {elsewhere.length > 0 && (
              <>
                <h4>In other zones</h4>
                <ul className="quest-list">
                  {elsewhere.map((r) => (
                    <li key={r.id}>
                      <button className="quest-row" onClick={() => p.onZone(r.zone, r.id)}>
                        <span className="lvl">{r.level > 0 ? r.level : "–"}</span>
                        <span className="name">{r.name}</span>
                        <span className="tag">{r.zoneName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="scroll travel">
          <h4>Anywhere</h4>
          <button className={`add wide${p.placing ? " active" : ""}`} onClick={() => p.onPlacing(!p.placing)}>
            <Icon name="pin" /> {p.placing ? "Click the map… (cancel)" : "Add a waypoint on the map"}
          </button>
          <button className="add wide" onClick={p.onNote}>
            <Icon name="note" /> Add a note
          </button>
          {(["flight", "inn"] as const).map((kind) => {
            const list = services(kind);
            return (
              <div key={kind}>
                <h4>{kind === "flight" ? "Flight masters" : "Innkeepers"}</h4>
                {!list.length && <p className="empty">None in {p.zone.name} for this faction.</p>}
                {list.map(({ id, npc }) => (
                  <button key={id} className="add wide" onClick={() => p.onService(kind, id)}>
                    <Icon name={kind === "flight" ? "wing" : "home"} /> {npc!.name}
                    <small>{kind === "flight" ? "Get the flight path" : "Set Hearthstone"}</small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
