---
name: dx-system-audit
description: Perform a read-only Debian host suitability and coexistence audit for Dx Youxiang before installation or migration.
---

# Dx System Audit

Use before any test or production deployment.

## Inputs And Tools

Require the exact host and SSH authorization. Use read-only commands such as `uname`, `free`, `df`, `findmnt`, `ss`, `systemctl`, `ps`, `nft list ruleset`, `iptables-save`, `caddy adapt/validate`, `dig`, and TLS probes. Redact environment values, tokens, private keys, and database content.

## Workflow

1. Confirm host identity and that it is not the wrong server.
2. Record OS, architecture, CPU, memory/swap, disk/inodes, mounts, load, time sync, addresses, and DNS.
3. Inventory active/enabled services, processes, timers, cron, backups, mail daemons, databases, and project directories without reading secrets.
4. Map all listeners, emphasizing 25, 80, 443, 465, 587, 993, 995, 8080, and candidate app ports.
5. Inspect Caddy include structure and validate its current config without rewriting it. Assess IPv4/IPv6 and host firewall rules; mark provider firewall as externally unverified when unavailable.

## Acceptance And Failure

Report evidence, conflicts, capacity margins, blockers, and an isolated integration plan. Do not install packages, create files, restart services, or infer cloud firewall state. If SSH fails, stop remote work and state the missing access condition.
