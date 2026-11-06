ALTER TABLE domains ADD COLUMN IF NOT EXISTS provisioning_status TEXT NOT NULL DEFAULT 'pending' CHECK (provisioning_status IN ('pending','ready','failed'));
ALTER TABLE domains ADD COLUMN IF NOT EXISTS provisioning_error TEXT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS provisioning_state TEXT NOT NULL DEFAULT 'reconcile' CHECK (provisioning_state IN ('pending','ready','failed','reconcile'));
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS observed_quota_bytes BIGINT;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS observed_active BOOLEAN;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS used_bytes BIGINT;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS secret_ciphertext TEXT;
ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS lease_token UUID;
ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE provisioning_jobs SET status='failed',last_error='Tác vụ cũ chưa có thông tin khôi phục; cần đối soát trước khi thử lại.',updated_at=now() WHERE job_type='mailbox.provision' AND status IN ('queued','running') AND secret_ciphertext IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_pending_lease ON provisioning_jobs(status,next_attempt_at,lease_expires_at);
CREATE TABLE IF NOT EXISTS service_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE,
 mailbox_limit INTEGER NOT NULL CHECK(mailbox_limit BETWEEN 1 AND 100000),
 storage_gb INTEGER NOT NULL CHECK(storage_gb BETWEEN 1 AND 100000),
 mailbox_max_gb INTEGER NOT NULL CHECK(mailbox_max_gb BETWEEN 1 AND 1000),
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES service_plans(id);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT;
CREATE TABLE IF NOT EXISTS onboarding_progress (
 tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
 webmail_confirmed_at TIMESTAMPTZ, confirmed_by TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_heartbeats(name TEXT PRIMARY KEY,last_seen TIMESTAMPTZ NOT NULL);
