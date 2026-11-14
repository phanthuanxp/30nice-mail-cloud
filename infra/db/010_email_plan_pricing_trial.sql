ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS price_vnd integer CHECK (price_vnd >= 0);
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS billing_period text CHECK (billing_period IN ('month', 'year'));
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS trial_days integer CHECK (trial_days > 0);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS trial_restore_domain boolean;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS trial_restore_mailboxes text[];

INSERT INTO service_plans(name, mailbox_limit, storage_gb, mailbox_max_gb, price_vnd, trial_days)
VALUES ('Email Free', 1, 1, 1, 0, 30)
ON CONFLICT (name) DO NOTHING;
