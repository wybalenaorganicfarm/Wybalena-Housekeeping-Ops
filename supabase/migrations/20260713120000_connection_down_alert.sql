-- Add a 'connection_down' alert type so the daily health-check can surface a
-- broken integration in the in-app Alerts queue (not just via email/WhatsApp).
alter type alert_type add value if not exists 'connection_down';
