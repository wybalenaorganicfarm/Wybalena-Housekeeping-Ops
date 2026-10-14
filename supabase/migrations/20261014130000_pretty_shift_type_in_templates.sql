-- ============================================================================
-- Clean-type labels now render in full ("Standard Clean", "Deep Clean", …)
-- everywhere a message is built — the edge functions were passing the raw enum
-- ("standard") into a couple of templates; that is now fixed to go through
-- prettyType(), matching the rest of the app.
--
-- Two seeded template bodies wrote "{{shift_type}} clean" on the assumption the
-- variable held a bare word ("standard"). Now that {{shift_type}} already expands
-- to "Standard Clean", that literal trailing " clean" would read as
-- "Standard Clean clean". This strips the redundant word.
--
-- It is a targeted replace, not a full-body overwrite, so any OTHER wording the
-- venue has edited on these templates is preserved; it only collapses the exact
-- "{{shift_type}} clean" phrase, and is a no-op if the phrase is no longer present
-- (e.g. already reworded). Safe to run regardless of prior customisation.
-- ============================================================================

update public.message_templates
set body = replace(body, '{{shift_type}} clean', '{{shift_type}}')
where body like '%{{shift_type}} clean%';
