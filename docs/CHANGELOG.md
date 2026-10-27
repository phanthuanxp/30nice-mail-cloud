# Changelog

## 2026-10-28 — Framework security and webmail runtime

- Upgrade NestJS to 12.3.2, Next.js to 16.4.3 and TypeScript to 6.0.3; move the mail-host rewrite from the deprecated middleware entry point to Next.js `proxy.ts`.
- Update the TypeScript configuration for the new compiler and Next.js generated route types.
- Confirm the production dependency audit and full dependency audit both report zero vulnerabilities in the staging checkout.
- Confirm API/portal builds, workspace typechecks and the Mailcow adapter smoke test pass in staging.

## 2026-10-28 — Mailbox provisioning reliability

- Convert mailbox quotas from the control plane's GB unit to Mailcow's API unit; reject fractional or out-of-range quota values.
- Treat both Mailcow `danger` and `error` responses as failed operations.
- Record provisioning jobs before calling Mailcow, retain failed-job details, and roll back control-plane mailbox rows when provisioning fails.
- Update the control-plane mailbox record before Mailcow changes and restore the previous values if Mailcow rejects the update.
- API TypeScript typecheck and production build pass.

## 2026-10-21 — Sprint 0

- Installed workspace dependencies.
- Added root `typecheck` and `test` scripts plus package typecheck scripts.
- Created local Windows setup and decision records.
- Verified portal and API production builds.
- Started local dev commands; persistent browser verification remains constrained by the Windows runner socket/process isolation.
- Moved the local Portal from port 3000 to 3002 because Windows denied binding to port 3000; API remains on 3001.

## 2026-10-25 — Sprint 1 foundation slice

- Added tenant-scoped API endpoints for tenants, domains and mailboxes.
- Added cross-tenant denial checks, domain uniqueness, mailbox quota validation and request IDs.
- Added in-memory audit records and explicit production-safe mock health metadata.
- Data is intentionally in-memory until PostgreSQL migrations are introduced; restart resets fixtures.
- Restricted tenant listing and audit log access by role; tenant admins can only list their scoped tenant.
- Added PostgreSQL/Redis production compose foundation and initial relational schema migration; not enabled for the API until a controlled data migration step.

## 2026-10-27 — Production integration milestones

- Added server-side session authentication, tenant-scoped authorization and tenant member provisioning.
- Connected the API to PostgreSQL and Mailcow production through server-only credentials; no Mailcow key is sent to the browser.
- Added domain/mailbox provisioning, DNS health checks and mailbox update/disable synchronization with Mailcow.
- Added Vietnamese control-plane login, domain/DNS wizard, member management and mailbox management UI.
- Verified GitHub commit `be8098e` on VPS: API health reports `productionReady: true`, PostgreSQL connected and Mailcow HTTP 200.

