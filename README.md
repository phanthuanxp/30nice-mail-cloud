# 30NICE Mail Cloud — Local First Starter (Sprint 0)

Starter for **multi-tenant business email SaaS**, built to develop on Windows first. This is a **development scaffold**, not an operational email server or production SaaS.

## What is included
- Next.js responsive admin prototype at `http://localhost:3002` (all displayed customer/mailbox counts are DEMO only).
- NestJS read-only mock API at `http://localhost:3001/health`.
- Mail adapter contract in **mock** mode. No real mailbox creation or mail sending.
- Optional PostgreSQL & Redis developer Docker services.
- Architecture and security gates.

## Windows PowerShell (Node.js LTS required)
```powershell
cd C:\Users\User\Documents\Codex
# Extract the ZIP contents so folder 30nice-mail-cloud-starter is here
cd .\30nice-mail-cloud-starter
Copy-Item .env.example .env
npm install
npm run dev
```

To keep both services in separate Windows terminals, run `.\START_LOCAL.ps1`.
Open a second terminal for API:
```powershell
cd C:\Users\User\Documents\Codex\30nice-mail-cloud-starter
npm run dev:api
```
Optional DB and cache: Docker Desktop + WSL2 must be installed, then:
```powershell
docker compose -f infra/docker-compose.dev.yml up -d
```
*Docker is optional for just viewing the UI.* DB and Redis are **not wired to API yet**. Do not assume services are healthy until checked.

## Verification
1. `http://localhost:3002` displays dashboard with visible LOCAL DEVELOPMENT badge.
2. `http://localhost:3001/health` gives JSON `status: ok` and `mailAdapter: mock`.
3. The tenant search/filter works with demo data.
4. Buttons that need persistence clearly state they are not yet implemented.

## Next sprint (not yet implemented)
- Auth/RBAC/MFA; relational schema and migrations; seed fixtures separated from production.
- CRUD tenant/domain/mailbox with isolation tests.
- Mailcow adapter with dry-run, audit trail and background provisioning; never expose mail admin key to browser.
- Plans, billing sandbox, backups, security testing.

**No changes to Contabo VPS, DNS, GitHub repositories or live mail services.**
