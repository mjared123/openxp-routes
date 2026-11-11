import { useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { loadItems, type ItemInfo, type ItemTable, type TipLine } from "../data";

/* Icons and tooltips arrive after the page is up; everything renders without them first. */
let table: ItemTable = {};
let started = false;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!started) {
    started = true;
    loadItems().then(
      (loaded) => {
        table = loaded;
        for (const l of listeners) l();
      },
      () => undefined,
    );
  }
  return () => listeners.delete(listener);
}

export function useItem(id: number): ItemInfo | undefined {
  return useSyncExternalStore(subscribe, () => table)[id];
}

const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary"];
const qualityClass = (info?: ItemInfo) => (info && info[1] >= 0 ? QUALITY[info[1]] : "new") ?? "common";
const iconUrl = (name: string) => `${import.meta.env.BASE_URL}icons/${name}.webp`;

/** The item's icon in a frame coloured by its quality. */
export function ItemIcon({ id, size = 40 }: { id: number; size?: number }) {
  const info = useItem(id);
  return (
    <span className={`item-icon q-${qualityClass(info)}`} style={{ width: size, height: size }}>
      {info && <img src={iconUrl(info[0])} alt="" width={size} height={size} loading="lazy" draggable={false} />}
    </span>
  );
}

function Line({ line }: { line: TipLine }) {
  if (typeof line === "string") return <p>{line}</p>;
  const [text, fmt, right] = line;
  return (
    <p className={fmt ? `f-${fmt}` : undefined}>
      <span>{text}</span>
      {right && <span>{right}</span>}
    </p>
  );
}

interface TipProps {
  id: number;
  name: string;
  /** Where it comes from, shown under the stats. */
  source?: ReactNode;
  children: ReactNode;
  className?: string;
}

const TIP_WIDTH = 320;

/** Wraps anything that names an item: hovering or focusing it shows the item's tooltip. */
export function ItemTip({ id, name, source, children, className }: TipProps) {
  const info = useItem(id);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const place = (x: number, y: number) => setAt({ x, y });
  const left = at ? Math.max(8, Math.min(at.x + 18, window.innerWidth - TIP_WIDTH - 8)) : 0;
  const below = at ? at.y < window.innerHeight * 0.55 : true;
  return (
    <span
      className={`item-tip-host${className ? ` ${className}` : ""}`}
      onPointerEnter={(e) => place(e.clientX, e.clientY)}
      onPointerMove={(e) => place(e.clientX, e.clientY)}
      onPointerLeave={() => setAt(null)}
      onFocus={(e) => {
        const box = (e.target as HTMLElement).getBoundingClientRect();
        place(box.left, box.bottom);
      }}
      onBlur={() => setAt(null)}
    >
      {children}
      {at &&
        createPortal(
          <div className={`item-tip q-${qualityClass(info)}`} role="tooltip" style={{ left, width: TIP_WIDTH, ...(below ? { top: at.y + 18 } : { bottom: window.innerHeight - at.y + 12 }) }}>
            <header>
              <ItemIcon id={id} size={44} />
              <b>{name}</b>
            </header>
            {info?.[2].map((line, i) => <Line key={i} line={line} />)}
            {info && info[1] < 0 && <p className="f-note">New in Forever. Its full stats are not in the open data yet.</p>}
            {source && <p className="f-source">{source}</p>}
          </div>,
          document.body,
        )}
    </span>
  );
}
