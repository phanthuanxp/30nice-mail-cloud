#!/usr/bin/env bash
set -Eeuo pipefail
CERT_DIR=/etc/letsencrypt/live/mx.30nice.vn
SSL_DIR=/opt/mailcow-dockerized/data/assets/ssl
if [[ -n "${RENEWED_LINEAGE:-}" && "$RENEWED_LINEAGE" != "$CERT_DIR" ]]; then exit 0; fi
exec 9>/run/lock/30nice-mailcow-tls.lock
flock -n 9 || exit 0
openssl x509 -in "$CERT_DIR/fullchain.pem" -checkend 86400 -noout
openssl x509 -in "$CERT_DIR/fullchain.pem" -checkhost mx.30nice.vn -noout
CERT_KEY=$(openssl x509 -in "$CERT_DIR/fullchain.pem" -pubkey -noout | openssl sha256)
PRIVATE_KEY=$(openssl pkey -in "$CERT_DIR/privkey.pem" -pubout | openssl sha256)
[[ "$CERT_KEY" == "$PRIVATE_KEY" ]] || { echo 'TLS certificate/key mismatch' >&2; exit 1; }
if [[ "${1:-}" == '--check' ]]; then echo 'TLS certificate preflight passed'; exit 0; fi
if cmp -s "$CERT_DIR/fullchain.pem" "$SSL_DIR/cert.pem" && cmp -s "$CERT_DIR/privkey.pem" "$SSL_DIR/key.pem"; then
  echo 'Mailcow TLS already synchronized'; exit 0
fi
BACKUP="/opt/30nice-mail-cloud-backups/tls-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$BACKUP"
cp -p "$SSL_DIR/cert.pem" "$SSL_DIR/key.pem" "$BACKUP/"
install -m 644 "$CERT_DIR/fullchain.pem" "$SSL_DIR/cert.pem.new"
install -m 600 "$CERT_DIR/privkey.pem" "$SSL_DIR/key.pem.new"
mv -f "$SSL_DIR/cert.pem.new" "$SSL_DIR/cert.pem"
mv -f "$SSL_DIR/key.pem.new" "$SSL_DIR/key.pem"
docker exec mailcowdockerized-dovecot-mailcow-1 doveadm reload
docker exec mailcowdockerized-postfix-mailcow-1 postfix reload
docker exec mailcowdockerized-nginx-mailcow-1 nginx -s reload
echo 'Mailcow TLS synchronized and reloaded'
