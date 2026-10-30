CREATE TABLE IF NOT EXISTS auth_failure_limits (
  limit_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_failure_limits_reset_at_idx ON auth_failure_limits(reset_at);
