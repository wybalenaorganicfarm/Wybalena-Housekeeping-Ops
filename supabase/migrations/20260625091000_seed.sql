-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 12
-- Seed / test data (idempotent, fixed UUIDs)
-- ============================================================================
-- TEST DATA — safe to delete once real data flows. Covers cleaners (incl. Zara
-- as the team-leader "+1"), one >=7-night booking -> 2 shifts (standard +
-- mid_retreat), one short booking -> 1 shift, assignments across statuses, and
-- a couple of alerts. Enough to validate end to end.
--
-- NOTE: app-user profiles (Julian/Ashley/Zara-login) are NOT seeded here —
-- auth users must be created via GoTrue (admin API) so passwords + identities
-- are correct; the handle_new_user trigger then auto-creates their profiles.
-- See the bootstrap commands in the build notes.
--
-- confirmed_by / actioned_by are left null in seed (they reference profiles,
-- which are created during bootstrap).
-- ============================================================================

-- --- Cleaners -----------------------------------------------------------------
-- Zara is the team leader (the "+1"). 6 more across the 3 tiers for testing.
insert into public.cleaners (id, full_name, phone, email, tier, is_active, is_team_leader) values
  ('c0000000-0000-0000-0000-000000000001', 'Zara Thompson',   '+61400000001', 'zara@example.com',   'tier_1', true, true),
  ('c0000000-0000-0000-0000-000000000002', 'Maya Kelly',      '+61400000002', null,                 'tier_1', true, false),
  ('c0000000-0000-0000-0000-000000000003', 'Tom Nguyen',      '+61400000003', null,                 'tier_1', true, false),
  ('c0000000-0000-0000-0000-000000000004', 'Priya Desai',     '+61400000004', null,                 'tier_2', true, false),
  ('c0000000-0000-0000-0000-000000000005', 'Jordan Lee',      '+61400000005', null,                 'tier_2', true, false),
  ('c0000000-0000-0000-0000-000000000006', 'Sofia Oliveira',  '+61400000006', null,                 'tier_3', true, false),
  ('c0000000-0000-0000-0000-000000000007', 'Riley Harris',    '+61400000007', null,                 'tier_3', true, false)
on conflict (id) do nothing;

-- --- Bookings -----------------------------------------------------------------
-- B1: 8-night retreat (>=7) -> 2 shifts. B2: 3-night stay (<7) -> 1 shift.
insert into public.bookings (id, gcal_event_id, guest_name, check_in, check_out, nights, guest_count) values
  ('b0000000-0000-0000-0000-000000000001', 'gcal_seed_event_001', 'Harmon Wedding Party', '2026-07-27 15:00+10', '2026-08-04 10:00+10', 8, 24),
  ('b0000000-0000-0000-0000-000000000002', 'gcal_seed_event_002', 'Okafor Family',        '2026-07-29 15:00+10', '2026-08-01 10:00+10', 3, 8)
on conflict (gcal_event_id) do nothing;

-- --- Shifts -------------------------------------------------------------------
-- From B1 (>=7 nights): standard clean + mid_retreat clean (required 6 each).
-- From B2 (<7 nights):  one standard clean.
insert into public.shifts (id, booking_id, shift_type, shift_date, start_time, estimated_hours, status, source, required_cleaners, current_tier) values
  ('50000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'standard',    '2026-08-04', '10:00', 4, 'staffing',            'auto', 6, 'tier_1'),
  ('50000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'mid_retreat', '2026-07-31', '10:00', 4, 'pending_confirmation','auto', 6, null),
  ('50000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'standard',    '2026-08-01', '10:00', 4, 'pending_confirmation','auto', 6, null)
on conflict (id) do nothing;

-- --- Shift assignments --------------------------------------------------------
-- Shift 1 is in Tier-1 staffing: a few accepted, one offered (no response yet),
-- one declined. Drives the shift_staffing + cleaner_reliability views.
insert into public.shift_assignments (id, shift_id, cleaner_id, tier_at_offer, status, responded_at) values
  ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'tier_1', 'accepted', now() - interval '2 hours'),
  ('a0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'tier_1', 'accepted', now() - interval '90 minutes'),
  ('a0000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'tier_1', 'offered',  null),
  ('a0000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'tier_1', 'declined', now() - interval '1 hour')
on conflict (id) do nothing;

-- --- Alerts -------------------------------------------------------------------
insert into public.alerts (id, alert_type, shift_id, booking_id, status, title, body) values
  ('41000000-0000-0000-0000-000000000001', 'understaffed_urgent', '50000000-0000-0000-0000-000000000001', null,
     'open', 'Tier 3 reached — understaffed', 'Full venue clean still has open spots after tier escalation. Needs manual intervention.'),
  ('41000000-0000-0000-0000-000000000002', 'venue_gap', null, null,
     'open', 'Venue gap > 3 days', '2-6 Jul has no clean scheduled. Plan an extra clean?')
on conflict (id) do nothing;
