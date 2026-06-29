-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 11
-- Indexes (Spec Section 8)
-- ============================================================================
-- bookings(gcal_event_id) is already unique from the bookings table definition.

create index idx_shifts_status                on public.shifts (status);
create index idx_shifts_shift_date            on public.shifts (shift_date);

create index idx_shift_assignments_shift_id   on public.shift_assignments (shift_id);
create index idx_shift_assignments_cleaner_id on public.shift_assignments (cleaner_id);
create index idx_shift_assignments_status     on public.shift_assignments (status);

create index idx_alerts_status                on public.alerts (status);
