# Test report

## PASS

- `npm install --no-audit --no-fund` — completed; 382 packages added.
- `npm run build` — Next.js production build completed successfully.
- `npm run build:api` — NestJS compilation completed successfully.
- `npm run typecheck` — TypeScript checks completed successfully after Sprint 0 scripts were added.

## PARTIAL / BLOCKED

- Shell HTTP checks to localhost were blocked by the Windows runner with socket access denied.
- Browser opening of localhost timed out after the transient dev sessions were reclaimed by the runner; the app build itself passed.
- WSL2 status returned `WSL/E_ACCESSDENIED`; Docker availability is recorded, but the optional compose services were not started.

## Scope confirmation

No VPS deployment, DNS/MX change, real mailbox provisioning, real email sending, or production secret handling was performed.
