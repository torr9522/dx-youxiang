# Server migration

The stable identity is the mail hostname. A server migration restores accounts and data; it does not recreate mailboxes.

1. Install the pinned application and compatible Stalwart build on the new server.
2. Restore and validate the latest backup in isolation.
3. Schedule a short receive freeze, run a final backup on the old host, and restore it on the new host.
4. Verify account IDs, messages, attachments, folders, flags, passwords and permissions.
5. Verify the web UI, SMTP recipient validation, IMAP login switches, TLS and outbound firewall blocks.
6. Change the A record of the existing mail hostname to the new IPv4 address. Do not alter the MX record.
7. Keep the old server intact and firewalled for rollback until the DNS TTL and acceptance window have passed.

Rollback changes the A record back and restores the old listener rules. Mail received on the new host during the window must be exported and reconciled before rollback; DNS changes alone do not merge mail stores.
