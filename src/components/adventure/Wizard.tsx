import { useMemo, useState, type ReactNode } from "react";
import type { Book } from "../../book";
import { CLASSES, PRIMARY_PROFESSIONS, RACES, SECONDARY_PROFESSIONS, STYLES, canTake, isUpgradeType, itemType, type Character, type Style } from "../../character";
import type { DataIndex, GoalData, GoalItem } from "../../data";
import type { Goals } from "../../generate";
import { ItemIcon, ItemTip } from "../Item";
import { Backdrop, CLASS_COLOURS, Flourish, Glyph } from "./art";

interface Props {
  index: DataIndex;
  book: Book;
  goalData: GoalData;
  character: Character;
  goals: Goals;
  onForge: (character: Character, goals: Goals) => void;
  onCancel: () => void;
  cancelLabel: string;
}

const STEPS = ["Hero", "Pace", "Dungeons", "Treasures", "Trades", "Review"] as const;
const RAIDS = new Set(["Molten Core", "Blackwing Lair", "Onyxia's Lair", "Zul'Gurub", "Ruins of Ahn'Qiraj", "Temple of Ahn'Qiraj", "Naxxramas"]);
const STYLE_ORDER: Style[] = ["fast", "balanced", "relaxed", "complete"];
const BRACKETS: [number, number][] = [[1, 19], [20, 29], [30, 39], [40, 49], [50, 60]];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Pick({ on, onClick, children, className = "", style }: { on: boolean; onClick: () => void; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <button type="button" className={`pick ${className}${on ? " on" : ""}`} aria-pressed={on} onClick={onClick} style={style}>
      {children}
      <span className="pick-check">
        <Glyph name="check" size={14} />
      </span>
    </button>
  );
}

