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

No DNS/MX change, real mailbox provisioning, real email sending, or production secret handling was performed. The previously approved demo deployment is on the VPS; Mailcow remains disconnected.

## Sprint 1 limitation

The new CRUD surface uses resettable in-memory fixtures. PostgreSQL persistence, authentication and full tenant-member RBAC remain the next implementation step; this deployment is not a production email control plane yet.

RBAC smoke checks: unscoped tenant listing is denied; tenant-admin listing is scoped; audit endpoint requires `super_admin`.
