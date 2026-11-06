CREATE TABLE IF NOT EXISTS webmail_sessions (
 token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,secret_ciphertext TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webmail_session_email ON webmail_sessions(email);
CREATE INDEX IF NOT EXISTS idx_webmail_session_expiry ON webmail_sessions(expires_at);
CREATE TABLE IF NOT EXISTS account_session_revocations(account_key TEXT PRIMARY KEY,revoked_before TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS webmail_preferences(email TEXT PRIMARY KEY,signature_html TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS domain_webmail_logins(domain_id UUID PRIMARY KEY REFERENCES domains(id) ON DELETE CASCADE,last_login_at TIMESTAMPTZ NOT NULL,mailbox_email TEXT NOT NULL);
