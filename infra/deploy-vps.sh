#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/30nice-mail-cloud
NODE=/opt/30nice-mail-cloud-runtime/node-v22.23.4-linux-x64/bin/node
EXPECTED_SHA=${DEPLOY_COMMIT_SHA:-}
HEALTH_FILE=$(mktemp)
UPDATED=0
PREVIOUS_SHA=

cleanup() {
  rm -f "$HEALTH_FILE"
}
rollback() {
  local status=$?
  trap - ERR
  if [[ "$UPDATED" == "1" && -n "$PREVIOUS_SHA" ]]; then
    echo "Deploy failed; restoring previous revision."
    git -C "$APP_DIR" reset --hard "$PREVIOUS_SHA" || true
    if (cd "$APP_DIR" && npm ci --no-audit --no-fund && npm run build:api && npm run build); then
      (cd "$APP_DIR" && pm2 startOrReload infra/ecosystem.config.cjs --update-env) || true
      curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3013/health -o /dev/null || true
      curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3012/ -o /dev/null || true
    else
      echo "Rollback build failed; PM2 was left on its previously running process where possible." >&2
    fi
  fi
  cleanup
  exit "$status"
}
trap rollback ERR
trap cleanup EXIT

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "DEPLOY_COMMIT_SHA must be a full commit SHA." >&2; exit 2; }
[[ -x "$NODE" ]] || { echo "Configured production Node.js runtime was not found." >&2; exit 2; }
[[ -d "$APP_DIR/.git" ]] || { echo "Expected Git checkout was not found at $APP_DIR." >&2; exit 2; }
[[ -f "$APP_DIR/.env.prod" ]] || { echo "Production environment file is missing." >&2; exit 2; }
[[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || { echo "Production checkout has local changes; refusing to deploy." >&2; exit 2; }

git -C "$APP_DIR" fetch --no-tags origin main
REMOTE_SHA=$(git -C "$APP_DIR" rev-parse origin/main)
[[ "$REMOTE_SHA" == "$EXPECTED_SHA" ]] || { echo "Requested SHA is no longer the tip of origin/main; refusing stale deploy." >&2; exit 2; }

PREVIOUS_SHA=$(git -C "$APP_DIR" rev-parse HEAD)
git -C "$APP_DIR" merge --ff-only "$EXPECTED_SHA"
UPDATED=1

cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build:api
npm run build
pm2 startOrReload infra/ecosystem.config.cjs --update-env

API_OK=0
for attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3013/health -o "$HEALTH_FILE" &&
    "$NODE" -e 'const fs=require("node:fs"); process.exit(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).status === "ok" ? 0 : 1)' "$HEALTH_FILE"; then
    API_OK=1
    break
  fi
  sleep 2
done
[[ "$API_OK" == "1" ]] || { echo "API health check failed after restart." >&2; exit 1; }
curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-connrefused --max-time 10 http://127.0.0.1:3012/ -o /dev/null

trap - ERR
echo "Deployment succeeded for $EXPECTED_SHA; API and portal health checks passed."
