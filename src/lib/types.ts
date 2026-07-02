// Hand-written DB types matching the Supabase schema. (Can be regenerated later
// with `supabase gen types typescript`.)
export type UserRole = "super_admin" | "admin" | "operations_manager" | "team_leader";
export type UserStatus = "invite_sent" | "active" | "away" | "inactive";
export type CleanerTier = "tier_1" | "tier_2" | "tier_3";
export type CleanerStatus = "active" | "away" | "inactive";
export type ShiftType = "standard" | "deep_full_venue" | "mid_retreat" | "other";
export type ShiftStatus =
  | "pending_confirmation" | "confirmed" | "staffing" | "fully_staffed" | "cancelled";
export type ShiftSource = "auto" | "manual";
export type VenueScope = "full_venue" | "partial_venue";
export type AssignmentStatus =
  | "offered" | "accepted" | "declined" | "cancelled" | "no_response" | "team_lead";
export type AlertType =
  | "venue_gap" | "unconfirmed_shifts" | "booking_cancelled" | "understaffed_urgent" | "cleaner_cancelled";
export type AlertStatus = "open" | "actioned" | "dismissed";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface Cleaner {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  tier: CleanerTier;
  is_active: boolean;
  status: CleanerStatus;
  is_team_leader: boolean;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  gcal_event_id: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  guest_count: number | null;
  is_cancelled: boolean;
  created_at: string;
}

export interface Shift {
  id: string;
  booking_id: string | null;
  shift_type: ShiftType;
  shift_date: string;
  start_time: string;
  estimated_hours: number;
  status: ShiftStatus;
  source: ShiftSource;
  required_cleaners: number;
  venue_scope: VenueScope;
  buildings: string[];
  is_modified: boolean;
  special_instructions: string | null;
  special_instructions_by: string | null;
  special_instructions_at: string | null;
  current_tier: CleanerTier | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface CleanerNote {
  id: string;
  cleaner_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface ShiftAssignment {
  id: string;
  shift_id: string;
  cleaner_id: string;
  tier_at_offer: CleanerTier;
  status: AssignmentStatus;
  offered_at: string;
  responded_at: string | null;
  is_manual_override: boolean;
  offer_code: string | null;
}

export interface Alert {
  id: string;
  alert_type: AlertType;
  shift_id: string | null;
  booking_id: string | null;
  status: AlertStatus;
  title: string;
  body: string | null;
  created_at: string;
}

export type AuditStatus = "success" | "failed" | "skipped" | "warning";
export type AuditTrigger = "cron" | "webhook" | "manual" | "system";

export interface AuditLog {
  id: string;
  event_type: string;
  event_label: string;
  status: AuditStatus;
  summary: string;
  detail: Record<string, unknown> | null;
  error_message: string | null;
  source: string;
  shift_id: string | null;
  booking_id: string | null;
  cleaner_id: string | null;
  triggered_by: AuditTrigger;
  created_at: string;
}

// Audit log joined with the human-readable entity bits the UI resolves UUIDs to.
export interface AuditLogResolved extends AuditLog {
  shift?: { shift_date: string; shift_type: ShiftType } | null;
  booking?: { guest_name: string | null; check_in: string; check_out: string } | null;
  cleaner?: { full_name: string } | null;
}

export interface ShiftStaffing {
  shift_id: string;
  required_cleaners: number;
  accepted_count: number;
  offered_count: number;
  lead_count: number;
  open_count: number;
}

export interface CleanerReliability {
  cleaner_id: string;
  full_name: string;
  tier: CleanerTier;
  accepted_count: number;
  declined_count: number;
  cancelled_count: number;
}

// Minimal Database shape for the typed client.
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      cleaners: { Row: Cleaner; Insert: Partial<Cleaner>; Update: Partial<Cleaner> };
      bookings: { Row: Booking; Insert: Partial<Booking>; Update: Partial<Booking> };
      shifts: { Row: Shift; Insert: Partial<Shift>; Update: Partial<Shift> };
      shift_assignments: { Row: ShiftAssignment; Insert: Partial<ShiftAssignment>; Update: Partial<ShiftAssignment> };
      cleaner_notes: { Row: CleanerNote; Insert: Partial<CleanerNote>; Update: Partial<CleanerNote> };
      alerts: { Row: Alert; Insert: Partial<Alert>; Update: Partial<Alert> };
      audit_logs: { Row: AuditLog; Insert: Partial<AuditLog>; Update: Partial<AuditLog> };
    };
    Views: {
      shift_staffing: { Row: ShiftStaffing };
      cleaner_reliability: { Row: CleanerReliability };
    };
  };
}
