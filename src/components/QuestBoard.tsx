import { useMemo, useState } from "react";
import type { Book } from "../book";
import { canTake, canUse, isUpgradeType, itemType, type Character } from "../character";
import type { DataIndex, Item, Quest, QuestRow, ZoneData, ZoneInfo } from "../data";
import { skipReason, xpFrom, type SkipReason } from "../planner";
import { objectiveLabel } from "../route";
import { levelParts, missingPrerequisites, type SimState } from "../sim";
import { difficulty, levelOf, questXp } from "../xp";
import { Icon } from "./Icon";

interface Props {
  index: DataIndex;
  rows: QuestRow[];
  zone: ZoneInfo;
  data: ZoneData | null;
  book: Book;
  character: Character;
  /** Level at the end of the section being built: where new quests would join. */
  level: number;
  state: SimState;
  onRoute: Set<number>;
  wanted: Set<number>;
  selectedQuest: number | null;
  placing: boolean;
  busy: boolean;
  sectionHasQuests: boolean;
  onZone: (id: number, quest?: number) => void;
  onSelectQuest: (id: number | null) => void;
  onToggle: (id: number) => void;
  onPick: () => void;
  onClear: () => void;
  onBuild: () => void;
  onReplan: () => void;
  onAccept: (quest: Quest) => void;
  onTurnIn: (quest: Quest) => void;
  onObjective: (quest: Quest, index: number) => void;
  onService: (kind: "flight" | "inn", npcId: number) => void;
  onPlacing: (on: boolean) => void;
  onNote: () => void;
  onLevel: () => void;
}

const KIND_LABEL: Record<ZoneInfo["kind"], string> = { zone: "Zones", dungeon: "Dungeons and raids", area: "Other places", other: "Other places" };
type Filter = "all" | "now" | "class" | "rewards";
const WHY: Record<SkipReason, string> = {
  side: "it isn't for your character",
  level: "you aren't high enough level for it yet",
  gray: "it is gray for you and gives little XP",
  hard: "it is too far above your level",
  group: "its targets are elite and need a group (change this under your character)",
  dungeon: "it is a dungeon quest (change this under your character)",
  special: "it is repeatable, a raid, a profession or an event quest, or starts from an item that can't be found",
  slow: "it takes long for the XP it gives (your play style is Fast)",
  chain: "a quest it needs first can't be done here",
  done: "it is already done",
};

function levels(zone: ZoneInfo): string {
  if (!zone.levels) return "";
  return zone.levels[0] === zone.levels[1] ? ` (${zone.levels[0]})` : ` (${zone.levels[0]}-${zone.levels[1]})`;
}

interface Entry {
  quest: Quest;
  /** How deep in its chain: 0 for the first quest. */
  depth: number;
}

/** Quests in chain order: each chain together, what comes first on top, chains by level. */
function inChains(quests: Quest[]): Entry[][] {
  const byId = new Map(quests.map((q) => [q.id, q]));
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const q of quests) {
    for (const other of [...(q.preAll ?? []), ...(q.preAny ?? []), ...(q.next ? [q.next] : [])]) {
      if (byId.has(other)) parent.set(find(q.id), find(other));
    }
  }
  const groups = new Map<number, Quest[]>();
  for (const q of quests) groups.set(find(q.id), [...(groups.get(find(q.id)) ?? []), q]);
  const depthOf = new Map<number, number>();
  const depth = (q: Quest, seen: Set<number>): number => {
    const known = depthOf.get(q.id);
    if (known !== undefined) return known;
    if (seen.has(q.id)) return 0;
    seen.add(q.id);
    const before = [...(q.preAll ?? []), ...(q.preAny ?? [])].map((id) => byId.get(id)).filter((p) => p !== undefined);
    const d = before.length ? 1 + Math.max(...before.map((p) => depth(p, seen))) : 0;
    depthOf.set(q.id, d);
    return d;
  };
  const key = (q: Quest) => (q.level > 0 ? q.level : q.minLevel);
  return [...groups.values()]
    .map((group) => group.map((quest) => ({ quest, depth: depth(quest, new Set()) })).sort((a, b) => a.depth - b.depth || key(a.quest) - key(b.quest) || a.quest.id - b.quest.id))
    .sort((a, b) => Math.min(...a.map((e) => key(e.quest))) - Math.min(...b.map((e) => key(e.quest))) || a[0]!.quest.id - b[0]!.quest.id);
}

function Reward({ item, c, level }: { item: Item; c: Character; level: number }) {
  const type = itemType(item);
  const usable = canUse(item, c.cls, Math.max(level, item.req ?? 0));
  return (
    <li className={`reward${type && !usable ? " unusable" : ""}${isUpgradeType(item, c.cls, level) ? " good" : ""}`}>
      <span className="reward-name">{item.name}</span>
      {type && <span className="reward-type">{type}</span>}
      {item.req ? <span className="reward-type">needs {item.req}</span> : null}
      {type && !usable && <span className="reward-type no">not for {c.cls}s</span>}
    </li>
  );
}

