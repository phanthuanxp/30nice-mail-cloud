# Verification report

## Verified on 2026-10-30

GitHub Actions **Verify Mail Cloud** passed on main commit `8e499ef303c9a95ecae6362e660c75ef09bec4ee` (run `41034751717`). It ran:

- Locked dependency installation and TypeScript checks for API and portal.
- Authentication/MFA/RBAC, mailbox and tenant provisioning smoke tests.
- Mailcow adapter smoke tests.
- Webmail content, BCC, contacts, search, send limits, cross-instance login limits and Trash deletion smoke tests.
- Next.js portal production build and Bash syntax check for the guarded VPS release script.

Main CI and the manual production release workflow now both run `npm audit --omit=dev`. It passed on main commit `a549fb8d5adc3b1f249bed3bb71e682122f86740` on 2026-10-30. This covers runtime dependencies only; a full audit including development/build dependencies has not been verified.

## Production and deployment status

- The latest directly recorded VPS health and deployment check in the prior report was 2026-10-27 at commit `be8098e`. It reported API health, PostgreSQL, Mailcow and the admin site responding at that time. That is historical evidence and does not verify current production.
- A guarded, manual-only GitHub Actions release workflow was merged at commit `fc8dca0`. It targets the existing PM2 paths, checks the selected main revision, runs verification, enforces SSH host-key checking, and performs local/public health checks after deploy.
- No `workflow_dispatch` deployment run is recorded as of 2026-10-30. The current production revision and live health have therefore not been verified from this workflow. GitHub's `production` environment, reviewer and SSH secrets must be configured before a release can run; see [VPS release runbook](VPS_RELEASE_RUNBOOK.md).
- The web tool could not access `https://admin.30nice.vn/api/health` during this review.

## Scope and remaining verification

- CI smoke tests validate application behavior using test doubles where external Mailcow, IMAP, SMTP, PostgreSQL or VPS services are not contacted. Green CI does not prove external mail delivery, inbox placement, production mailbox provisioning, or current VPS health.
- Gmail/Outlook deliverability, SMTP port 25 behavior, backups and restore drills, operational monitoring/alerting, billing and legal readiness still require separate verification.
- The Windows local setup and running-site observations in older reports are historical; they were not repeated in this CI run.
