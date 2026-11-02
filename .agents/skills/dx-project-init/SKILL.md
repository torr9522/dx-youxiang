---
name: dx-project-init
description: Establish or recover a Dx Youxiang development workspace from a source checkout or protected project backup without importing live secrets or mail into Git.
---

# Dx Project Init

Use this skill for initial checkout, developer handover, or workspace recovery.

## Inputs

Require a source ref or verified Git bundle, a writable workspace outside deployed data, and Node.js 26. Never use a live mail-data directory as a source tree.

## Workflow

1. Read `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/HANDOVER.md`, and `docs/DEVELOPMENT_HISTORY.md`.
2. Record branch, HEAD, remotes, tags, worktree state, Node/npm versions, and free disk before changing anything.
3. Restore a bundle with `git clone`, then run `git fsck --full`; otherwise use the requested ref without rewriting history.
4. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
5. Use only fictional values from `.env.example`. Keep databases, mail, certificates, backups, and environment files outside Git.

## Acceptance And Failure

Accept only when Git integrity and all local checks pass. If the bundle, lockfile, runtime, or disk is unsuitable, stop before mutation and report the exact missing prerequisite. Do not fetch secrets from a deployed host merely to make development tests pass.
