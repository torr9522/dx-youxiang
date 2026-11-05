# Dx Youxiang v0.1.6

This stable patch preserves all v0.1.5 mailbox-user, submission, translation and routing behavior while repairing administrator compose access.

## Fixed

- Show compose, reply, reply-all and forward actions to an administrator when the currently selected mailbox has `emailSend=true`.
- Hide those actions immediately after switching to or refreshing a mailbox with `emailSend=false`.
- Support administrator attachment upload, draft creation and JMAP EmailSubmission through the root-protected Stalwart service identity.
- Close an open compose dialog when switching mailboxes so draft content cannot silently change sending identity.

## Security

- Re-resolve the selected mailbox on every upload, draft and submission request and enforce its current active and `emailSend` state.
- Derive the immutable Stalwart account ID and From address only from the server-side mailbox row. Browser-supplied account or sender identities cannot override them.
- Keep mailbox-user submission on the user's encrypted session credential and deny cross-mailbox requests.
- Record the real actor, actor role, selected mailbox and derived From address without logging credentials or message bodies.

## Upgrade and compatibility

- No SQLite migration or Stalwart data-format change is required.
- Existing mailbox addresses, account IDs, passwords, messages, attachments, folders, read state, external-login and send permissions are preserved.
- Stalwart remains pinned to 1.0.1. The release does not change DNS, PTR, Caddy ownership, global Node.js, the outbound SMTP firewall policy or the no-relay architecture.

## Validation

- All 117 automated tests pass, including administrator and mailbox-user permission matrices, mailbox switching, forged account/From attempts, draft, attachment and service-identity submission coverage.
- The test installation completed administrator desktop/mobile browser acceptance, a real internal-domain JMAP submission, derived-From verification, disabled-mailbox rejection and mailbox-user isolation checks.
- TypeScript, ESLint, production build, ShellCheck, license audit, dependency audits, CycloneDX SBOM and full-history Gitleaks gates pass.

## Known limitations

- Queue acceptance means submitted or queued, not final recipient delivery.
- Existing authenticated IMAP or SMTP connections may remain active until disconnect or timeout because Stalwart 1.0.1 has no verified per-account connection-termination API.
- The earlier Gmail direct-delivery acceptance passed SPF, DKIM and DMARC but the message was placed in Spam. This patch does not change sender reputation or claim Inbox placement.
- Translation availability and retention still depend on the administrator-selected provider; fresh installations have no public provider, endpoint, key or model default.