export function QuestBoard(p: Props) {
  const [tab, setTab] = useState<"quests" | "rewards" | "travel">("quests");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const q = query.trim().toLowerCase();
  const c = p.character;
  const whole = Math.floor(p.level);

  const zoneGroups = useMemo(() => {
    const out = new Map<string, ZoneInfo[]>();
    for (const z of p.index.zones) {
      if (!z.quests[c.faction]) continue;
      const label = KIND_LABEL[z.kind];
      out.set(label, [...(out.get(label) ?? []), z]);
    }
    return [...out.entries()];
  }, [p.index, c.faction]);

  const mine = useMemo(() => (p.data?.quests ?? []).filter((quest) => canTake(c, quest)), [p.data, c]);
  const hidden = (p.data?.quests.length ?? 0) - mine.length;
  const have = useMemo(() => new Set([...p.state.done, ...p.onRoute, ...p.wanted]), [p.state, p.onRoute, p.wanted]);
  const goodReward = (quest: Quest) => (quest.rewards ?? []).some((id) => p.data?.items[id] && isUpgradeType(p.data.items[id], c.cls, p.level));

  const shown = useMemo(() => {
    const pass = (quest: Quest) => {
      if (q && !quest.name.toLowerCase().includes(q)) return false;
      if (filter === "now") return quest.minLevel <= whole + 1 && difficulty(quest.level, p.level) !== "gray" && !p.onRoute.has(quest.id);
      if (filter === "class") return !!quest.classes;
      if (filter === "rewards") return goodReward(quest);
      return true;
    };
    return inChains(mine)
      .map((chain) => chain.filter((e) => pass(e.quest)))
      .filter((chain) => chain.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, q, filter, whole, p.level, p.onRoute, p.data, c.cls]);
  const count = shown.reduce((n, chain) => n + chain.length, 0);

  const elsewhere = useMemo(() => {
    if (q.length < 2) return [];
    const zoneNames = new Map(p.index.zones.map((z) => [z.id, z.name]));
    return p.rows
      .filter((r) => r[5] !== p.zone.id && canTake(c, { side: r[4], classes: r[9], races: r[10] }) && r[1].toLowerCase().includes(q))
      .slice(0, 30)
      .map((r) => ({ id: r[0], name: r[1], level: r[2], zone: r[5], zoneName: zoneNames.get(r[5]) ?? "Elsewhere" }));
  }, [q, p.rows, p.zone.id, c, p.index]);

  const services = (kind: "flight" | "inn") =>
    (p.data?.services[kind] ?? [])
      .map((id) => ({ id, npc: p.data!.npcs[id] }))
      .filter((s) => s.npc && (!s.npc.friendly || s.npc.friendly.includes(c.faction)) && s.npc.spawns[p.zone.id]);

  const wantedXp = useMemo(() => xpFrom(p.wanted, p.level, p.book), [p.wanted, p.level, p.book]);
  const after = levelParts(levelOf(p.state.xp + wantedXp));
  const now = levelParts(p.level);

  const rewardQuests = useMemo(() => mine.filter((quest) => quest.rewards?.length && (p.onRoute.has(quest.id) || p.wanted.has(quest.id))), [mine, p.onRoute, p.wanted]);

  const row = ({ quest, depth }: Entry) => {
    const open = quest.id === p.selectedQuest;
    const routed = p.onRoute.has(quest.id);
    const ticked = routed || p.wanted.has(quest.id);
    const missing = ticked ? [] : missingPrerequisites(quest.id, have, c, p.book);
    const colour = difficulty(quest.level, p.level);
    const tooLow = quest.minLevel > whole;
    // what it gives when you do it: on the route that was earlier, at a lower level
    const xp = routed ? questXp(quest.xp, quest.level, Math.min(p.level, quest.level)) : questXp(quest.xp, quest.level, p.level);
    const skip = ticked ? undefined : skipReason(quest, c, p.level, p.level + 1, p.book, p.zone);
    return (
      <li key={quest.id} className={`${open ? "open " : ""}${routed ? "routed" : ticked ? "ticked" : ""}`} style={{ paddingLeft: Math.min(depth, 3) * 12 }}>
        <div className="quest-row">
          <input
            type="checkbox"
            checked={ticked}
            onChange={() => p.onToggle(quest.id)}
            aria-label={`${ticked ? "Remove" : "Add"} ${quest.name}`}
            title={routed ? "On your route. Untick to take it off." : ticked ? "Ticked: press Build route to add it" : "Tick to add this quest"}
          />
          <button className="quest-open" onClick={() => p.onSelectQuest(open ? null : quest.id)} aria-expanded={open}>
            <span className={`lvl diff-${colour}`} title={`Level ${quest.level} quest: ${colour} for you here`}>
              {quest.level > 0 ? quest.level : "–"}
            </span>
            <span className="name">{quest.name}</span>
            {missing.length > 0 && (
              <span className="mark lock" title={`Opens after ${missing.map((id) => p.book.name(id)).join(", ")}. Ticking this ticks ${missing.length === 1 ? "it" : "them"} too.`}>
                <Icon name="lock" size={13} />
              </span>
            )}
            {quest.elite && (
              <span className="tag elite" title="Its targets are elite: bring a group">
                Elite
              </span>
            )}
            {quest.classes && <span className="tag class">{quest.classes.length === 1 ? quest.classes[0] : "Class"}</span>}
            {quest.skill && <span className="tag">{quest.skill[0]}</span>}
            {quest.repeatable && <span className="tag">Repeatable</span>}
            {goodReward(quest) && (
              <span className="mark gift" title="Rewards gear you can use">
                <Icon name="gift" size={13} />
              </span>
            )}
            {tooLow ? <span className="xp need">needs {quest.minLevel}</span> : <span className="xp">{xp >= 1000 ? `${(xp / 1000).toFixed(1)}k` : xp} XP</span>}
          </button>
        </div>
        {open && p.data && (
          <div className="quest-detail">
            {quest.text && <p>{quest.text}</p>}
            <p className="meta">
              Level {quest.level > 0 ? quest.level : "any"} · requires level {quest.minLevel}
              {quest.xp ? ` · ${quest.xp.toLocaleString()} XP` : " · XP estimated"}
              {quest.races ? ` · ${quest.races.join(", ")}` : ""}
              {quest.classes ? ` · ${quest.classes.join(", ")}` : ""}
              {quest.skill ? ` · ${quest.skill[0]} ${quest.skill[1]}` : ""}
            </p>
            {(quest.preAll ?? quest.preAny) && (
              <p className="meta">
                Opens after {(quest.preAll ?? quest.preAny)!.map((id) => p.book.name(id)).join(quest.preAll ? " and " : " or ")}
              </p>
            )}
            {quest.next && p.book.meta(quest.next) && <p className="meta">Leads to {p.book.name(quest.next)}</p>}
            {skip && skip !== "side" && <p className="meta why">"Pick quests for me" leaves this out: {WHY[skip]}.</p>}
            {quest.rewards && (
              <>
                <h5>Rewards</h5>
                <ul className="rewards">
                  {quest.rewards.map((id) => p.data!.items[id] && <Reward key={id} item={p.data!.items[id]} c={c} level={p.level} />)}
                </ul>
              </>
            )}
            <h5>Add a single step by hand</h5>
            <div className="actions">
              <button className="add accept" onClick={() => p.onAccept(quest)}>
                <b>!</b> Accept
              </button>
              {(quest.objectives ?? []).map((o, i) =>
                o.type === "reputation" ? null : (
                  <button key={i} className="add objective" onClick={() => p.onObjective(quest, i)}>
                    <Icon name="plus" size={13} /> {objectiveLabel(quest, i, p.data!)}
                  </button>
                ),
              )}
              <button className="add turnin" onClick={() => p.onTurnIn(quest)}>
                <b>?</b> Turn in
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <aside className="panel quests">
      <div className="panel-head">
        <label className="field">
          <span>Zone</span>
          <select value={p.zone.id} onChange={(e) => p.onZone(Number(e.target.value))}>
            {zoneGroups.map(([label, zones]) => (
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
            Quests <em>{mine.length}</em>
          </button>
          <button role="tab" aria-selected={tab === "rewards"} onClick={() => setTab("rewards")}>
            Rewards
          </button>
          <button role="tab" aria-selected={tab === "travel"} onClick={() => setTab("travel")}>
            Travel and notes
          </button>
        </div>
      </div>

      {tab === "quests" && (
        <>
          <div className="pick">
            <button className="primary wide" onClick={p.onPick} disabled={!p.data}>
              <Icon name="wand" /> Pick quests for me
            </button>
            <p>
              Ticks every quest here that suits a level {now.whole} {c.cls}
              {c.hardcore ? " in hardcore" : ""}. Or tick your own: what a quest needs first is ticked with it.
            </p>
          </div>
          <div className="search">
            <Icon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search quests" aria-label="Search quests" />
            {query && (
              <button className="ghost" onClick={() => setQuery("")} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <div className="chips small" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["now", "For my level"],
                ["class", `${c.cls} quests`],
                ["rewards", "Gear I can use"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="scroll">
            {!p.data && <p className="empty">Loading {p.zone.name}…</p>}
            {p.data && !count && <p className="empty">{q || filter !== "all" ? "No quests here match that." : `No quests here for a ${c.race} ${c.cls}.`}</p>}
            {shown.map((chain) => (
              <ul key={chain[0]!.quest.id} className={`quest-list${chain.length > 1 ? " chain" : ""}`}>
                {chain.map(row)}
              </ul>
            ))}
            {p.data && hidden > 0 && filter === "all" && !q && (
              <p className="empty small">
                {hidden} {hidden === 1 ? "quest" : "quests"} for the other faction or other classes {hidden === 1 ? "is" : "are"} hidden.
              </p>
            )}
            {elsewhere.length > 0 && (
              <>
                <h4>In other zones</h4>
                <ul className="quest-list">
                  {elsewhere.map((r) => (
                    <li key={r.id}>
                      <div className="quest-row">
                        <button className="quest-open" onClick={() => p.onZone(r.zone, r.id)}>
                          <span className={`lvl diff-${difficulty(r.level, p.level)}`}>{r.level > 0 ? r.level : "–"}</span>
                          <span className="name">{r.name}</span>
                          <span className="tag">{r.zoneName}</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="build-bar">
            {p.wanted.size > 0 ? (
              <>
                <div className="build-info">
                  <b>
                    {p.wanted.size} {p.wanted.size === 1 ? "quest" : "quests"} ticked
                  </b>
                  <span>
                    about {Math.round(wantedXp).toLocaleString()} XP: level {now.whole} to {after.whole}
                    {after.percent ? ` (${after.percent}%)` : ""}
                  </span>
                </div>
                <button className="ghost" onClick={p.onClear} title="Untick them all">
                  Clear
                </button>
                <button className="primary" onClick={p.onBuild} disabled={p.busy}>
                  Build route
                </button>
              </>
            ) : (
              <>
                <div className="build-info">
                  <span>Tick quests, then build. The planner puts them in order.</span>
                </div>
                {p.sectionHasQuests && (
                  <button onClick={p.onReplan} disabled={p.busy} title="Order this section's quests again from scratch">
                    <Icon name="refresh" /> Re-plan
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {tab === "rewards" && (
        <div className="scroll rewards-tab">
          <h4>From your quests in {p.zone.name}</h4>
          {!rewardQuests.length && <p className="empty">Tick quests to see what they give. Gear your {c.cls} can use is marked.</p>}
          {rewardQuests.map((quest) => (
            <div key={quest.id} className="reward-group">
              <button className="reward-quest" onClick={() => { setTab("quests"); p.onSelectQuest(quest.id); }}>
                <span className={`lvl diff-${difficulty(quest.level, p.level)}`}>{quest.level}</span> {quest.name}
              </button>
              <ul className="rewards">{quest.rewards!.map((id) => p.data!.items[id] && <Reward key={id} item={p.data!.items[id]} c={c} level={p.level} />)}</ul>
            </div>
          ))}
          {p.data?.bosses && (
            <>
              <h4>Dropped in {p.zone.name}</h4>
              {p.data.bosses.map((b) => (
                <div key={b.npc} className="reward-group">
                  <div className="reward-quest">
                    <Icon name="skull" size={14} /> {p.data!.npcs[b.npc]?.name}
                    {p.data!.npcs[b.npc]?.level && <small> level {p.data!.npcs[b.npc]!.level!.join("-")}</small>}
                  </div>
                  <ul className="rewards">{b.loot.map((id) => p.data!.items[id] && <Reward key={id} item={p.data!.items[id]} c={c} level={p.level} />)}</ul>
                </div>
              ))}
            </>
          )}
          <p className="empty small">Item stats aren't in the open data yet, so gear is marked by type: what your class can equip, and the heaviest armour it wears.</p>
        </div>
      )}

      {tab === "travel" && (
        <div className="scroll travel">
          <h4>Anywhere</h4>
          <button className={`add wide${p.placing ? " active" : ""}`} onClick={() => p.onPlacing(!p.placing)}>
            <Icon name="pin" /> {p.placing ? "Click the map… (cancel)" : "Add a waypoint on the map"}
          </button>
          <button className="add wide" onClick={p.onNote}>
            <Icon name="note" /> Add a note
          </button>
          <button className="add wide" onClick={p.onLevel}>
            <Icon name="plus" /> Add "grind to a level"
          </button>
          {(["flight", "inn"] as const).map((kind) => {
            const list = services(kind);
            return (
              <div key={kind}>
                <h4>{kind === "flight" ? "Flight masters" : "Innkeepers"}</h4>
                {!list.length && <p className="empty">None in {p.zone.name} for your faction.</p>}
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
