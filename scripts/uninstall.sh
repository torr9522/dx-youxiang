#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || { echo "run as root" >&2; exit 1; }
printf '%s\n' 'This removes application services and source only.'
printf '%s\n' 'Mail data, application data, configuration, TLS material, and backups are preserved.'
printf '%s' 'Type REMOVE DX-YOUXIANG APPLICATION to continue: '
IFS= read -r confirmation
test "$confirmation" = 'REMOVE DX-YOUXIANG APPLICATION' || { echo "cancelled"; exit 1; }

systemctl disable --now dx-youxiang.service dx-youxiang-backup.timer dx-youxiang-monitor.timer dx-youxiang-certificate-retry.timer dx-youxiang-firewall.service 2>/dev/null || true
rm -f /etc/systemd/system/dx-youxiang.service \
  /etc/systemd/system/dx-youxiang-backup.service \
  /etc/systemd/system/dx-youxiang-backup.timer \
  /etc/systemd/system/dx-youxiang-monitor.service \
  /etc/systemd/system/dx-youxiang-monitor.timer \
  /etc/systemd/system/dx-youxiang-certificate-retry.service \
  /etc/systemd/system/dx-youxiang-certificate-retry.timer \
  /etc/systemd/system/dx-youxiang-firewall.service
rm -f /etc/caddy/sites-enabled/dx-youxiang.caddy /etc/caddy/dx-youxiang.caddy
if test -f /etc/caddy/Caddyfile; then
  sed -i '\|^import /etc/caddy/dx-youxiang.caddy$|d' /etc/caddy/Caddyfile
fi
if test -f /etc/caddy/Caddyfile && command -v caddy >/dev/null 2>&1; then
  if caddy validate --config /etc/caddy/Caddyfile; then systemctl reload caddy || true; fi
fi
systemctl daemon-reload
rm -rf /opt/dx-youxiang
echo "Application removed. Preserved: /etc/dx-youxiang /var/lib/dx-youxiang /var/lib/stalwart /var/backups/dx-youxiang"
