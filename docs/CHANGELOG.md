# Changelog

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
