# Local setup Windows

## Sprint 0 verified baseline

- Node.js `v24.14.1`; npm `11.11.0`; Git `2.55.0.windows.3`; Docker `29.5.3`.
- Ports 3000, 3001, 5432 and 6379 were free during the initial audit.
- WSL2 status could not be read because Windows returned `WSL/E_ACCESSDENIED`.
- Available space on C: was approximately 21.3 GiB. The CIM memory query was unavailable; the brief's 8 GiB assumption was therefore not re-confirmed.
- `.env` was created from `.env.example` locally and is ignored; no production secrets were added.

## Commands

```powershell
npm install --no-audit --no-fund
npm run build
npm run build:api
npm run typecheck
npm run dev
npm run dev:api
```

The portal runs on `http://localhost:3002`; the API health endpoint is `http://localhost:3001/health`.
PostgreSQL and Redis remain optional and are not wired to the mock API.

## Guardrails

This local setup does not deploy VPS, change DNS/MX, provision real mailboxes, send email, or connect Mailcow production.
