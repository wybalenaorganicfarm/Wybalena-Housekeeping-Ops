-- Mid-retreat cleans are notified by EMAIL ONLY (requested Aug 2026).
-- mid-retreat-notify no longer sends a WhatsApp digest, so this template can
-- never fire. Removing the row keeps the Templates page honest: an editable
-- template that sends nothing is worse than no template at all, because the
-- manager can spend time wording a message that will never be delivered.
--
-- Wipeover was already email-only and never had a WhatsApp template.
delete from public.message_templates where key = 'mid_retreat_whatsapp';
