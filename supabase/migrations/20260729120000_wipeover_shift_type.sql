-- ============================================================================
-- "Wipeover" clean type.
-- The >3-day venue-gap job (wipeover-notify) alerts + emails Ashleigh that a
-- wipeover clean is needed, but there was no matching shift type to create it
-- with — admins had to file it as "Standard". Add the enum value so Wipeover is
-- selectable on the New/Edit shift forms.
-- ============================================================================

-- Listed before 'other' so it reads as a real clean type, not a catch-all.
-- Safe inside a transaction: the value is added here and first *used* later.
alter type shift_type add value if not exists 'wipeover' before 'other';
