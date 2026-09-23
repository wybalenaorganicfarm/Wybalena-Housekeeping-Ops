// Design tokens ported from the approved Wybalena design (Option 2).
export const c = {
  sand: "#F7F5F0",
  panel: "#FBFAF7",
  rail: "#fbfaf6",
  green: "#1F4D3A",
  greenHover: "#19402f",
  greenMid: "#3D8B5F",
  teal: "#2f7068",
  ink: "#1E2622",
  body: "#3c453f",
  muted: "#6B7770",
  muted2: "#8a8478",
  faint: "#a39d91",
  border: "#E8E6E0",
  border2: "#ece8e0",
  border3: "#ddd9cf",
  cardBorder: "#ece8df",
  danger: "#C0392B",
  dangerBg: "#fbeae8",
  warn: "#C8821A",
  railGreenBg: "#EEF3EF",
  railGreenBd: "#d9e4dc",
  // table / list design tokens
  chipBd: "#e4ded3",
  tableHead: "#FBFAF7",
  sectionBg: "#EEF3EF",
  sectionBd: "#d9e4dc",
  rowBd: "#efece4",
  body2: "#5d665f",
  // team-lead slot: distinct from accepted (green) / offered (amber) / open (grey)
  lead: "#5E6AC4",
  leadBg: "#ECEEFB",
  leadFg: "#3B44A0",
} as const;

export const font = {
  // Headers / display text are Inter too — the only difference is weight.
  display: "'Inter', sans-serif",
  body: "'Inter', sans-serif",
  // Weight for headers and display text, in place of the old display typeface.
  displayWeight: 800,
};

// Status -> badge styling
export const STATUS = {
  // Pending → yellow · Scheduled/Accepted → green · Staffing → purple · Cancelled → grey
  pending_confirmation: { label: "Pending", dot: "#C8821A", bg: "#fdf4e3", fg: "#9a6512" },
  confirmed: { label: "Scheduled", dot: "#3D8B5F", bg: "#eaf4ee", fg: "#256b43" },
  staffing: { label: "Staffing", dot: "#8257c5", bg: "#f2ecfb", fg: "#5b3fa0" },
  fully_staffed: { label: "Accepted", dot: "#3D8B5F", bg: "#eaf4ee", fg: "#256b43" },
  cancelled: { label: "Cancelled", dot: "#a39d91", bg: "#f0eee9", fg: "#6b665c" },
} as const;

// Calendar event styling — the two colours that tell the month grid apart at a
// glance: bookings GREEN, shifts PURPLE. One source of truth, referenced by both
// the ShiftCalendar (Dashboard + Shifts tabs) and the Bookings-tab
// BookingCalendar. `cancelledBg/Fg/Dot` mute a cancelled stay.
export const BOOKING = {
  dot: c.greenMid,     // left-border accent (matches the sidebar/brand green family)
  bg: "#e7f0ed",
  fg: "#21564b",
  cancelledDot: "#a39d91",
  cancelledBg: "#f0eee9",
  cancelledFg: "#6b665c",
} as const;

// Shifts in a CALENDAR are always purple, whatever their status. The STATUS map
// above is green for both `confirmed` and `fully_staffed`, which made shift bars
// indistinguishable from the green booking bars sitting right next to them — the
// status is still carried by the darker left-border accent and the tooltip, and
// the list/table views keep the full status palette.
// Deliberately a deeper purple than STATUS.staffing's `#f2ecfb`: that tint has
// the SAME luminance as the booking green, so the two bars separated by hue
// alone — invisible to anyone with a colour-vision deficiency, and washy for
// everyone else. This one is a clear brightness step darker as well as purple.
export const SHIFT_EVENT = {
  dot: "#6d3fb8",      // purple accent, darker than the STATUS.staffing dot
  bg: "#ddcef3",
  fg: "#4b2f8a",
  cancelledDot: "#a39d91",
  cancelledBg: "#f0eee9",
  cancelledFg: "#6b665c",
} as const;

export const SHIFT_TYPE_LABEL: Record<string, string> = {
  standard: "Standard Clean",
  deep_full_venue: "Deep Clean",
  mid_retreat: "Mid-Retreat Clean",
  wipeover: "Wipeover Clean",
  other: "Other",
};

export const TIER_LABEL: Record<string, string> = {
  tier_1: "Tier 1",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
};

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Owner",
  operations_manager: "Retreat Director",
  team_leader: "Cleaning Manager",
};

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}
