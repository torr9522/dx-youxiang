---
name: dx-mail-operations
description: Operate and verify Dx Youxiang mailbox accounts, JMAP reads, SMTP receive-only policy, and per-mailbox IMAP access without enabling sending.
---

# Dx Mail Operations

Use for mailbox creation, account inspection, receive tests, IMAP toggle checks, and isolation investigations.

## Invariants

Each address is a Stalwart User account with its own immutable `accountId`. Application routes contain a numeric SQLite ID which the backend resolves; never accept `accountId` from a browser. Ordinary accounts keep `emailReceive` enabled and `emailSend` disabled. `authenticate` is enabled only with an independent password of 6-256 characters.

## Workflow

1. Read `docs/ARCHITECTURE.md` and use the application API for ordinary management.
2. Before and after mutation capture the SQLite mailbox row and a redacted Stalwart account/permission view.
3. For receive tests deliver locally only when explicitly testing SMTP, or use an authorized external sender; never originate Internet test mail from this server.
4. Verify Inbox-scoped counts/list/search, body and attachment access, read flags, and cross-account rejection.
5. For the login switch verify new IMAP authentication succeeds or fails as expected while administrator JMAP access remains. Record that Stalwart 1.0.1 does not provide verified immediate per-account revocation of an existing IMAP session.

## Acceptance And Failure

Never create aliases as mailboxes, expose service credentials, open 465/587/995, or test relay against third parties. Pass only with distinct account IDs, bound account-scoped queries, no sending capability, and preserved data. On partial failure stop destructive mailbox operations and retain identifiers for reconciliation.
