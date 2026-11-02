#!/bin/sh
set -eu
test "$(id -u)" -eq 0
test -n "${MAIL_HOST:-}"
certbot certonly --webroot -w /var/lib/dx-youxiang/acme -d "$MAIL_HOST" --agree-tos --no-eff-email \
  --register-unsafely-without-email --deploy-hook /etc/letsencrypt/renewal-hooks/deploy/dx-youxiang
