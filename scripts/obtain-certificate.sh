#!/bin/sh
set -eu
test "$(id -u)" -eq 0
test -n "${MAIL_HOST:-}"
certbot certonly --webroot -w /var/lib/dx-youxiang/acme -d "$MAIL_HOST" --agree-tos --no-eff-email \
  --register-unsafely-without-email --non-interactive \
  --deploy-hook /etc/letsencrypt/renewal-hooks/deploy/dx-youxiang

# This timer exists only to recover initial issuance. Certbot owns renewal after success.
systemctl disable --now dx-youxiang-certificate-retry.timer >/dev/null 2>&1 || true
