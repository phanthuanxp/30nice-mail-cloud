# CODEX MASTER BRIEF — 30NICE MAIL CLOUD (LOCAL FIRST)
Version: 1.0 | 2026-10-21 | Language: Vietnamese (user communication), code identifiers English

## Role / Working agreement
Act as principal engineer and implementation agent. Inspect the existing repo, scripts and machine prerequisites before making changes. The user wants a BUSINESS EMAIL HOSTING SaaS offering for both 30 NICE internal domains and paying third-party business tenants. Build and personalize it LOCALLY on Windows first. **No VPS deployment, DNS/MX changes, real email account provisioning, external customer communications, or production secret handling without explicit subsequent approval.** Never claim unrun tests passed. Ask only when blocked by credentials or destructive choices.

## Business goals
- Self-hosted multi-domain enterprise email platform with webmail, mailbox provisioning, quotas, aliases and lifecycle management.
- Two customer classes: owner-operated domains and external paying organizations.
- Super Admin manages tenants, nodes, capacities, plans, subscriptions, support and audit; Tenant Admin manages ONLY own domains/users/mailboxes; Mailbox User gets webmail.
- White-label brand: 30NICE Mail Cloud. Proposed routes (not registered DNS): mail.30nice.vn (webmail), portal.30nice.vn (customer portal), admin-mail.30nice.vn (super admin), api-mail.30nice.vn (API), mx1.30nice.vn (mail host). No actual DNS modification.
- Example eventual domains, never claim currently migrated: 30nice.vn, goforvietnam.com, sunfoodtaydo.com, chuyenphat24h.com, sanphamchinhhang.com; design for arbitrarily many domains. No credentials or real customer data included.

## Architecture decision
- Monorepo: Next.js TypeScript portal/admin, NestJS API, PostgreSQL, Redis/BullMQ, integration layer/mail adapter, optional Mailcow deployment at later integration stage.
- Mailcow reference: https://github.com/mailcow/mailcow-dockerized ; https://docs.mailcow.email/ ; GPL-3.0 review before modifications/distribution.
- Separation: SaaS control plane <> mail plane. Mail contents never copied into SaaS app DB. API credentials only server-side, encrypted secrets, no logs of passwords/tokens.
- Because local Windows machine may have just 8 GiB RAM, run lightweight mock mail adapter initially; Docker PostgreSQL/Redis optional. Do NOT demand full Mailcow locally when resource budget makes it unusable; use separate integration test environment when ready.
- Mail node isolation: multi-domain is NOT sufficient for tenant isolation. Enforce server-side tenant authorization at every endpoint and Mailcow adapter operation; avoid giving tenants full Mailcow admin API. Determine actual Mailcow capabilities and constraints rather than assume.
- Use isolated dev data with resettable seeds; production migration later via reproducible containers/migrations.

## Current starter (check, do not assume builds)
- `apps/portal` Next.js demo dashboard on localhost:3000.
- `apps/api` NestJS mock health endpoint on localhost:3001.
- `packages/mail-adapter` mock adapter skeleton.
- `infra/docker-compose.dev.yml` optional PostgreSQL and Redis (not wired yet).
- `README.md`, `docs/ARCHITECTURE.md`.
- The package has NOT been fully built or tested; initial install did not complete in the generation environment. Fix inconsistencies and document actual output.

## Sprint 0 - machine assessment and foundation (start here)
1. Inspect installed Node LTS/npm, Git, Docker Desktop/WSL2, free RAM, disk and ports 3000/3001/5432/6379 on Windows; report findings.
2. Examine repo source and dependency versions; set up `.env.example` without secrets; never commit `.env`.
3. Install dependencies (if machine permits), fix compilation/runtime issues, add scripts for lint/typecheck/tests, establish workspace conventions and formatting.
4. Start Next.js/NestJS locally, validate `/health`, show screenshots or observed UI if available; report exact commands and PASS/FAIL, do not guess.
5. Configure local Postgres/Redis only if resources allow; make app gracefully handle missing optional infra during mock mode.
6. Produce `docs/LOCAL_SETUP_WINDOWS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/TEST_REPORT.md` with verified results.

