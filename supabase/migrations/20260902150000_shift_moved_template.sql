-- shift_moved_by_admin — tells cleaners when a shift's date or time changes.
-- ============================================================================
-- The Edit Shift modal could not change a shift's DATE at all: the field wasn't
-- offered, and update-shift ignored shift_date even if it were sent. A booking
-- that moved to another day could only be fixed by deleting the shift and
-- rebuilding it by hand, which loses its link to the booking.
--
-- Now the date is editable — which means cleaners already on the shift have to
-- be told. Anyone who ACCEPTED is on a shift that just moved under them, and
-- anyone still holding an open OFFER was asked about one day and must not end up
-- answering for another.
--
-- Sent by update-shift when shift_date or start_time actually changes (comparing
-- against the stored value, so re-saving the modal untouched messages nobody).
insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'shift_moved_by_admin',
    'Replies & edge cases',
    'Shift date or time changed',
    'Sent to cleaners who accepted or were offered a shift when an admin changes its date or start time. Names both the old and the new time so the change is unambiguous.',
    E'The shift you were offered on {{old_shift_date}} at {{old_start_time}} has been moved to *{{shift_date}} at {{start_time}}*.\n\nYour response still stands for the new date — if that no longer suits, please let us know.',
    null, null, null, null,
    '[{"name":"shift_date","description":"New shift date, e.g. Saturday 5th September 2026"},{"name":"start_time","description":"New start time, e.g. 9:00am"},{"name":"old_shift_date","description":"Previous shift date"},{"name":"old_start_time","description":"Previous start time"}]'::jsonb,
    29
  )
on conflict (key) do nothing;

update public.message_templates
set defaults = jsonb_build_object(
  'body', body, 'header', header, 'footer', footer, 'fallback', fallback, 'buttons', buttons
)
where key = 'shift_moved_by_admin'
  and (defaults = '{}'::jsonb or defaults is null);
