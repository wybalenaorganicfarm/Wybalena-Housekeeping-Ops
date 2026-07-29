-- ============================================================================
-- Cleaner-facing messages now render dates and times in full — {{shift_date}}
-- becomes "Sunday 23rd August 2026" and {{start_time}} becomes "10:00am" —
-- rather than the raw 2026-08-23 / 10:00 stored on the shift. Update the
-- variable hints on the Message Templates page so they show the real output.
-- Only the hints change; every template body is left exactly as the admin has it.
-- ============================================================================

update public.message_templates
set variables = (
  select jsonb_agg(
    case
      when v->>'name' = 'shift_date'
        then jsonb_build_object('name', 'shift_date', 'description', 'Shift date, e.g. Sunday 23rd August 2026')
      when v->>'name' = 'start_time'
        then jsonb_build_object('name', 'start_time', 'description', 'Start time, e.g. 10:00am')
      else v
    end
    order by ord
  )
  from jsonb_array_elements(variables) with ordinality as t(v, ord)
)
where variables @> '[{"name":"shift_date"}]'::jsonb
   or variables @> '[{"name":"start_time"}]'::jsonb;
