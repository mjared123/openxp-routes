/** The site's own artwork: a night sky over mountains, and line glyphs. All drawn here, nothing downloaded. */
import { useMemo, type CSSProperties, type ReactNode } from "react";

/** A steady random number from a seed, so the sky looks the same on every render. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function ridge(seed: number, base: number, rough: number): string {
  const rand = seeded(seed);
  let y = base;
  let d = `M0 600 L0 ${base}`;
  for (let x = 0; x <= 1600; x += 40) {
    y = Math.max(base - rough * 2.2, Math.min(base + rough, y + (rand() - 0.5) * rough * 1.6));
    d += ` L${x} ${y.toFixed(0)}`;
  }
  return `${d} L1600 600 Z`;
}

/** The scene behind every adventure screen. `tone` tints it for the chosen faction. */
export function Backdrop({ tone = "neutral" }: { tone?: "neutral" | "alliance" | "horde" }) {
  const stars = useMemo(() => {
    const rand = seeded(42);
    return Array.from({ length: 90 }, (_, i) => ({ i, x: rand() * 100, y: rand() * 62, r: 0.6 + rand() * 1.5, d: rand() * 6, t: 2.5 + rand() * 4 }));
  }, []);
  const embers = useMemo(() => {
    const rand = seeded(7);
    return Array.from({ length: 26 }, (_, i) => ({ i, x: rand() * 100, s: 2 + rand() * 3, d: rand() * 14, t: 9 + rand() * 12, sway: (rand() - 0.5) * 120 }));
  }, []);
  return (
    <div className={`backdrop tone-${tone}`} aria-hidden="true">
      <div className="sky" />
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <svg className="stars" viewBox="0 0 100 62" preserveAspectRatio="none">
        {stars.map((s) => (
          <circle key={s.i} cx={s.x} cy={s.y} r={s.r * 0.09} style={{ animationDelay: `${s.d}s`, animationDuration: `${s.t}s` }} />
        ))}
      </svg>
      <div className="moon" />
      <svg className="ridges" viewBox="0 0 1600 600" preserveAspectRatio="xMidYMax slice">
        <path className="ridge r1" d={ridge(11, 300, 46)} />
        <path className="ridge r2" d={ridge(23, 380, 38)} />
        <path className="ridge r3" d={ridge(5, 455, 30)} />
        <path className="ridge r4" d={ridge(31, 525, 20)} />
      </svg>
      <div className="mist" />
      <div className="embers">
        {embers.map((e) => (
          <span key={e.i} style={{ left: `${e.x}%`, width: e.s, height: e.s, animationDelay: `-${e.d}s`, animationDuration: `${e.t}s`, "--sway": `${e.sway}px` } as CSSProperties} />
        ))}
      </div>
      <div className="vignette" />
    </div>
  );
}

