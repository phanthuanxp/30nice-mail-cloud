BEGIN;
SET LOCAL lock_timeout = '5s';
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='webmail_send_limits' AND column_name='minute_window')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='webmail_send_limits' AND column_name='minute_window_start') THEN
    ALTER TABLE public.webmail_send_limits RENAME COLUMN minute_window TO minute_window_start;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='webmail_send_limits' AND column_name='hour_window')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='webmail_send_limits' AND column_name='hour_window_start') THEN
    ALTER TABLE public.webmail_send_limits RENAME COLUMN hour_window TO hour_window_start;
  END IF;
END
$migration$;
COMMIT;
