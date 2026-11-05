# Data Model

SQLite owns application metadata only. Stalwart owns mail protocol data.

## SQLite Tables

- `domains`: numeric application ID, immutable Stalwart domain ID, DNS name, default/enabled flags and verification time.
- `mailboxes`: numeric application ID, immutable Stalwart account ID, address/local part/domain, note, external-login and send-permission mirrors, and lifecycle status.
- `sessions`: hashed token, CSRF token, role, optional bound mailbox ID, authenticated-encrypted temporary Stalwart credential, client metadata and expiry.
- `login_attempts`: bounded authentication-attempt history used with rate limiting.
- `audit_log`: administrative action, object type/ID, source IP and non-secret JSON detail.
- `translation_settings`: singleton optional protocol/base/model/target settings, encrypted API key, enablement and tested-configuration fingerprint. Provider fields are empty on a fresh installation.
- `translation_cache`: complete safe-render translations bound to the numeric mailbox ID, immutable Stalwart account ID, message ID, source-body hash, provider hash, protocol, model, target language and prompt version. Mailbox deletion cascades cache deletion; message deletion removes its cache explicitly.

SQLite uses WAL, foreign keys, a busy timeout, unique address/account identifiers, and a single-default-domain partial index. No message body, attachment, plaintext mailbox password, Stalwart service password, or administrator plaintext password belongs in SQLite. Mailbox session credentials are AES-256-GCM ciphertext derived from the installation secret and are deleted with the session.

Translation cache rows contain derived translated presentation text only. They never contain provider API keys or modify Stalwart's MIME/blob store. SQLite backup and restore therefore preserves optional settings and cache without changing the canonical email data.

## Identity Boundary

The UI route `/api/mailboxes/:id` accepts only a positive numeric SQLite ID. The backend loads `mailboxes.stalwart_account_id` and supplies it to every JMAP call. Browser-provided `accountId` is never trusted. This boundary prevents IDOR across mail accounts and must survive refactors.

## Stalwart Data

Each managed address is an independent User account containing its own mailboxes, Email objects, blob references, flags and credentials. Account IDs are migration data and must be restored, not recreated. RocksDB is exported with the matching Stalwart version; it is never copied file-by-file while running.
