import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  const directory = await mkdtemp(join(tmpdir(), "dx-cert-retry-"));
  directories.push(directory);
  const state = join(directory, "retry-after");
  const log = join(directory, "letsencrypt.log");
  const marker = join(directory, "obtain-called");
  const obtain = join(directory, "obtain.sh");
  return { directory, state, log, marker, obtain };
}

function environment(paths: Awaited<ReturnType<typeof fixture>>) {
  return {
    ...process.env,
    DX_CERTIFICATE_RETRY_STATE_FILE: paths.state,
    DX_CERTBOT_LOG: paths.log,
    DX_OBTAIN_CERTIFICATE_SCRIPT: paths.obtain,
  };
}

describe("initial certificate retry", () => {
  it("does not contact ACME before the recorded retry time", async () => {
    const paths = await fixture();
    await writeFile(paths.state, `${Math.floor(Date.now() / 1000) + 3600}\n`, { mode: 0o600 });
    await writeFile(paths.obtain, `#!/bin/sh\ntouch '${paths.marker}'\n`, { mode: 0o700 });

    const result = await run("sh", ["scripts/retry-initial-certificate.sh"], { env: environment(paths) });

    expect(result.stdout).toContain("ACME issuance deferred until");
    await expect(stat(paths.marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records Certbot's underlying ACME retry time after a failed request", async () => {
    const paths = await fixture();
    await writeFile(paths.obtain, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    await writeFile(paths.log, [
      "acme.messages.Error: urn:ietf:params:acme:error:rateLimited :: too many certificates,",
      "retry after 2030-01-02 03:04:05 UTC: see https://letsencrypt.org/docs/rate-limits/",
    ].join(" "));

    await expect(run("sh", ["scripts/retry-initial-certificate.sh"], { env: environment(paths) }))
      .rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("ACME server requested no retry before 2030-01-02 03:04:05 UTC"),
      });
    expect(await readFile(paths.state, "utf8")).toBe("1893553445\n");
  });
});
