#!/bin/sh
set -eu

state_file=${DX_CERTIFICATE_RETRY_STATE_FILE:-/var/lib/dx-youxiang/certificate-retry-after}
certbot_log=${DX_CERTBOT_LOG:-/var/log/letsencrypt/letsencrypt.log}
obtain_script=${DX_OBTAIN_CERTIFICATE_SCRIPT:-/opt/dx-youxiang/current/scripts/obtain-certificate.sh}
now=$(date -u +%s)

if test -s "$state_file"; then
  retry_epoch=$(sed -n '1p' "$state_file")
  case "$retry_epoch" in
    *[!0-9]*|'') rm -f -- "$state_file" ;;
    *)
      if test "$now" -lt "$retry_epoch"; then
        retry_at=$(date -u -d "@$retry_epoch" '+%Y-%m-%d %H:%M:%S UTC')
        echo "ACME issuance deferred until $retry_at"
        exit 0
      fi
      ;;
  esac
fi

if "$obtain_script"; then
  rm -f -- "$state_file"
  exit 0
fi

if test -r "$certbot_log"; then
  acme_error=$(grep 'acme.messages.Error:' "$certbot_log" | tail -n 1 || true)
  test -z "$acme_error" || printf '%s\n' "$acme_error" >&2
  retry_at=$(sed -n 's/.*retry after \([0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9] UTC\).*/\1/p' "$certbot_log" | tail -n 1)
  if test -n "$retry_at"; then
    retry_epoch=$(date -u -d "$retry_at" +%s)
    install -d -m 0711 "$(dirname "$state_file")"
    printf '%s\n' "$retry_epoch" | install -m 0600 /dev/stdin "$state_file"
    echo "ACME server requested no retry before $retry_at" >&2
  fi
fi

exit 1
