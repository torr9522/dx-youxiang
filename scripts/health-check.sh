#!/bin/sh
set -eu

failed=0
app_port=${APP_PORT:-$(sed -n 's/^PORT=//p' /etc/dx-youxiang/app.env 2>/dev/null | tail -1)}
app_port=${app_port:-3000}
check() {
  name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf '%-18s PASS\n' "$name"
  else
    printf '%-18s FAIL\n' "$name"
    failed=1
  fi
}

check web-health curl -fsS --max-time 5 "http://127.0.0.1:${app_port}/healthz"
check web-readiness curl -fsS --max-time 8 "http://127.0.0.1:${app_port}/readyz"
check stalwart-jmap curl -fsS --max-time 5 http://127.0.0.1:8080/.well-known/jmap
check smtp-listener sh -c "ss -lnt '( sport = :25 )' | grep -q LISTEN"
check imaps-listener sh -c "ss -lnt '( sport = :993 )' | grep -q LISTEN"
check firewall-policy /opt/dx-youxiang/current/scripts/firewall.sh check
check backup-timer systemctl is-enabled dx-youxiang-backup.timer
exit "$failed"
