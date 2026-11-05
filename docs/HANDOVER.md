# Developer handover

Start at `AGENTS.md`. The server code is in `src/server`, the React UI in `src/client`, deployment assets in `deploy`, lifecycle scripts in `scripts`, and reusable Codex workflows in `.agents/skills`.

Important invariants:

- Never accept a Stalwart account ID from the browser.
- Resolve every email and attachment through the selected application mailbox row.
- Keep receive enabled and external login/send disabled for every new mailbox.
- Enable `emailSend` and JMAP submission permissions only when both per-mailbox switches are enabled.
- Derive `From` and JMAP account identity from the mailbox-bound session; never accept them from the browser.
- Use mailbox-user credentials for JMAP submission and keep SMTP relay unauthenticated access denied.
- Passwords may be accepted only over authenticated CSRF-protected routes and must never be logged or returned.
- Keep mail HTML sanitization and remote-image blocking server-side.
- Test backup changes with an isolated restore, not by copying live RocksDB.

Release gates are typecheck, lint, unit/integration tests, production build, runtime dependency audit, license audit, Gitleaks history scan, SBOM generation, remote protocol tests and a real external inbound message. Do not tag a release stable while an external gate is pending.

The preserved original history is evidence, while the first public history must be scrubbed of live environment identifiers. Never delete the encrypted original Git bundle after public-history preparation.
