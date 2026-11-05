# Dx Youxiang v0.1.5

This stable release preserves every v0.1.4 Phase 1.7 translation and browser-routing change and promotes the accepted Phase 1.8 mailbox-user webmail and sending work.

## Added and changed

- Use one role-aware login entry for the existing administrator and enabled mailbox users.
- Authenticate mailbox users with their full address and existing Stalwart credential; bind each session to one immutable account mapping and recheck external-login permission on every request.
- Add an independent per-mailbox send permission. New and existing mailboxes keep reception enabled while external login and sending default to disabled.
- Add mailbox-user Inbox, Sent and Drafts views, compose, reply, reply-all, forward, attachments and server-side drafts.
- Submit browser mail through user-authenticated JMAP EmailSubmission and derive the sender identity on the server.
- Enable IMAPS 993, SMTP Submission 587 STARTTLS and SMTP Submission 465 implicit TLS with authenticated-sender matching.
- Deliver directly to recipient MX servers over TCP 25 without a third-party relay.
- Restrict new outbound TCP 25 connections to the Stalwart service UID and reject other processes' outbound SMTP connections.
- Preserve Phase 1.7 translation concurrency, completeness, placeholder protection, `email-text-v3` cache invalidation, React Router history, deep links, refresh and responsive layouts.

## Upgrade and data compatibility

- Upgrading from v0.1.4 adds backward-compatible SQLite columns for role-bound sessions and per-mailbox send state plus the login-attempt table. Existing mailboxes receive `emailSend=false`.
- The upgrade keeps existing domains, immutable Stalwart account IDs, credentials, messages, raw MIME, attachments, read flags, translation settings and external-login state.
- The formal upgrade reuses the existing Stalwart service credential, configures Submission listeners and service permissions, and reapplies the project-owned firewall policy. It does not enable sending for any mailbox.
- Existing v0.1.4 installations without DKIM keys switch the existing Stalwart domain to its official automatic DKIM management. Administrators must publish and verify the generated public DNS records before enabling external sending.
- Fresh installations still start with API protocol, Base URL, API key and model empty and translation disabled.
- Stalwart remains pinned to 1.0.1. No container, global Node.js upgrade or third-party SMTP relay is introduced.

## Security

- The browser never supplies a trusted Stalwart account ID or From identity.
- Mailbox, message, attachment and translation-cache access remains account-bound on the server.
- New SMTP authentication is rejected when external login is disabled; submission is rejected unless both external login and send permission are enabled.
- Anonymous relay and unauthorized sender identities are rejected by Stalwart.
- Existing authenticated IMAP or SMTP connections may remain active until disconnect or timeout because Stalwart 1.0.1 has no verified per-account connection-termination API.

## Direct-delivery acceptance

- A controlled test installation completed direct IPv4 SMTP delivery to Gmail without a relay.
- Gmail returned `250 2.1.5 OK`; the final Stalwart submission state was delivered and the queue emptied.
- Gmail's original message headers reported SPF, DKIM and DMARC as passing.
- The accepted message was placed in Gmail Spam, not Inbox. A new domain and IP still need gradual reputation development, conservative sending volume and ongoing deliverability monitoring.

## Known limitations

- Gmail acceptance and authentication success do not guarantee Inbox placement. The controlled acceptance message was placed in Spam.
- Direct delivery was accepted by Gmail only; this release does not claim equivalent acceptance by every mailbox provider.
- PTR, SPF, DKIM and DMARC are deployment-specific and must be configured and verified by the operator before external sending.
- Translation latency, availability and retention depend on the administrator-selected provider; there is no public provider, API endpoint, key or model default.
- SMTP queue acceptance means submitted or queued, not final recipient delivery.