export function Wizard({ index, book, goalData, character, goals: initialGoals, onForge, onCancel, cancelLabel }: Props) {
  const [step, setStep] = useState(0);
  const [c, setC] = useState(character);
  const [goals, setGoals] = useState(initialGoals);
  const [bracket, setBracket] = useState(0);
  const [query, setQuery] = useState("");
  const [recipeQuery, setRecipeQuery] = useState("");
  const set = (change: Partial<Character>) => setC((prev) => ({ ...prev, ...change }));
  const want = (change: Partial<Goals>) => setGoals((prev) => ({ ...prev, ...change }));
  const zoneName = useMemo(() => new Map(index.zones.map((z) => [z.id, z.name])), [index]);

  const dungeons = useMemo(
    () =>
      index.zones
        .filter((z) => z.kind === "dungeon" && !RAIDS.has(z.name) && z.levels && goalData.bossItems.some((b) => b.zone === z.id))
        .map((z) => {
          const drops = goalData.bossItems.filter((b) => b.zone === z.id && isUpgradeType(b, c.cls, z.levels![0]));
          const best = [...new Map(drops.map((b) => [b.id, b])).values()].sort((a, b) => (b.ilvl ?? 0) - (a.ilvl ?? 0)).slice(0, 5);
          return { zone: z, loot: drops.length, best };
        })
        .sort((a, b) => a.zone.levels![0] - b.zone.levels![0]),
    [index, goalData, c.cls],
  );
  const dungeonFits = (levels: [number, number]) => levels[0] <= goals.target && levels[1] >= c.level;

  const treasures = useMemo(() => {
    const seen = new Set<number>();
    const out: (GoalItem & { level: number; questName: string; zone: string; elite: boolean })[] = [];
    for (const item of goalData.items) {
      const meta = book.meta(item.quest);
      if (!meta || seen.has(item.id) || !canTake(c, meta) || meta.minLevel > goals.target || meta.level < c.level - 2 || meta.level > goals.target + 2) continue;
      if (!item.featured && !isUpgradeType(item, c.cls, Math.max(1, meta.level))) continue;
      seen.add(item.id);
      out.push({ ...item, level: Math.max(1, meta.level), questName: meta.name, zone: zoneName.get(meta.zone) ?? "", elite: meta.elite });
    }
    return out;
  }, [goalData, book, c, goals.target, zoneName]);
  const featured = treasures.filter((t) => t.featured);
  const q = query.trim().toLowerCase();
  const shownTreasures = treasures.filter((t) => !t.featured && (q ? t.name.toLowerCase().includes(q) || t.questName.toLowerCase().includes(q) || t.zone.toLowerCase().includes(q) : t.level >= BRACKETS[bracket]![0] && t.level <= BRACKETS[bracket]![1]));
  const bossLoot = goalData.bossItems.filter((b) => goals.dungeons.includes(b.zone) && isUpgradeType(b, c.cls, 60));

  const recipes = useMemo(
    () => goalData.recipes.filter((r) => c.professions.includes(r.profession) && (r.vendors?.some((v) => !v.friendly || v.friendly.includes(c.faction)) || r.quests?.some((id) => book.meta(id) && canTake(c, book.meta(id)!)))),
    [goalData, c, book],
  );
  const rq = recipeQuery.trim().toLowerCase();
  const shownRecipes = recipes.filter((r) => !rq || r.name.toLowerCase().includes(rq)).slice(0, 120);
  const primaries = c.professions.filter((p) => PRIMARY_PROFESSIONS.includes(p)).length;

  const itemName = (id: number) => goalData.items.find((g) => g.id === id)?.name ?? goalData.bossItems.find((g) => g.id === id)?.name ?? "Item";
  const tone = c.faction === "A" ? "alliance" : "horde";
  const last = step === STEPS.length - 1;

  return (
    <div className="adv">
      <Backdrop tone={tone} />
      <header className="adv-top">
        <div className="brand">
          <span className="logo">XP</span>
          <span>
            OpenXP <b>Routes</b>
          </span>
        </div>
        <ol className="stepper" aria-label="Steps">
          {STEPS.map((name, i) => (
            <li key={name} className={i === step ? "now" : i < step ? "done" : ""}>
              <button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}>
                <i>{i < step ? <Glyph name="check" size={12} /> : i + 1}</i>
                <span>{name}</span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="adv-quiet" onClick={onCancel}>
          {cancelLabel}
        </button>
      </header>

      <main className="adv-stage" key={step}>
        {step === 0 && (
          <section className="adv-card">
            <p className="eyebrow">Step 1 of 6</p>
            <h1>Who is setting out?</h1>
            <p className="sub">Your route is built for this character: only quests it can take, in the zones it calls home.</p>
            <div className="factions">
              {(["A", "H"] as const).map((f) => (
                <Pick key={f} on={c.faction === f} className={`faction ${f === "A" ? "alliance" : "horde"}`} onClick={() => set({ faction: f, race: RACES[f].includes(c.race) ? c.race : RACES[f][0]! })}>
                  <Glyph name={f === "A" ? "alliance" : "horde"} size={44} />
                  <b>{f === "A" ? "Alliance" : "Horde"}</b>
                </Pick>
              ))}
            </div>
            <h3>Race</h3>
            <div className="pills">
              {RACES[c.faction].map((r) => (
                <Pick key={r} on={c.race === r} className="pill" onClick={() => set({ race: r })}>
                  {r}
                </Pick>
              ))}
            </div>
            <h3>Class</h3>
            <div className="classes">
              {CLASSES.map((k) => (
                <Pick key={k} on={c.cls === k} className="class" onClick={() => set({ cls: k })} style={{ "--class": CLASS_COLOURS[k] } as React.CSSProperties}>
                  <Glyph name={k} size={30} />
                  <span>{k}</span>
                </Pick>
              ))}
            </div>
            <h3>The journey</h3>
            <div className="levels">
              <label>
                <span>Start at level</span>
                <input type="number" min={1} max={59} value={c.level} onChange={(e) => set({ level: Math.min(59, Math.max(1, Number.parseInt(e.target.value, 10) || 1)) })} />
              </label>
              <label className="grow">
                <span>
                  Travel to level <b>{goals.target}</b>
                </span>
                <input type="range" min={Math.min(60, c.level + 1)} max={60} value={goals.target} onChange={(e) => want({ target: Number(e.target.value) })} />
              </label>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="adv-card">
            <p className="eyebrow">Step 2 of 6</p>
            <h1>How do you like to travel?</h1>
            <p className="sub">This decides which quests make the cut and how long you stay in each zone.</p>
            <div className="styles">
              {STYLE_ORDER.map((s) => (
                <Pick key={s} on={c.style === s} className="style" onClick={() => set({ style: s })}>
                  <span className="style-art">
                    <Glyph name={s} size={38} />
                  </span>
                  <b>{STYLES[s].label}</b>
                  <span>{STYLES[s].about}</span>
                </Pick>
              ))}
            </div>
            <h3>One life or many?</h3>
            <div className="modes">
              <Pick on={!c.hardcore} className="mode" onClick={() => set({ hardcore: false })}>
                <Glyph name="flag" size={26} />
                <span>
                  <b>Normal</b>
                  <em>Dying costs a walk back. Quests a few levels above you are fair game.</em>
                </span>
              </Pick>
              <Pick on={c.hardcore} className="mode danger" onClick={() => set({ hardcore: true })}>
                <Glyph name="skull" size={26} />
                <span>
                  <b>Hardcore</b>
                  <em>One life. The route stays close to your level and steers clear of risky quests.</em>
                </span>
              </Pick>
            </div>
            <label className="adv-check">
              <input type="checkbox" checked={c.groups} onChange={(e) => set({ groups: e.target.checked })} />
              <span>
                <b>Include elite quests</b> that need a friend or two
              </span>
            </label>
          </section>
        )}

        {step === 2 && (
          <section className="adv-card wide">
            <p className="eyebrow">Step 3 of 6</p>
            <h1>Which dungeons call to you?</h1>
            <p className="sub">Pick any you want to run. Each one is added when you reach its level, with its quests picked up on the way in. Pick none to stay out in the world.</p>
            <div className="dungeons">
              {dungeons.map(({ zone: z, loot, best }) => {
                const fits = dungeonFits(z.levels!);
                return (
                  <Pick key={z.id} on={goals.dungeons.includes(z.id)} className={`dungeon${fits ? "" : " off"}`} onClick={() => fits && want({ dungeons: toggle(goals.dungeons, z.id) })}>
                    <span className="dungeon-art">
                      <Glyph name="dungeon" size={30} />
                    </span>
                    <b>{z.name}</b>
                    <span>
                      Levels {z.levels![0]}-{z.levels![1]}
                      {z.quests[c.faction] ? ` · ${z.quests[c.faction]} quests` : ""}
                    </span>
                    <em>{fits ? (loot ? `${loot} drops your ${c.cls} can use` : "Known boss loot inside") : "Outside your level range"}</em>
                    {best.length > 0 && (
                      <span className="dungeon-loot">
                        {best.map((b) => (
                          <ItemTip key={b.id} id={b.id} name={b.name} source={`Drops from ${b.boss}`}>
                            <ItemIcon id={b.id} size={30} />
                          </ItemTip>
                        ))}
                      </span>
                    )}
                  </Pick>
                );
              })}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="adv-card wide">
            <p className="eyebrow">Step 4 of 6</p>
            <h1>What do you want to bring home?</h1>
            <p className="sub">Pick the rewards worth a detour. The route follows each quest chain to the end, wherever it leads.</p>
            {featured.length > 0 && (
              <div className="featured">
                {featured.map((t) => (
                  <Pick key={t.id} on={goals.items.includes(t.id)} className="treasure feature" onClick={() => want({ items: toggle(goals.items, t.id) })}>
                    <ItemTip className="treasure-body" id={t.id} name={t.name} source={`Reward from ${t.questName}, ${t.zone}`}>
                      <ItemIcon id={t.id} size={56} />
                    <span className="treasure-text">
                      <b>{t.name}</b>
                      <span>{t.featured}</span>
                      <em>
                        A chain of {t.chain} quests ending in {t.zone}, around level {t.level}
                      </em>
                    </span>
                    </ItemTip>
                  </Pick>
                ))}
              </div>
            )}
            <div className="treasure-bar">
              <div className="tabs-gold" role="tablist">
                {BRACKETS.map(([lo, hi], i) => (
                  <button key={lo} type="button" role="tab" aria-selected={!q && bracket === i} disabled={lo > goals.target + 2} onClick={() => { setBracket(i); setQuery(""); }}>
                    {lo}-{hi}
                  </button>
                ))}
              </div>
              <label className="adv-search">
                <Glyph name="search" size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rewards, quests, zones" aria-label="Search rewards" />
              </label>
            </div>
            <div className="treasures">
              {shownTreasures.slice(0, 60).map((t) => (
                <Pick key={t.id} on={goals.items.includes(t.id)} className="treasure" onClick={() => want({ items: toggle(goals.items, t.id) })}>
                  <ItemTip className="treasure-body" id={t.id} name={t.name} source={`Reward from ${t.questName}, ${t.zone}`}>
                    <ItemIcon id={t.id} size={44} />
                  <span className="treasure-text">
                    <b>{t.name}</b>
                    <span>
                      {itemType(t)} · level {t.level}
                      {t.elite ? " · elite" : ""}
                    </span>
                    <em>
                      {t.questName}, {t.zone}
                      {t.chain > 1 ? ` · chain of ${t.chain}` : ""}
                    </em>
                  </span>
                  </ItemTip>
                </Pick>
              ))}
              {!shownTreasures.length && <p className="adv-empty">Nothing here for a {c.cls} at these levels.</p>}
            </div>
            {bossLoot.length > 0 && (
              <>
                <h3>From the dungeons you picked</h3>
                <div className="treasures">
                  {bossLoot.slice(0, 40).map((b) => (
                    <div key={`${b.id}-${b.npc}`} className="treasure static">
                      <ItemTip className="treasure-body" id={b.id} name={b.name} source={`Drops from ${b.boss}, ${zoneName.get(b.zone)}`}>
                        <ItemIcon id={b.id} size={44} />
                      <span className="treasure-text">
                        <b>{b.name}</b>
                        <span>{itemType(b)}</span>
                        <em>
                          {b.boss}, {zoneName.get(b.zone)}
                        </em>
                      </span>
                      </ItemTip>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="adv-note">Hover an icon to see the item. The list shows weapons your class can use and the heaviest armour it wears.</p>
          </section>
        )}

        {step === 4 && (
          <section className="adv-card wide">
            <p className="eyebrow">Step 5 of 6</p>
            <h1>What will you make along the way?</h1>
            <p className="sub">Pick your professions and their quests join the route. Then choose any recipes you want picked up as you pass.</p>
            <h3>Professions (two)</h3>
            <div className="pills">
              {PRIMARY_PROFESSIONS.map((p) => (
                <Pick key={p} on={c.professions.includes(p)} className={`pill${!c.professions.includes(p) && primaries >= 2 ? " off" : ""}`} onClick={() => (c.professions.includes(p) || primaries < 2) && set({ professions: toggle(c.professions, p) })}>
                  {p}
                </Pick>
              ))}
            </div>
            <h3>Everyone can learn these</h3>
            <div className="pills">
              {SECONDARY_PROFESSIONS.map((p) => (
                <Pick key={p} on={c.professions.includes(p)} className="pill" onClick={() => set({ professions: toggle(c.professions, p) })}>
                  {p}
                </Pick>
              ))}
            </div>
            <label className="adv-check">
              <input type="checkbox" checked={c.camping} onChange={(e) => set({ camping: e.target.checked })} />
              <span>
                <b>Camping quests</b>, WoW Forever's campfire and outdoors quests
              </span>
            </label>
            {c.professions.length > 0 && (
              <>
                <div className="treasure-bar">
                  <h3>Recipes to collect {goals.recipes.length > 0 && <small>({goals.recipes.length} picked)</small>}</h3>
                  <label className="adv-search">
                    <Glyph name="search" size={16} />
                    <input value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)} placeholder="Search recipes" aria-label="Search recipes" />
                  </label>
                </div>
                <div className="treasures recipes">
                  {shownRecipes.map((r) => {
                    const vendor = r.vendors?.find((v) => !v.friendly || v.friendly.includes(c.faction));
                    return (
                      <Pick key={r.id} on={goals.recipes.includes(r.id)} className="treasure" onClick={() => want({ recipes: toggle(goals.recipes, r.id) })}>
                        <ItemTip className="treasure-body" id={r.id} name={r.name} source={vendor ? `Sold by ${vendor.name}, ${zoneName.get(vendor.zone)}` : "A quest reward"}>
                          <ItemIcon id={r.id} size={44} />
                        <span className="treasure-text">
                          <b>{r.name}</b>
                          <span>{r.profession}</span>
                          <em>{vendor ? `Sold by ${vendor.name}, ${zoneName.get(vendor.zone)}` : "A quest reward"}</em>
                        </span>
                        </ItemTip>
                      </Pick>
                    );
                  })}
                  {!shownRecipes.length && <p className="adv-empty">No recipes from vendors or quests for these professions.</p>}
                </div>
                <p className="adv-note">These are recipes a vendor sells or a quest gives. World drops can't be planned.</p>
              </>
            )}
          </section>
        )}

        {step === 5 && (
          <section className="adv-card">
            <p className="eyebrow">Step 6 of 6</p>
            <h1>Your adventure</h1>
            <Flourish />
            <dl className="review">
              <div>
                <dt>Hero</dt>
                <dd>
                  <b style={{ color: CLASS_COLOURS[c.cls] }}>
                    {c.race} {c.cls}
                  </b>
                  , level {c.level} to {goals.target}
                </dd>
              </div>
              <div>
                <dt>Pace</dt>
                <dd>
                  {STYLES[c.style].label}
                  {c.hardcore ? ", hardcore" : ""}
                  {c.groups ? ", with elite quests" : ""}
                </dd>
              </div>
              <div>
                <dt>Dungeons</dt>
                <dd>{goals.dungeons.length ? goals.dungeons.map((z) => zoneName.get(z)).join(", ") : "None"}</dd>
              </div>
              <div>
                <dt>Treasures</dt>
                <dd>
                  {goals.items.length ? (
                    <span className="review-items">
                      {goals.items.map((id) => (
                        <ItemTip key={id} id={id} name={itemName(id)} className="review-item">
                          <ItemIcon id={id} size={28} />
                          {itemName(id)}
                        </ItemTip>
                      ))}
                    </span>
                  ) : (
                    "Whatever the road gives"
                  )}
                </dd>
              </div>
              <div>
                <dt>Trades</dt>
                <dd>
                  {c.professions.length ? c.professions.join(", ") : "None"}
                  {goals.recipes.length ? `, ${goals.recipes.length} ${goals.recipes.length === 1 ? "recipe" : "recipes"}` : ""}
                  {c.camping ? ", camping quests" : ""}
                </dd>
              </div>
            </dl>
            <button type="button" className="forge" onClick={() => onForge(c, goals)}>
              <span>Forge my route</span>
              <Glyph name="arrow" size={20} />
            </button>
            <p className="adv-note center">It takes a few seconds. You can fine-tune every step afterwards.</p>
          </section>
        )}
      </main>

      <footer className="adv-nav">
        <button type="button" className="adv-quiet" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <Glyph name="back" size={18} /> Back
        </button>
        <span className="adv-summary">
          {c.race} {c.cls} · {c.level} to {goals.target} · {STYLES[c.style].label}
          {goals.dungeons.length ? ` · ${goals.dungeons.length} ${goals.dungeons.length === 1 ? "dungeon" : "dungeons"}` : ""}
          {goals.items.length ? ` · ${goals.items.length} ${goals.items.length === 1 ? "treasure" : "treasures"}` : ""}
        </span>
        {last ? (
          <button type="button" className="adv-next" onClick={() => onForge(c, goals)}>
            Forge my route <Glyph name="arrow" size={18} />
          </button>
        ) : (
          <button type="button" className="adv-next" onClick={() => setStep(step + 1)}>
            Continue <Glyph name="arrow" size={18} />
          </button>
        )}
      </footer>
    </div>
  );
}
