import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("release SBOM", () => {
  it("contains browser runtime and pinned external deployment components", async () => {
    await run("node", ["scripts/generate-sbom.mjs"]);
    const first = await readFile("sbom.cdx.json", "utf8");
    await run("node", ["scripts/generate-sbom.mjs"]);
    const second = await readFile("sbom.cdx.json", "utf8");
    expect(second).toBe(first);
    const bom = JSON.parse(second);
    const byName = new Map(bom.components.map((component: { name: string }) => [component.name, component]));
    const byPurl = new Map(bom.components.map((component: { purl?: string }) => [component.purl, component]));

    expect(byPurl.get("pkg:npm/react@19.3.1")).toMatchObject({ name: "react", version: "19.3.1" });
    expect(byPurl.get("pkg:npm/react-dom@19.3.1")).toMatchObject({ name: "react-dom", version: "19.3.1" });
    expect(byName.get("Stalwart Mail Server")).toMatchObject({ version: "1.0.1", hashes: [{ alg: "SHA-256" }] });
    expect(byName.get("Node.js")).toMatchObject({ version: "26.13.0", hashes: [{ alg: "SHA-256" }] });
    expect(byName.get("Caddy")).toMatchObject({ version: "2.11.7", hashes: [{ alg: "SHA-512" }] });
    expect(byName.get("Cosign")).toMatchObject({ version: "3.1.4", hashes: [{ alg: "SHA-256" }] });

    const root = bom.dependencies.find((dependency: { ref: string }) => dependency.ref === bom.metadata.component["bom-ref"]);
    expect(root.dependsOn).toEqual(expect.arrayContaining([
      "dx-youxiang@0.1.1|react@19.3.1",
      "dx-youxiang@0.1.1|react-dom@19.3.1",
      "stalwart-mail-server@1.0.1",
      "node.js@26.13.0",
      "caddy@2.11.7",
      "cosign@3.1.4",
    ]));
  }, 20_000);
});
