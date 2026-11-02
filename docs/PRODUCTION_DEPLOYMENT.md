# Production Deployment

Production deployment begins only after stable `v0.1.0` passes a clean remote installation.

1. Repeat the read-only host audit; do not reuse stale results. Inventory all websites, ports, Caddy includes, Node runtimes, firewall rules, timers, backups, resource limits and outbound SMTP users.
2. Capture health evidence for every existing site. Back up Caddy and relevant system configuration.
3. Install the stable GitHub Release in coexist mode. Do not reinstall the host, replace global Node.js, overwrite Caddy, or change existing application code/databases.
4. Validate then reload Caddy. Recheck every existing site and its certificate.
5. Configure off-host encrypted Restic storage, disk/log thresholds and NTP. A local-only repository is not a production backup.
6. Restore migration data on non-public/internal listeners and compare all identities and content before opening mail ports.
7. Perform the final consistent sync during a receive freeze as described in `docs/MIGRATION.md`.
8. Report source/target status, final sync, backup, TLS, exact A-record change and rollback plan. Wait for explicit user authorization before DNS mutation.
9. After cutover, monitor both servers for cached delivery and reconcile late mail before retiring the old host.

Production is never a permitted target for the OS reinstall tool.
