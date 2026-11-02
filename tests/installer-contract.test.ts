import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("native installer contracts", () => {
  it("leaves the Stalwart registry absent until x:Bootstrap/set creates it", async () => {
    const installer = await readFile("scripts/install.sh", "utf8");
    const firstStart = installer.indexOf("systemctl enable --now stalwart");
    const bootstrap = installer.indexOf("MODE=bootstrap");

    expect(firstStart).toBeGreaterThan(0);
    expect(bootstrap).toBeGreaterThan(firstStart);
    expect(installer.slice(0, firstStart)).toContain("test ! -e /etc/stalwart/config.json");
    expect(installer.slice(0, bootstrap)).not.toMatch(/(?:>|tee)[^\n]*\/etc\/stalwart\/config\.json/);
  });
});
