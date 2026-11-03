#!/bin/sh
set -eu
test "$(id -u)" -eq 0
test -n "${MAIL_HOST:-}"
case "${ACME_MODE:-}" in
  staging)
    expected_directory=https://acme-staging-v02.api.letsencrypt.org/directory
    ;;
  production)
    expected_directory=https://acme-v02.api.letsencrypt.org/directory
    ;;
  *)
    echo "ACME_MODE must be staging or production" >&2
    exit 1
    ;;
esac
test "${ACME_DIRECTORY:-}" = "$expected_directory" || {
  echo "ACME_DIRECTORY does not match ACME_MODE=$ACME_MODE" >&2
  exit 1
}
certbot certonly --webroot -w /var/lib/dx-youxiang/acme -d "$MAIL_HOST" --agree-tos --no-eff-email \
  --register-unsafely-without-email --non-interactive \
  --server "$ACME_DIRECTORY" \
  --deploy-hook /etc/letsencrypt/renewal-hooks/deploy/dx-youxiang

app_port=$(sed -n 's/^PORT=//p' /etc/dx-youxiang/app.env | tail -1)
curl -fsS --max-time 10 "http://127.0.0.1:${app_port}/readyz" >/dev/null

# Public SMTP stays closed until both trusted TLS and the first encrypted backup exist.
# shellcheck disable=SC1091
. /etc/dx-youxiang/restic.env
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
restic snapshots --tag dx-youxiang --json | jq -e 'length > 0' >/dev/null
smtp_inbound_state=/var/lib/dx-youxiang/smtp-inbound.enabled
install -o root -g root -m 0600 /dev/null "$smtp_inbound_state"
if ! systemctl restart dx-youxiang-firewall.service \
  || ! /opt/dx-youxiang/current/scripts/firewall.sh check-inbound; then
  rm -f "$smtp_inbound_state"
  systemctl restart dx-youxiang-firewall.service || true
  echo "trusted TLS is ready, but the public SMTP readiness gate could not be opened" >&2
  exit 1
fi

# This timer exists only to recover initial issuance. Certbot owns renewal after success.
systemctl disable --now dx-youxiang-certificate-retry.timer >/dev/null 2>&1 || true
