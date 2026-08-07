-- ============================================================================
-- Mid-retreat cleans become a notification, not an automatic shift
-- ============================================================================
-- Long stays (>=7 nights) need a clean part-way through, but its date and crew
-- size are a judgement call the sync can't make well: the midpoint it computed
-- often fell outside the synced window, and a booking extended after its first
-- sync never gained one at all.
--
-- sync-bookings no longer creates that shift. It now raises this alert and
-- notifies the Operations Manager by email AND WhatsApp — the same shape as the
-- wipeover notice — and the shift is created by hand from the Shifts page.
--
-- Existing auto-created mid-retreat shifts are left untouched; this only changes
-- what happens from the next sync onward.
-- ============================================================================

alter type alert_type add value if not exists 'mid_retreat_needed';
