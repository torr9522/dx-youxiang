# Architecture

## Components

```text
Internet SMTP -> Stalwart :25 -> RocksDB (account-isolated mail)
IMAPS client  -> Stalwart :993
Browser       -> Caddy :443 -> Private Mail Hub :3000 -> JMAP :8080 -> Stalwart
                                      |-> SQLite WAL
```

Stalwart owns protocol handling, accounts, mailboxes, messages and attachments. Private Mail Hub owns the administrator session, mailbox notes, domain selection, audit records, and the mapping from its numeric mailbox ID to the immutable Stalwart account ID.

## Authorization

Mailbox routes contain only the application's numeric ID. The backend resolves it from SQLite and supplies the corresponding Stalwart `accountId`; request bodies and query strings cannot override it. Message and attachment access is repeated under that account ID. An attachment is downloaded only after the backend confirms its blob ID belongs to the named message in the selected account.

Ordinary accounts use a custom explicit permission set. `emailReceive` and standard IMAP mailbox operations are present. `emailSend` is always disabled. `authenticate` is disabled by default and added only while external login is enabled. SMTP AUTH is not advertised on port 25, and there is no submission listener.

The service identity holds `impersonate`, only the JMAP mail operations used by the application, account/domain management, TLS reload, and the ordinary permissions it must legally grant under Stalwart's no-privilege-escalation rule. Its `emailSend` permission is disabled.

## Existing IMAP sessions

Stalwart 1.0.1 applies permission changes to new authentication immediately. The documented management API and source do not provide a per-account command that closes an already established IMAP TCP session. Stalwart Proxy is a migration/routing proxy and does not add a verified per-account session-revocation API. Therefore the switch guarantees rejection of new logins; an existing connection may remain usable until the client disconnects, an idle/network timeout occurs, or the server is restarted. A whole-server restart is deliberately not part of the normal switch operation.

## Storage

Stalwart uses its recommended single-node RocksDB store with the default blob and search stores. The application uses a separate SQLite database in WAL mode. Source, configuration, runtime data, mail data, TLS material and encrypted backups use separate directories.
