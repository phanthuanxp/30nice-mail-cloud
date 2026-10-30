# VPS release runbook

This workflow deploys the current `main` revision to the existing 30NICE Mail Cloud VPS. It is manual-only; pushes and pull requests never deploy automatically.

## One-time GitHub configuration

1. In repository **Settings → Environments**, create an environment named `production`.
2. Restrict deployment branches to `main` and add at least one required reviewer. Keep production credentials at environment scope.
3. Add these environment secrets:
   - `MAILCLOUD_VPS_HOST`: VPS host name or IP address.
   - `MAILCLOUD_VPS_USER`: the same Linux account that owns the existing PM2 processes and can update `/opt/30nice-mail-cloud`.
   - `MAILCLOUD_VPS_SSH_PRIVATE_KEY`: an unencrypted, dedicated deploy key in OpenSSH private-key format. Grant it only the access required by the deploy account.
   - `MAILCLOUD_VPS_KNOWN_HOSTS`: the verified SSH host-key line for this host and port. Obtain the fingerprint from the trusted VPS console/provider and compare it before saving; do not trust an unverified `ssh-keyscan` result.
4. Optionally add the environment variable `MAILCLOUD_VPS_SSH_PORT`; it defaults to `22`.

The VPS must already have the current checkout at `/opt/30nice-mail-cloud`, the production runtime at `/opt/30nice-mail-cloud-runtime/node-v22.23.4-linux-x64`, a valid `.env.prod`, Git access to this repository, PM2, and the existing API/portal process configuration. This workflow does not install or alter Nginx, DNS, TLS, Mailcow, PostgreSQL, or Redis.

## Release

After a reviewed PR is merged and its verification passes:

1. Open **Actions → Deploy Mail Cloud to VPS → Run workflow**.
2. Select branch `main` and the explicit `DEPLOY_TO_PRODUCTION` confirmation.
3. Approve the `production` environment review.
4. Confirm the run ends successfully. The workflow checks the exact `main` SHA, installs the locked dependencies, runs `npm audit --omit=dev`, typechecks and runs the repository smoke tests/build, verifies the pinned SSH host key, deploys over SSH, then checks API health on the VPS and through `https://admin.30nice.vn/api/health`.

The remote script refuses a dirty checkout, missing `.env.prod`, a stale commit, or a non-fast-forward update. It keeps the previous Git revision and attempts to restore/rebuild/reload it if the new build or local health checks fail. A successful workflow is evidence for the app health checks only; it does not prove mail deliverability, mailbox provisioning, or inbox placement.

If the workflow cannot connect, configure the listed GitHub environment values and secrets. Never paste SSH keys or production secrets into a repository file, issue, or chat.