## Sprint 1 - SaaS foundations
- Data model: tenants, tenant_members, domains, domain_verifications, mailboxes, aliases, mail_nodes, domain_assignments, plans, plan_prices, subscriptions, invoices, payments, support_tickets, provisioning_jobs, audit_logs.
- Backend auth and MFA plan; role matrix for super_admin/tenant_admin/mailbox_user. Tenant scoping across GET/POST/PATCH/DELETE. Central audit logs. Avoid exposing sensitive content in audit records.
- Tenant CRUD + member management; domain ownership TXT challenge (local simulated initially), mailbox CRUD mock with quota enforcement.
- REST/OpenAPI API contract; robust input validation, authorization checks, request id, pagination.
- Provisioning queue, idempotency for webhook/provisioning, retries, reconciliation, dead-letter handling.
- Write automated cross-tenant negative tests, ownership uniqueness tests and race/idempotency tests.

## Sprint 2 - customer product
- Responsive mobile-first branded Admin and Portal: Dashboard, Organizations, Domains, Mailboxes, Aliases, Plans, Billing, Nodes, Monitoring, Support, Settings.
- Customer onboarding flow from sign-up to verified domain to mailbox to webmail link.
- Domain DNS setup assistant for MX/SPF/DKIM/DMARC (show proposed DNS; no real DNS changes automatically).
- Billing simulation only; sample initial prices (hypotheses, not approved/live): Starter 29,000 VND/user/month 5 GB, Business 49,000 VND/user/month 15 GB, Premium 89,000 VND/user/month 30 GB. Make pricing admin-configurable, never hard-code as contract.
- Customers should be able to see invoices and renewal states; test payment webhook replay/suspension grace period in sandbox.

## Sprint 3 - real mail integration (only after separate explicit approval)
- Keep adapter interface independent of provider. Build Mailcow API adapter with dry-run first and strict mapping tenant -> owned domain -> mailbox.
- Test Mailcow on disposable environment with no production DNS, no customer mail and no secrets in chat/repo.
- Test create/update/disable mailbox; quotas; alias; password reset workflow; mailbox ownership constraints; error reconciliation.
- SMTP delivery, port 25 egress/ingress, static public IP, PTR, MX, SPF, DKIM, DMARC, TLS, blocklists, queue abuse controls can only be fully tested on provisioned public mail host/staging later. Do not claim completed in local.

## Deployment gates (not current task)
- Security: per-tenant auth isolation, MFA, brute-force controls, CSRF/CORS design, input validation, audit, encrypted backups, dependency audit, secrets management.
- Delivery: test Gmail/Outlook deliverability, DNS records, reverse DNS, outbound limits, anti-abuse, IP reputation.
- Resilience: external encrypted backups + restore drills, RPO target 24 h initially (aspire 4 h), RTO target 8 h; validate with drills before offering SLA.
- Compliance: legal review for Vietnam service provision and data protection (including personal data handling), agreements, breach response, retention/deletion and cross-border hosting.
- No production migration until owner approves.

## Suggested folder growth
apps/admin (or role based routes in portal), apps/portal, apps/api;
packages/ui, packages/database, packages/mail-adapter, packages/contracts, packages/billing;
infra/docker, infra/mailcow (future), tests/e2e, docs.
Do not duplicate two frontends without a clear UX/operations reason.

## Working and reporting rules
- Start by reading the starter README, packages and actual files, not presuming features exist.
- Small commits/milestones and reversible migrations. Never delete unrelated user work.
- At end of each milestone report: files changed; commands run; tests/build result (verified); localhost endpoints; actual working features; known blockers; next smallest task.
- Keep UX text Vietnamese by default, English technical identifiers. No unapproved VPS, GitHub push, secrets, paid provider actions, real domain changes.

## Immediate next action
Execute Sprint 0 audit on the extracted local repo; do not start mail server deployment. If unable to run commands, provide precise diagnostics and fix code/config that can be inspected. Only proceed to Sprint 1 once local starter builds/starts correctly.
