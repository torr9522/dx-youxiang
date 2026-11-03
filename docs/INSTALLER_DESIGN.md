# Installer Design

## Supported Platform

Only Debian 12 AMD64 is claimed for `0.1.0`. Installation is native Linux/systemd; containers are prohibited. Node.js is installed under `/opt/dx-youxiang/runtime`, so global Node.js and existing applications are unchanged.

## Release And Layout

The bootstrap downloads `dx-youxiang-v<VERSION>.tar.gz` and `SHA256SUMS` from the matching immutable GitHub Release, verifies the archive, and places it at `/opt/dx-youxiang/releases/<VERSION>`. `/opt/dx-youxiang/current` is the active symlink. Node uses its official SHA-256 list, Caddy its official SHA-512 list, and Stalwart its official GitHub Actions Sigstore bundle verified by a checksum-pinned Cosign binary.

Configuration is under `/etc/dx-youxiang` and `/etc/stalwart`; application and mail data are under `/var/lib/dx-youxiang` and `/var/lib/stalwart`; encrypted backups default to `/var/backups/dx-youxiang`.

## Preflight

The installer checks root, OS/architecture, RAM, disk, NTP, public IPv4, authoritative NS, A/MX through authoritative servers and three public resolvers, occupied protocol/app ports, and current Caddy validity. It never edits DNS. A proxied mail host fails because its A answer does not match the server IPv4.

## Fresh And Coexist Modes

Fresh mode installs pinned Caddy and creates a minimal main config importing `sites-enabled`. Coexist mode reuses active Caddy, backs up its config, adds only one import when needed, installs a project site file, validates before reload, and restores the prior config if validation fails. Existing sites must be health-checked before and after production deployment.

The application selects the first free loopback port from 3000, 3001, 3100, and 3101. Stalwart JMAP uses loopback 8080. The project firewall is enabled before Stalwart starts. It always blocks new outbound SMTP connections and also blocks new public inbound TCP 25 connections until trusted TLS, `/readyz`, and the first encrypted Restic snapshot pass. The readiness marker is root-only and the systemd firewall service reapplies the gate after reboot when it is absent.

## TLS And Recovery

A short-lived self-signed bootstrap certificate lets Stalwart and Caddy load deterministic paths. It never satisfies `/readyz`. After DNS checks, Certbot HTTP-01 obtains the certificate from the exact directory selected by `ACME_MODE=staging|production`. The installer persists and passes the directory explicitly, rejects mismatched mode/directory pairs, and never falls back between environments. Its deploy hook atomically updates shared files, reloads Caddy and requests Stalwart TLS reload. Caddy and Stalwart ACME are disabled to avoid competing clients. Staging readiness identifies the chain as test-only and not publicly trusted; acceptance validates it against a separate test-only Let's Encrypt staging CA bundle without modifying the host trust store.

The installer enables backup, monitoring and Certbot renewal before its first production ACME attempt. A project timer retries only an initially failed issuance and disables itself after success; the distribution Certbot timer then remains the sole renewal authority. When the ACME server returns a `retry after` time, the project timer records it and performs local no-op checks until that time rather than submitting more orders. This preserves operational timers and automatic recovery when an external ACME limit interrupts installation without reporting the bootstrap certificate as trusted.

Existing-Caddy mode writes only `/etc/caddy/dx-youxiang.caddy`, backs up the main Caddyfile, adds one exact import, validates the complete configuration, and reloads Caddy. A failed validation removes the project include and restores the original main file.

Upgrade creates a verified release directory, takes a backup, builds, swaps the symlink, and restores the previous symlink when readiness fails. Uninstall requires an exact typed confirmation and preserves mail, application data, config, TLS and backups.
