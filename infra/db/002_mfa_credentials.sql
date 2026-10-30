CREATE TABLE IF NOT EXISTS mfa_credentials (
  account_key TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  tenant_id UUID,
  secret_ciphertext TEXT NOT NULL,
  enabled_at TIMESTAMPTZ,
  last_totp_counter BIGINT,
  recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
