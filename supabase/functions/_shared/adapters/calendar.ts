// Calendar adapter — Google Calendar (booking sync, read-only).
// THIN + SWAPPABLE. Scope: calendar.readonly.
//
// ── SWAP POINT ───────────────────────────────────────────────────────────────
// Stubbed: returns an empty list until Google creds are set. To go live, provide
// an OAuth access token with scope `calendar.readonly` (or a service account
// with domain-wide delegation) and the fetch below runs.
//
// Env:
//   GOOGLE_CALENDAR_ID        — the bookings calendar id
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN — see google.ts
import { getGoogleAccessToken, googleConfigured } from "./google.ts";

export interface CalendarBooking {
  gcalEventId: string;
  guestName: string | null;
  checkIn: string; // ISO
  checkOut: string; // ISO
  nights: number;
  guestCount: number | null;
  raw: unknown;
  cancelled: boolean; // true when the event is marked cancelled/removed
}

export interface HealthResult {
  name: string;
  configured: boolean;
  ok: boolean;
  detail: string;
}

// Read-only connection probe — reads calendar metadata (calendars.get).
// Does NOT modify or create anything. configured:false when creds are absent.
export async function checkHealth(): Promise<HealthResult> {
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  if (!calendarId || !googleConfigured()) {
    return { name: "google_calendar", configured: false, ok: false, detail: "GOOGLE_CALENDAR_ID / GOOGLE_* OAuth creds not set" };
  }
  const token = await getGoogleAccessToken();
  if (!token) {
    return { name: "google_calendar", configured: true, ok: false, detail: "refresh-token exchange failed" };
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return {
      name: "google_calendar",
      configured: true,
      ok: res.ok,
      detail: res.ok ? "calendar readable, token valid" : `HTTP ${res.status}: ${await res.text()}`,
    };
  } catch (e) {
    return { name: "google_calendar", configured: true, ok: false, detail: String(e) };
  }
}

// Fetch events overlapping [timeMin, timeMax] (ISO strings, UTC).
export async function fetchBookings(
  timeMin: string,
  timeMax: string,
): Promise<CalendarBooking[]> {
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  const token = await getGoogleAccessToken();

  // ── SWAP POINT: stub until creds exist ─────────────────────────────────────
  if (!calendarId || !token) {
    console.log(`[calendar:STUB] fetchBookings ${timeMin} .. ${timeMax} -> []`);
    return [];
  }

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("showDeleted", "true"); // so we can detect cancellations
  url.searchParams.set("orderBy", "startTime");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error(`[calendar] fetch failed ${res.status}: ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return (data.items ?? []).map((ev: Record<string, unknown>): CalendarBooking => {
    const start = (ev.start as Record<string, string>)?.dateTime ??
      (ev.start as Record<string, string>)?.date ?? "";
    const end = (ev.end as Record<string, string>)?.dateTime ??
      (ev.end as Record<string, string>)?.date ?? "";
    const nights = start && end
      ? Math.max(
        1,
        Math.round(
          (new Date(end).getTime() - new Date(start).getTime()) / 86400000,
        ),
      )
      : 0;
    return {
      gcalEventId: String(ev.id ?? ""),
      guestName: (ev.summary as string) ?? null,
      checkIn: start,
      checkOut: end,
      nights,
      guestCount: null,
      raw: ev,
      cancelled: ev.status === "cancelled",
    };
  });
}
