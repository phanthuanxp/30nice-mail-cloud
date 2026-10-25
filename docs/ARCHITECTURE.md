# 30NICE Mail Cloud — Architecture v0.1

## Architecture
- SaaS control plane: Next.js customer/admin UI, NestJS API, PostgreSQL, Redis/BullMQ (later).
- Mail plane: Mailcow, **not included or started in this local starter**.
- Adapter contracts live in `packages/mail-adapter`.
- Multi-tenant DB access must enforce `tenant_id` server-side; never accept a client-supplied tenant id as authorization.
- Provisioning jobs must be idempotent and audit logged.

## Domain model planned
`tenants`, `tenant_members`, `domains`, `domain_verifications`, `mailboxes`, `mail_nodes`, `domain_assignments`, `plans`, `subscriptions`, `invoices`, `payments`, `provisioning_jobs`, `audit_logs`.

## Security gates before real email
1. Authentication with MFA and server-side RBAC (super admin vs tenant admin vs mailbox user).
2. Tenant isolation integration tests; domain ownership verified via DNS challenge.
3. Mailcow admin API keys **only server-side**, per-environment secrets.
4. Queue with idempotency and rate limits; abuse prevention and outbound caps.
5. Backup/restore drills; safe migrations; observability and queue/blacklist alerts.
6. External staging required to validate SMTP port 25, PTR, MX, SPF, DKIM, DMARC and reputation.
7. Legal/regulatory review before selling hosting services.

## Local milestone
UI demo is intentionally seeded with **illustrative values**; it is not a working billing, authentication or mailbox system. No mail is sent.