const GLYPHS: Record<string, ReactNode> = {
  // factions
  alliance: <path d="M12 2.5 19.5 5v6.2c0 4.6-3 8.300-7.500 10.300C7.500 19.500 4.500 15.800 4.500 11.200V5L12 2.500Zm0 4.200v9.800M8.200 10.300h7.600" />,
  horde: <path d="M12 3l2.200 4.200L19 5.500l-1.700 4.800L21 12l-3.700 1.700L19 18.500l-4.800-1.700L12 21l-2.200-4.200L5 18.500l1.700-4.800L3 12l3.700-1.700L5 5.500l4.800 1.700L12 3Zm0 6.200a2.800 2.800 0 1 0 0 5.600 2.800 2.800 0 0 0 0-5.600Z" />,
  // play styles
  fast: <path d="M13.500 2.500 5 13.500h6l-1.500 8L19 10h-6.200l.7-7.500Z" />,
  balanced: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.800-12.800-2.300 5.300-5.300 2.300 2.300-5.300 5.300-2.300ZM12 3v2m0 14v2M3 12h2m14 0h2" />,
  relaxed: <path d="M12 3.500c.6 2.600 3.500 3.700 3.500 7a3.500 3.500 0 0 1-7 0c0-1.300.6-2.200 1.300-3 .2 1.100.8 1.700 1.400 1.800-.4-2.300.2-4.300.8-5.800ZM4 20.500l16-4M4 16.500l16 4" />,
  complete: <path d="M4 8.500 7.500 12 12 5.500 16.500 12 20 8.500l-1.500 9.500h-13L4 8.500Zm1.500 12h13" />,
  // classes
  Warrior: <path d="M5 19 16.500 7.500M14 5l5 5M4.500 16.500l3 3M19 19 7.500 7.500M10 5l-5 5m14.500 6.500-3 3" />,
  Paladin: <path d="M12 3v18M8.500 6.500h7M6 10.500h12l-1.500 4h-9L6 10.500Zm3.500 7.500h5" />,
  Hunter: <path d="M5 4c8 1 13 6 14 15M5 4l14 15M5 4l1 6m-1-6 6 1M15.500 15l4.500 5-1.500-6.500" />,
  Rogue: <path d="M4 20 14.500 9.500M12.500 7.500l4 4M17 3l4 4-4.500 2.500L14.500 7.500 17 3ZM20 20 9.500 9.500m2-2-4 4M7 3 3 7l4.500 2.500L9.500 7.500 7 3Z" />,
  Priest: <path d="M12 3v18M7 8.500h10M12 3a2 2 0 1 0 0 .01ZM8 21h8" />,
  Shaman: <path d="M12 3v18M7.500 6h9M8.500 10h7M9 14h6M8 21h8M5 3.500l2.500 2.500M19 3.500 16.500 6" />,
  Mage: <path d="m12 2.500 2 6 6 1.500-5 3.500 1.500 6.500-4.500-4-4.500 4L9 13.500 4 10l6-1.500 2-6Z" />,
  Warlock: <path d="M12 3c3 3 5.500 5.500 5.500 9.500a5.500 5.500 0 0 1-11 0C6.500 10 8 8.500 9 7c.3 2 1 3 2 3.500C10.500 8 11 5.500 12 3Zm0 12.500a2 2 0 0 0 2-2c0-1.200-1-2-2-3-1 1-2 1.800-2 3a2 2 0 0 0 2 2Z" />,
  Druid: <path d="M12 21c-2.500 0-4-1.500-4-3.500s1.800-3 4-3 4 1 4 3-1.500 3.500-4 3.500ZM6.500 12.500a1.800 2.300 0 1 0 0-.01ZM17.500 12.500a1.800 2.300 0 1 0 0-.01ZM9.500 7.500a1.700 2.200 0 1 0 0-.01ZM14.500 7.500a1.700 2.200 0 1 0 0-.01Z" />,
  // things
  dungeon: <path d="M4 21V10a8 8 0 0 1 16 0v11M9 21v-7a3 3 0 0 1 6 0v7M4 14h3m10 0h3M4 18h3m10 0h3M10 6.500h4" />,
  treasure: <path d="M3.500 10.500h17V20h-17v-9.500Zm0 0C3.500 7 6 4.500 9 4.500h6c3 0 5.500 2.500 5.500 6M10.500 10.500v4h3v-4M3.500 14.500h7m3 0h7" />,
  camp: <path d="M12 4 3 20h18L12 4Zm0 7-3.500 9M12 11l3.500 9M10.500 2.500 12 4l1.500-1.500" />,
  craft: <path d="M14.500 3.500 20.500 9.500l-3 1-7.500 8.500-3 1 1-3 8.500-7.500 1-3ZM4 4l5 5M3.500 8.500l5-5" />,
  scroll: <path d="M7 4h11v13a3 3 0 0 1-3 3H6a2.500 2.500 0 0 1 0-5h9V4M4 6.500A2.500 2.500 0 0 1 9 6.500V15M11.500 8h4M11.500 11.500h4" />,
  flag: <path d="M6 21V4m0 1h11l-2.500 4L17 13H6" />,
  compass: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.800-12.800-2.300 5.300-5.300 2.300 2.300-5.300 5.300-2.300Z" />,
  check: <path d="m5 12.500 4.500 4.500L19 7" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  back: <path d="M19 12H5m5-5-5 5 5 5" />,
  skull: <path d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14Zm-3 9h.01M15 12h.01M10 20v-2m4 2v-2" />,
  pen: <path d="M4 20l1-4L16.500 4.500l3 3L8 19l-4 1Zm10.500-13.500 3 3" />,
  download: <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />,
  search: <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.300-4.300" />,
  coin: <path d="M12 20c4.400 0 8-1.300 8-3V7c0 1.700-3.600 3-8 3S4 8.700 4 7v10c0 1.700 3.600 3 8 3Zm0-10c4.400 0 8-1.300 8-3s-3.600-3-8-3-8 1.300-8 3 3.600 3 8 3Zm-8 2c0 1.700 3.600 3 8 3s8-1.300 8-3" />,
};

/** A line drawing by name: factions, play styles, classes and a few objects. */
export function Glyph({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name] ?? GLYPHS.compass}
    </svg>
  );
}

export const CLASS_COLOURS: Record<string, string> = {
  Warrior: "#c79c6e", Paladin: "#f58cba", Hunter: "#abd473", Rogue: "#fff569", Priest: "#f4f4f4", Shaman: "#3b8ef0", Mage: "#69ccf0", Warlock: "#9f8fe0", Druid: "#ff7d0a",
};

/** A gold rule with a diamond, between parts of a page. */
export function Flourish() {
  return (
    <svg className="flourish" viewBox="0 0 240 14" aria-hidden="true">
      <path d="M0 7h98M142 7h98" />
      <path d="M120 1.500 126 7l-6 5.500L114 7l6-5.500Z" />
      <path d="M104 7l4-3 4 3-4 3-4-3ZM128 7l4-3 4 3-4 3-4-3Z" />
    </svg>
  );
}
