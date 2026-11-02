# Operations

## Services

```sh
systemctl status stalwart dx-youxiang caddy
journalctl -u dx-youxiang -u stalwart -u caddy --since today
systemctl list-timers 'dx-youxiang-*'
```

Application logs contain operational metadata only. Do not raise logging in a way that records request bodies or mail content.

## Health

`/healthz` reports only web-process liveness. `/readyz` separately checks SQLite, Stalwart, JMAP, mail-store free space and TLS lifetime. The monitor timer fails when readiness fails or mail storage reaches 85% usage.

## Capacity

Track `/var/lib/stalwart`, `/var/lib/dx-youxiang` and the off-host backup repository. RocksDB reclaims deleted space asynchronously during compaction. Do not manually edit or copy live RocksDB files.

## Certificate renewal

Certbot owns ACME. Its deploy hook atomically replaces the shared certificate and calls Stalwart's `ReloadTlsCertificates` action, which does not interrupt existing connections, then reloads Caddy. Do not enable Stalwart ACME or Caddy automatic HTTPS for the same hostname.
