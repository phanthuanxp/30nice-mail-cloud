# Test report

## PASS

- `npm install --no-audit --no-fund` — completed; 382 packages added.
- `npm run build` — Next.js production build completed successfully.
- `npm run build:api` — NestJS compilation completed successfully.
- `npm run typecheck` — TypeScript checks completed successfully after Sprint 0 scripts were added.
- Sprint 1 API foundation — typecheck, API build and Portal build completed successfully.

## PARTIAL / BLOCKED

- Shell HTTP checks to localhost were blocked by the Windows runner with socket access denied.
- Browser opening of localhost timed out after the transient dev sessions were reclaimed by the runner; the app build itself passed.
- WSL2 status returned `WSL/E_ACCESSDENIED`; Docker availability is recorded, but the optional compose services were not started.

## Scope confirmation

The original local-first phase did not change DNS/MX or handle production secrets. A later explicit deployment approval enabled the VPS integration; the current production health check confirms Mailcow is connected. End-to-end real email delivery and external provider deliverability are not claimed without dedicated tests.

## Production integration verification (2026-10-27)

- `npm run typecheck` — PASS for Portal and API.
- `npm run build` and `npm run build:api` — PASS.
- VPS `GET /health` — PASS: `productionReady:true`, PostgreSQL connected, Mailcow configured/healthy with HTTP 200.
- `https://admin.30nice.vn` — PASS: HTTP 200 after PM2 restart.
- GitHub/VPS deployment — PASS at commit `be8098e`.
- Mailcow create/update mailbox calls are server-side and use bounded request timeouts; destructive delivery and Gmail/Outlook deliverability tests remain unverified.

## Sprint 1 limitation

The new CRUD surface uses resettable in-memory fixtures. PostgreSQL persistence, authentication and full tenant-member RBAC remain the next implementation step; this deployment is not a production email control plane yet.

RBAC smoke checks: unscoped tenant listing is denied; tenant-admin listing is scoped; audit endpoint requires `super_admin`.
