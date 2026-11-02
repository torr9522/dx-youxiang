# Security Policy

## Supported versions

Security fixes are provided for the latest tagged release. This pre-release `0.1.0` line must not be described as stable until the deployment acceptance checklist passes.

## Reporting

Do not open a public issue containing credentials, message content, server addresses, database files or exploit details. Contact the project maintainer privately and include the affected version, reproduction steps and impact.

## Deployment requirements

- Keep `/etc/dx-youxiang`, `/etc/stalwart`, TLS private keys and Restic passwords root-readable only as documented.
- Bind Stalwart HTTP/JMAP and the Node application to loopback.
- Do not open ports 465, 587, 995 or 4190.
- Keep outbound TCP 25, 465 and 587 blocked.
- Run backups and restore tests before upgrades.
- Rotate the administrator and service credentials after suspected exposure.

The application intentionally does not log passwords, Stalwart credentials, message bodies or attachment data.
