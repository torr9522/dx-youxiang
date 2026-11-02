#!/bin/sh
set -eu
test "$(id -u)" -eq 0
test -n "${MAIL_HOST:-}" && test -n "${ACME_EMAIL:-}"
certbot certonly --webroot -w /var/lib/private-mail-hub/acme -d "$MAIL_HOST" --email "$ACME_EMAIL" --agree-tos --no-eff-email
RENEWED_DOMAINS=$MAIL_HOST STALWART_USERNAME=$STALWART_USERNAME STALWART_PASSWORD=$STALWART_PASSWORD /opt/private-mail-hub/scripts/renew-certificate.sh
