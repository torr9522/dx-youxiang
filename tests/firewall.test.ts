import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "dx-firewall-"));
  directories.push(directory);
  const nft = join(directory, "nft");
  const rules = join(directory, "ruleset");
  const state = join(directory, "smtp-inbound.enabled");
  await writeFile(nft, `#!/bin/sh
case "$1" in
  list) test -f "$DX_NFT_RULESET" && cat "$DX_NFT_RULESET" ;;
  delete) : > "$DX_NFT_RULESET" ;;
  -f) cat > "$DX_NFT_RULESET" ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
  await chmod(nft, 0o700);
  return { nft, rules, state };
}

function environment(paths: Awaited<ReturnType<typeof fixture>>) {
  return {
    ...process.env,
    DX_NFT_BIN: paths.nft,
    DX_NFT_RULESET: paths.rules,
    DX_SMTP_INBOUND_STATE: paths.state,
  };
}

describe("receive-only firewall", () => {
  it("gates public SMTP until the readiness marker exists", async () => {
    const paths = await fixture();
    const env = environment(paths);

    await run("sh", ["scripts/firewall.sh", "apply"], { env });
    const gated = await readFile(paths.rules, "utf8");
    expect(gated).toContain("dx-youxiang SMTP readiness gate");
    expect(gated).toContain("dx-youxiang receive-only policy");
    await expect(run("sh", ["scripts/firewall.sh", "check-inbound"], { env }))
      .rejects.toMatchObject({ code: 1 });

    await writeFile(paths.state, "", { mode: 0o600 });
    await run("sh", ["scripts/firewall.sh", "apply"], { env });
    const ready = await readFile(paths.rules, "utf8");
    expect(ready).not.toContain("dx-youxiang SMTP readiness gate");
    expect(ready).toContain("dx-youxiang receive-only policy");
    await expect(run("sh", ["scripts/firewall.sh", "check-inbound"], { env })).resolves.toBeDefined();
  });
});
