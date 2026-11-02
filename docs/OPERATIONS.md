# Operations

## Services

```sh
systemctl status stalwart dx-youxiang caddy
journalctl -u dx-youxiang -u stalwart -u caddy --since today
systemctl list-timers 'dx-youxiang-*'
```

Application logs contain operational metadata only. Do not raise logging in a way that records request bodies or mail content.

## Health

`/healthz` reports only web-process liveness. `/readyz` separately checks SQLite, Stalwart, JMAP, mail-store free space, TLS hostname/lifetime, and rejects the self-signed bootstrap certificate. The monitor timer fails when readiness fails or mail storage reaches 85% usage.

## Capacity

Track `/var/lib/stalwart`, `/var/lib/dx-youxiang` and the off-host backup repository. RocksDB reclaims deleted space asynchronously during compaction. Do not manually edit or copy live RocksDB files.

## Certificate renewal

Certbot owns ACME. Its deploy hook atomically replaces the shared certificate and calls Stalwart's `ReloadTlsCertificates` action, which does not interrupt existing connections, then reloads Caddy. The `dx-youxiang-certificate-retry.timer` exists only while initial issuance has not succeeded and disables itself after success; it records and honors an ACME `retry after` time without contacting the CA early. `certbot.timer` owns all later renewals. Do not enable Stalwart ACME or Caddy automatic HTTPS for the same hostname.

`/var/lib/dx-youxiang/smtp-inbound.enabled` is the root-only readiness marker for public SMTP. The initial certificate workflow creates it only after `/readyz` and an encrypted Restic snapshot pass, then reapplies the project firewall without the temporary inbound gate. If the marker is missing after a restore, public SMTP remains closed until the same checks are completed again.
