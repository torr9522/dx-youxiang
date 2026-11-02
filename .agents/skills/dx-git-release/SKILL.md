---
name: dx-git-release
description: Prepare and publish immutable Dx Youxiang candidate or stable releases to the sole authorized GitHub repository after security and clean-install gates.
---

# Dx Git Release

Use for commits, RC tags, public repository creation, release assets, or stable promotion.

## Inputs

Require authenticated GitHub user `torr9522`, target `torr9522/dx-youxiang`, a clean reviewed branch, release version, and completed gate evidence. Treat credentials pasted in chat as exposed and require revocation rather than using them.

## Workflow

1. Read `docs/RELEASE.md`; inspect status, diff, history, tags, and remotes.
2. Preserve the encrypted original Git bundle before any initial-public-history sanitation.
3. Run the complete security/license/dependency/SBOM/build/test gates and scan real environment identifiers across history.
4. Confirm the only push target is `https://github.com/torr9522/dx-youxiang.git`; never touch another repository or `torr9522/InstallNET`.
5. Create scoped commits and an immutable new RC tag. Publish checksummed source/install assets and release notes. Do not move or overwrite tags.
6. Create stable `v0.1.0` only after a clean Debian 12 remote one-command install and full acceptance pass.

## Failure Handling

If the repository already contains unrelated content, authentication identity differs, scans fail, or the working tree is dirty, stop before push/tag/release. Never force-push public history. Keep external/pending tests explicit.
