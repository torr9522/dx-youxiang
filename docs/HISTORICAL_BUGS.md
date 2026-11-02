# Historical Bugs And Decisions

## Inbox Route Became NaN

Symptom: mailbox cards showed a correct message count, but opening an Inbox returned `Invalid input: expected number, received NaN` and an empty list.

Root cause: UI enrichment spread Stalwart `Mailbox/get` data over the application mailbox row. Both objects used `id`; Stalwart's internal Inbox identifier overwrote the numeric SQLite mailbox ID. Converting that string to a numeric route generated `NaN`.

Fix: `e1c3286` keeps the application ID authoritative and maps only `totalEmails` and `unreadEmails` from Stalwart. Route validation remains strict; no NaN fallback was added.

## Junk Appeared In Inbox Results

Symptom: mailbox Inbox statistics and message list/search totals differed when Junk contained mail.

Root cause: `Email/query` was account-scoped but lacked `inMailbox` for the Inbox folder.

Fix: `072da9b` first queries the mailbox with role `inbox`, then applies that ID to every list/search/pagination filter. Empty/no-Inbox state returns an empty result.

## Pagination State Regression

Mailbox switching could retain stale position/results from a prior mailbox or allow an older response to win. `08e2ed6` added coverage for reset and request isolation. `InboxPage` is also keyed by numeric mailbox ID.

## Rejected Approaches

- Defaulting `NaN` to zero was rejected because it hid the incorrect identifier producer.
- Account-wide email query was rejected because account isolation alone does not mean Inbox-folder isolation.
- Aliases and a shared catch-all Inbox were rejected because they do not provide independent accounts/data.
- Direct live RocksDB copies were rejected because they are not a supported consistent backup.
- Stalwart Proxy was not adopted: no verified per-account existing-session termination mechanism was found, and the project accepts natural closure of old IMAP sessions.
