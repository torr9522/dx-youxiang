# Architecture

## Components

```text
Internet SMTP -> Stalwart :25 -> RocksDB (account-isolated mail)
IMAPS client  -> Stalwart :993
Browser       -> Caddy :443 -> Dx 邮箱 :loopback-selected -> JMAP :8080 -> Stalwart
                                      |-> SQLite WAL
```

Stalwart owns protocol handling, accounts, mailboxes, messages and attachments. Dx 邮箱 owns the administrator session, mailbox notes, domain selection, audit records, and the mapping from its numeric mailbox ID to the immutable Stalwart account ID.

The installer selects the first free loopback application port from 3000, 3001, 3100, and 3101. Stalwart JMAP stays on `127.0.0.1:8080`. Caddy is the only public HTTP service.

## Authorization

Mailbox routes contain only the application's numeric ID. The backend resolves it from SQLite and supplies the corresponding Stalwart `accountId`; request bodies and query strings cannot override it. Message and attachment access is repeated under that account ID. An attachment is downloaded only after the backend confirms its blob ID belongs to the named message in the selected account.

Ordinary accounts use a custom explicit permission set. `emailReceive` and standard IMAP mailbox operations are present. `emailSend` is always disabled. `authenticate` is disabled by default and added only while external login is enabled. SMTP AUTH is not advertised on port 25, and there is no submission listener.

The service identity holds `impersonate`, only the JMAP mail operations used by the application, account/domain management, TLS reload, and the ordinary permissions it must legally grant under Stalwart's no-privilege-escalation rule. Its `emailSend` permission is disabled.

## Existing IMAP sessions

Stalwart 1.0.1 applies permission changes to new authentication immediately. The documented management API and source do not provide a per-account command that closes an already established IMAP TCP session. Stalwart Proxy is a migration/routing proxy and does not add a verified per-account session-revocation API. Therefore the switch guarantees rejection of new logins; an existing connection may remain usable until the client disconnects, an idle/network timeout occurs, or the server is restarted. A whole-server restart is deliberately not part of the normal switch operation.

## Storage

Stalwart uses its recommended single-node RocksDB store with the default blob and search stores. The application uses a separate SQLite database in WAL mode. Source, configuration, runtime data, mail data, TLS material and encrypted backups use separate directories.

## Module Map

- `src/client`: administrator-only React interface and request state.
- `src/server/app.ts`: HTTP routes, validation, authorization binding, health/readiness.
- `src/server/db.ts`: SQLite schema and migrations.
- `src/server/stalwart.ts`: JMAP and Stalwart management adapter.
- `src/server/security.ts`: administrator session, CSRF, cookies, audit records.
- `src/server/mail.ts`: body presentation, HTML sanitization, verification-code extraction.
- `src/server/remote-images.ts`: message-bound image tokens, SSRF controls and raster validation.
- `src/server/translation-provider.ts`: HTTPS-only, DNS-validated Responses and Chat Completions protocol adapters.
- `src/server/translation.ts`: encrypted translation settings, language detection, text-node mapping and account-bound cache policy.
- `scripts/bootstrap-stalwart.mjs`: one-time service identity, listeners, TLS and permission configuration.
- `scripts/*.sh` and `deploy`: native lifecycle, systemd, Caddy, Certbot, nftables and backup assets.

The client uses React Router with browser history for `/inbox`, `/inbox/:mailboxId`, `/inbox/:mailboxId/:messageId`, `/mailboxes`, `/settings`, and the `/settings/domains`, `/settings/audit`, and `/settings/translation` subpages. `/domains` and `/audit` remain compatible redirects. User navigation pushes history; canonical and authentication redirects replace it. A same-origin allowlist validates post-login return targets.

The application server returns the SPA entry point only for this explicit route allowlist; health, API, mail-resource and unknown static paths retain their own status and content type. Route identifiers are navigation hints only. Every mailbox, message, image and attachment request remains authorized by the server-side SQLite mailbox-to-Stalwart-account mapping. Desktop routing retains the three-column workspace, while mobile routes select the mailbox, list, or detail stage without creating a second navigation model.

## Receive Flow

```text
Internet MTA
  -> SMTP 25 STARTTLS
  -> Stalwart validates local domain and real recipient
  -> account-specific Inbox and blob store
  -> service identity impersonates selected account through loopback JMAP
  -> backend sanitizes/presents mail
  -> authenticated administrator browser
```

No step contains a submission or relay route. New outbound TCP 25/465/587 connections are rejected at the host firewall.

## Optional translation flow

Translation is disabled and unconfigured on a new installation. After an administrator explicitly configures and tests a provider, a user action on one message extracts text nodes from the already-sanitized presentation, protects identifiers, sends bounded JSON text batches to the selected protocol adapter, validates the returned node map and writes text values back into the same safe DOM structure. Images, URLs, attributes and raw MIME data are not sent or rewritten. Complete translations are cached in SQLite; incomplete results are shown with a warning and are not cached. Provider calls use a process-wide concurrency limit of two, independent chunks may run within that limit, and concurrent requests for the same cache key share one in-flight operation. Translation responses expose only non-sensitive stage timings for operational measurement.
