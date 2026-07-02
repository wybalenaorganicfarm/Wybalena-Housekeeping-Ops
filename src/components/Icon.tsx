// Minimal icon set (lucide-style paths) used across the app.
const PATHS: Record<string, string> = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  calendar: "M8 2v4M16 2v4M3 10h18M3 4h18v18H3z",
  alert: "M10.27 3.5a2 2 0 0 1 3.46 0l8.5 14.5a2 2 0 0 1-1.73 3H3.5a2 2 0 0 1-1.73-3ZM12 9v4M12 17h.01",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 0-8 0 4 4 0 1 0 8 0M22 21v-2a4 4 0 0 0-3-3.87",
  user: "M18 21a8 8 0 0 0-16 0M15 8a5 5 0 1 0-10 0 5 5 0 1 0 10 0M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  plus: "M5 12h14M12 5v14",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2",
  check: "M22 11.08V12a10 10 0 1 1-5.93-9.14M9 11l3 3L22 4",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  filter: "M3 6h18M7 12h10M10 18h4",
  cloud: "M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 12 4 4 0 0 0 6 19Z",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  shield: "M12 2 4 5v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V5Z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  x: "M18 6 6 18M6 6l12 12",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  sunrise: "M22 17a10 10 0 0 0-20 0M6 17v-1M18 17v-1M2 21h20",
  panel: "M3 3h18v18H3zM9 3v18",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2M12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z",
  note: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.16 3.19M6.6 6.6A17.6 17.6 0 0 0 2 12s3.5 7 10 7a9.1 9.1 0 0 0 3.1-.54M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20",
};

export function Icon({ name, size = 16, color = "currentColor", strokeWidth = 1.7 }: {
  name: keyof typeof PATHS | string; size?: number; color?: string; strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
