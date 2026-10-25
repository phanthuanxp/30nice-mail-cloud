# Decisions

- Keep the control plane and mail plane separate; Sprint 0 uses the mock adapter only.
- Keep PostgreSQL/Redis optional until a real persistence boundary and migrations exist.
- Use one portal codebase for admin/tenant experiences rather than duplicating frontends.
- Treat all demo tenant/domain/mailbox counts as non-production fixtures.
- Do not perform VPS, DNS, MX, real mailbox, customer communication, or production secret actions in local-first work.
