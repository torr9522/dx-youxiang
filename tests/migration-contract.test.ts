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

  it("stages inaccessible source exports and installs complete failure cleanup", async () => {
    const migration = await readFile("scripts/migrate-legacy.sh", "utf8");

    expect(migration).toContain('mkdir -p "$work/protected" "$work/import"');
    expect(migration).toContain('chmod 0710 "$work"');
    expect(migration).toContain('chown root:stalwart "$work/import"');
    expect(migration).toContain('cp -a "$source_dir/stalwart-export" "$work/import/stalwart-export"');
    expect(migration).toContain('chown -R stalwart:stalwart "$work/import/stalwart-export"');
    expect(migration).toContain('import_config=$work/import/config.json');
    expect(migration).toContain('--import "$work/import/stalwart-export"');
    expect(migration).not.toContain('--import "$source_dir/stalwart-export"');
    expect(migration).toContain('if test "$status" -ne 0 && test "$services_stopped" -eq 1');
    expect(migration).toContain('mv "$rollback/stalwart-data" "$stalwart_data"');
    expect(migration).toContain('mv "$rollback/installed-app.db" "$data_dir/app.db"');
    expect(migration).toContain('rm -rf -- "$new_store"');
    expect(migration).toContain('rm -f -- "$new_db"');
    expect(migration).toContain('http://127.0.0.1:"$app_port"/healthz');
    expect(migration).toContain('test "$attempt" -le 45 || { echo "imported application did not become healthy; rollback is in $rollback"');
    expect(migration.indexOf('http://127.0.0.1:"$app_port"/healthz')).toBeLessThan(
      migration.indexOf('"$app_base/current/scripts/health-check.sh"'),
    );
  });
});
