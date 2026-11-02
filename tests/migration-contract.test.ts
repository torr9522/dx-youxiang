import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

describe("legacy migration safety contracts", () => {
  it("rejects absolute and parent-traversing archive members", () => {
    const policy = "scripts/validate-tar-paths.awk";
    const check = (members: string) => spawnSync("awk", ["-f", policy], { input: members }).status;

    expect(check("etc/dx-youxiang/app.env\nstalwart-export/subspace_a\n")).toBe(0);
    expect(check("/etc/shadow\n")).not.toBe(0);
    expect(check("safe/../../etc/shadow\n")).not.toBe(0);
    expect(check("safe/../secret\n")).not.toBe(0);
  });

  it("separates the Stalwart import config and installs a failure rollback trap", async () => {
    const migration = await readFile("scripts/migrate-legacy.sh", "utf8");

    expect(migration).toContain('mkdir -p "$work/protected" "$work/import"');
    expect(migration).toContain('chmod 0710 "$work"');
    expect(migration).toContain('chown root:stalwart "$work/import"');
    expect(migration).toContain('import_config=$work/import/config.json');
    expect(migration).toContain('if test "$status" -ne 0 && test "$services_stopped" -eq 1');
    expect(migration).toContain('mv "$rollback/stalwart-data" "$stalwart_data"');
    expect(migration).toContain('mv "$rollback/installed-app.db" "$data_dir/app.db"');
  });
});
