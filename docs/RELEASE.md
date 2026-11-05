# Release Process

1. Confirm a clean worktree, reviewed commits, `main`, and the intended version in package/changelog/docs.
2. Run all gates in `docs/TESTING.md`, regenerate `sbom.cdx.json`, and inspect the diff. The official CycloneDX npm generator is used because npm's built-in `--omit=dev` output can omit direct browser dependencies that are also peer dependencies. The project generator prunes unreachable development components, fails if React or ReactDOM is absent, adds exact installer metadata for pinned external components, and validates the final CycloneDX schema.
3. Preserve the original encrypted Git bundle. Before the first public push, scan all history for secrets and real deployment identifiers.
4. Confirm the only GitHub push target is `https://github.com/torr9522/dx-youxiang.git` and the authenticated user is `torr9522`.
5. Create a new immutable candidate tag such as `v0.1.0-rc.1`. Never move or delete a published tag.
6. Run `scripts/build-release.sh 0.1.0-rc.1 <empty-directory>` and publish the tarball, ZIP archive, `install.sh`, `RELEASE_NOTES.md`, `sbom.cdx.json`, and `SHA256SUMS`.
7. Reinstall the test server and run the remote one-command clean-install gate. A failure is fixed in source, committed, and published as the next RC before another clean reinstall.
8. Only after every stable gate passes, create `v0.1.0`, rebuild assets, publish the stable release, and switch README's default installer to the stable tag.

Do not force-push, publish from a dirty tree, use a chat-exposed token, touch another repository, or modify the separate `torr9522/InstallNET` project.
