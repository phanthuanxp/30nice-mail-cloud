CREATE TABLE IF NOT EXISTS member_invitations(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,invited_by TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_invitation_tenant ON member_invitations(tenant_id,created_at DESC);
