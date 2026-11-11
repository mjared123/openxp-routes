const PATHS: Record<string, string> = {
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  download: "M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3",
  upload: "M12 15V3m0 0L8 7m4-4 4 4M4 17v3h16v-3",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3",
  pin: "M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  note: "M5 4h14v12l-4 4H5V4Zm10 16v-4h4M8 9h8M8 13h5",
  close: "M6 6l12 12M18 6 6 18",
  copy: "M9 9h11v11H9V9ZM5 15H4V4h11v1",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  check: "m5 12 5 5 9-10",
  chevron: "m9 6 6 6-6 6",
  wing: "M3 17c6 0 9-3 10-7 1 4 3 6 8 6-2 3-6 4-9 4-4 0-7-1-9-3Zm10-7c0-3 2-5 5-6-1 3-2 5-5 6Z",
  home: "M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z",
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "grip" ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
