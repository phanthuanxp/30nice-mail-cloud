#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=/opt/30nice-mail-cloud-backups/scheduled
REMOTE=cms30nice-crypt:30nice-mail-cloud
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$ROOT/$STAMP"
install -d -m 700 "$ROOT"
exec 9>/run/lock/30nice-mailcloud-backup.lock
flock -n 9 || exit 0
install -d -m 700 "$OUT"
trap 'echo "Backup failed; partial files retained for diagnosis" >&2' ERR
docker exec mailcloud-postgres-1 pg_dump -U mailcloud -d mailcloud -Fc > "$OUT/control-plane.dump"
docker exec mailcowdockerized-mysql-mailcow-1 sh -c 'exec mariadb-dump --single-transaction --routines --events -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > "$OUT/mailcow.sql"
for volume in vmail crypt; do
  SOURCE=$(docker volume inspect "mailcowdockerized_${volume}-vol-1" --format '{{.Mountpoint}}')
  test -d "$SOURCE"
  tar -C "$SOURCE" -czf "$OUT/$volume.tar.gz" .
done
# Version 2 uses paths relative to / and includes only Mail Cloud owned material.
CONFIG_PATHS=(opt/30nice-mail-cloud/.env.prod opt/mailcow-dockerized/mailcow.conf opt/mailcow-dockerized/data/assets/ssl)
HOSTS=(admin.30nice.vn mail.30nice.vn mx.30nice.vn)
for SITE in /etc/nginx/sites-available/30nice-webmail-*; do
  [[ -f "$SITE" ]] || continue
  HOST=${SITE##*/}; HOST=${HOST#30nice-webmail-}
  [[ "$HOST" =~ ^mail\.[a-z0-9.-]+$ ]] || continue
  HOSTS+=("$HOST")
  CONFIG_PATHS+=("${SITE#/}" "etc/nginx/sites-enabled/${SITE##*/}")
done
for HOST in "${HOSTS[@]}"; do
  # Central enabled sites may point to named configuration files, rather than $HOST.
  TARGET=$(readlink -f "/etc/nginx/sites-enabled/$HOST" 2>/dev/null || true)
  case "$TARGET" in
    /etc/nginx/sites-available/nginx-admin.30nice.vn.conf|/etc/nginx/sites-available/nginx-webmail.30nice.vn.conf|/etc/nginx/sites-available/mx.30nice.vn) CONFIG_PATHS+=("${TARGET#/}");;
  esac
  for ITEM in "etc/nginx/sites-available/$HOST" "etc/nginx/sites-enabled/$HOST" "etc/letsencrypt/live/$HOST" "etc/letsencrypt/archive/$HOST" "etc/letsencrypt/renewal/$HOST.conf"; do
    if [[ -e "/$ITEM" || -L "/$ITEM" ]]; then CONFIG_PATHS+=("$ITEM"); fi
  done
done
for ITEM in etc/systemd/system/30nice-webmail@.service etc/systemd/system/30nice-mailcloud-backup.service etc/systemd/system/30nice-mailcloud-backup.timer etc/systemd/system/30nice-mailcloud-monitor.service etc/systemd/system/30nice-mailcloud-monitor.timer usr/local/sbin/30nice-webmail-activate usr/local/sbin/30nice-mailcow-sync-tls usr/local/sbin/30nice-mailcloud-monitor etc/letsencrypt/renewal-hooks/deploy/30nice-mailcow-tls var/lib/30nice-mailcloud-webmail; do
  if [[ -e "/$ITEM" || -L "/$ITEM" ]]; then CONFIG_PATHS+=("$ITEM"); fi
done
tar -C / -czf "$OUT/configuration.tar.gz" "${CONFIG_PATHS[@]}"
printf '%s\n' 'configuration-layout-v2: archive entries are relative to /; only Mail Cloud managed hostnames are included.' > "$OUT/configuration-layout.txt"
git -C /opt/30nice-mail-cloud rev-parse HEAD > "$OUT/revision.txt"
test -s "$OUT/control-plane.dump"
test -s "$OUT/mailcow.sql"
(cd "$OUT" && sha256sum control-plane.dump mailcow.sql vmail.tar.gz crypt.tar.gz configuration.tar.gz configuration-layout.txt revision.txt > SHA256SUMS && sha256sum -c SHA256SUMS)
rclone copy "$OUT" "$REMOTE/$STAMP" --transfers 2 --checkers 2 --retries 3 --log-level ERROR
rclone check "$OUT" "$REMOTE/$STAMP" --download --one-way --log-level ERROR
printf '%s\n' "$STAMP" > "$ROOT/last-success"
echo "Backup uploaded and verified: $STAMP"
