---
name: dx-production-migration
description: Deploy and migrate Dx Youxiang to a production host while preserving existing sites and mail identity, with an explicit gate before DNS cutover.
---

# Dx Production Migration

Use only after the stable release passed clean-install acceptance.

## Inputs

Require the exact old/new hosts, stable version, fresh read-only production audit, two verified backups, maintenance window, off-host backup destination, current TTL, and rollback owner. DNS modification requires separate explicit user authorization at cutover time.

## Workflow

1. Read `docs/MIGRATION.md` and `docs/PRODUCTION_DEPLOYMENT.md`; confirm production is never a reinstall target.
2. Re-audit services, resources, ports, Caddy, firewall, timers, and existing site health.
3. Install from the public stable release in coexist mode. Restore into isolation and compare accounts, immutable account IDs, messages, attachments, folders, flags, permissions, credentials state, and administrator access.
4. Recheck every existing site, Dx readiness, TLS, SMTP/IMAP, receive-only controls, capacity alerts, and off-host encrypted backup.
5. At the window freeze old inbound receive, make a final consistent backup, restore and verify it on production, then report the exact A-record change and rollback plan.
6. Wait for explicit DNS authorization. After cutover monitor both hosts and reconcile any late delivery before retiring the old listener.

## Safety And Acceptance

Never reinstall production, alter existing application code/databases, overwrite Caddy, change MX, or assume snapshots merge. Without off-host backup or DNS authorization, complete independent work but mark those gates pending. Roll back the A record only with mail received on the new host accounted for.
