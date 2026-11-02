# Data Model

SQLite owns application metadata only. Stalwart owns mail protocol data.

## SQLite Tables

- `domains`: numeric application ID, immutable Stalwart domain ID, DNS name, default/enabled flags and verification time.
- `mailboxes`: numeric application ID, immutable Stalwart account ID, address/local part/domain, note, external-login mirror and lifecycle status.
- `sessions`: hashed administrator session token, CSRF token, client metadata and expiry.
- `login_attempts`: bounded authentication-attempt history used with rate limiting.
- `audit_log`: administrative action, object type/ID, source IP and non-secret JSON detail.

SQLite uses WAL, foreign keys, a busy timeout, unique address/account identifiers, and a single-default-domain partial index. No message body, attachment, mailbox password, Stalwart service password, or administrator plaintext password belongs in SQLite.

## Identity Boundary

The UI route `/api/mailboxes/:id` accepts only a positive numeric SQLite ID. The backend loads `mailboxes.stalwart_account_id` and supplies it to every JMAP call. Browser-provided `accountId` is never trusted. This boundary prevents IDOR across mail accounts and must survive refactors.

## Stalwart Data

Each managed address is an independent User account containing its own mailboxes, Email objects, blob references, flags and credentials. Account IDs are migration data and must be restored, not recreated. RocksDB is exported with the matching Stalwart version; it is never copied file-by-file while running.
