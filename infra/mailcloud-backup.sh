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
tar -C /opt -czf "$OUT/configuration.tar.gz" 30nice-mail-cloud/.env.prod mailcow-dockerized/mailcow.conf mailcow-dockerized/data/assets/ssl
git -C /opt/30nice-mail-cloud rev-parse HEAD > "$OUT/revision.txt"
test -s "$OUT/control-plane.dump"
test -s "$OUT/mailcow.sql"
(cd "$OUT" && sha256sum control-plane.dump mailcow.sql vmail.tar.gz crypt.tar.gz configuration.tar.gz revision.txt > SHA256SUMS && sha256sum -c SHA256SUMS)
rclone copy "$OUT" "$REMOTE/$STAMP" --transfers 2 --checkers 2 --retries 3 --log-level ERROR
rclone check "$OUT" "$REMOTE/$STAMP" --download --one-way --log-level ERROR
printf '%s\n' "$STAMP" > "$ROOT/last-success"
echo "Backup uploaded and verified: $STAMP"
