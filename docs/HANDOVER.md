# Developer handover

Start at `AGENTS.md`. The server code is in `src/server`, the React UI in `src/client`, deployment assets in `deploy`, lifecycle scripts in `scripts`, and reusable Codex workflows in `.agents/skills`.

Important invariants:

- Never accept a Stalwart account ID from the browser.
- Resolve every email and attachment through the selected application mailbox row.
- Never add send, reply, forward, submission or relay features.
- Never remove `emailSend` from disabled permissions.
- Passwords may be accepted only over authenticated CSRF-protected routes and must never be logged or returned.
- Keep mail HTML sanitization and remote-image blocking server-side.
- Test backup changes with an isolated restore, not by copying live RocksDB.

Release gates are typecheck, lint, unit/integration tests, production build, runtime dependency audit, license audit, Gitleaks history scan, SBOM generation, remote protocol tests and a real external inbound message. Do not tag a release stable while an external gate is pending.

The preserved original history is evidence, while the first public history must be scrubbed of live environment identifiers. Never delete the encrypted original Git bundle after public-history preparation.
