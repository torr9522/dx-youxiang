# Security Policy

## Supported versions

Security fixes are provided for the latest tagged stable release.

## Reporting

Do not open a public issue containing credentials, message content, server addresses, database files or exploit details. Contact the project maintainer privately and include the affected version, reproduction steps and impact.

## Deployment requirements

- Keep `/etc/dx-youxiang`, `/etc/stalwart`, TLS private keys and Restic passwords root-readable only as documented.
- Bind Stalwart HTTP/JMAP and the Node application to loopback.
- Expose 465 and 587 only through Stalwart's TLS-protected authenticated Submission listeners. Keep 995, 4190 and public JMAP closed.
- Keep new outbound TCP 25 limited to the Stalwart service UID and block other processes from new outbound 25, 465 and 587 connections.
- Keep external login and sending disabled for new mailboxes. Effective sending requires both switches and server-side sender matching.
- Run backups and restore tests before upgrades.
- Rotate the administrator and service credentials after suspected exposure.

The application intentionally does not log passwords, Stalwart credentials, message bodies or attachment data.
