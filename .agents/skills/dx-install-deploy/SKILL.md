---
name: dx-install-deploy
description: Install or upgrade Dx Youxiang natively on supported Debian hosts while preserving existing Caddy sites and avoiding global Node.js or container changes.
---

# Dx Install Deploy

Use for fresh-host installation, coexist installation, upgrade, rollback, or uninstallation.

## Inputs

Require Debian 12 AMD64, root authorization, a fixed release, mail domain, mail hostname, administrator password, correct public A/MX records, and the intended deployment mode.

## Workflow

1. Read `docs/DEPLOYMENT.md`, `docs/INSTALLER_DESIGN.md`, and `docs/UPGRADE.md`.
2. Audit resources, ports, services, Caddy imports, DNS, time sync, and firewall state before mutation.
3. Use the release `install.sh`; do not manually preinstall a missing dependency during acceptance.
4. In coexist mode back up Caddy, add only the project include, validate before reload, and recheck every pre-existing site.
5. Verify systemd enablement, `/healthz`, `/readyz`, SMTP 25, IMAPS 993, TLS, backup timer, and the project-owned outbound SMTP nftables policy.

## Safety And Acceptance

Never use containers, replace global Node.js, clear firewall rules, overwrite a Caddyfile, or restart unrelated services. An install passes only from a clean supported host using a fixed remote release with no manual repair. On failure preserve logs, roll back Caddy or the release symlink where supported, and diagnose the root cause in source before retrying.
