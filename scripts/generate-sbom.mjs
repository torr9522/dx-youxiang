#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JsonValidator } from "@cyclonedx/cyclonedx-library/Validation";
import { Version } from "@cyclonedx/cyclonedx-library/Spec";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = readFileSync(path.join(root, "scripts/install.sh"), "utf8");

function installerValue(name) {
  const match = installer.match(new RegExp(`^${name}=([^\\s]+)$`, "m"));
  if (!match) throw new Error(`missing ${name} in scripts/install.sh`);
  return match[1];
}

const runtimeComponents = [
  {
    "bom-ref": `stalwart-mail-server@${installerValue("STALWART_VERSION")}`,
    type: "application",
    name: "Stalwart Mail Server",
    version: installerValue("STALWART_VERSION"),
    scope: "required",
    hashes: [{ alg: "SHA-256", content: installerValue("STALWART_SHA256") }],
    licenses: [{ expression: "AGPL-3.0-only OR LicenseRef-SEL" }],
    externalReferences: [{ type: "vcs", url: "https://github.com/stalwartlabs/stalwart" }],
    properties: [{ name: "dx-youxiang:distribution", value: "independent upstream executable verified by Sigstore" }],
  },
  {
    "bom-ref": `node.js@${installerValue("NODE_VERSION")}`,
    type: "application",
    name: "Node.js",
    version: installerValue("NODE_VERSION"),
    scope: "required",
    hashes: [{ alg: "SHA-256", content: installerValue("NODE_SHA256") }],
    licenses: [{ license: { id: "MIT" } }],
    externalReferences: [{ type: "distribution", url: `https://nodejs.org/dist/v${installerValue("NODE_VERSION")}/` }],
    properties: [{ name: "dx-youxiang:distribution", value: "private pinned runtime" }],
  },
  {
    "bom-ref": `caddy@${installerValue("CADDY_VERSION")}`,
    type: "application",
    name: "Caddy",
    version: installerValue("CADDY_VERSION"),
    scope: "required",
    hashes: [{ alg: "SHA-512", content: installerValue("CADDY_SHA512") }],
    licenses: [{ license: { id: "Apache-2.0" } }],
    externalReferences: [{ type: "vcs", url: "https://github.com/caddyserver/caddy" }],
    properties: [{ name: "dx-youxiang:distribution", value: "fresh-install web server; existing-Caddy mode preserves the host binary" }],
  },
  {
    "bom-ref": `cosign@${installerValue("COSIGN_VERSION")}`,
    type: "application",
    name: "Cosign",
    version: installerValue("COSIGN_VERSION"),
    scope: "required",
    hashes: [{ alg: "SHA-256", content: installerValue("COSIGN_SHA256") }],
    licenses: [{ license: { id: "Apache-2.0" } }],
    externalReferences: [{ type: "vcs", url: "https://github.com/sigstore/cosign" }],
    properties: [{ name: "dx-youxiang:distribution", value: "installer-only Stalwart attestation verifier" }],
  },
];

const raw = execFileSync(path.join(root, "node_modules/.bin/cyclonedx-npm"), [
  "--omit", "dev",
  "--spec-version", "1.5",
  "--output-format", "JSON",
  "--output-file", "-",
  "--output-reproducible",
  "--validate",
], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const bom = JSON.parse(raw);

const rootRef = bom.metadata?.component?.["bom-ref"];
const dependencyByRef = new Map(bom.dependencies.map((dependency) => [dependency.ref, dependency]));
const reachable = new Set([rootRef]);
const pending = [rootRef];
while (pending.length) {
  const ref = pending.pop();
  for (const child of dependencyByRef.get(ref)?.dependsOn ?? []) {
    if (!reachable.has(child)) {
      reachable.add(child);
      pending.push(child);
    }
  }
}
bom.components = bom.components.filter((component) => reachable.has(component["bom-ref"]));
bom.dependencies = bom.dependencies
  .filter((dependency) => reachable.has(dependency.ref))
  .map((dependency) => ({ ...dependency, dependsOn: (dependency.dependsOn ?? []).filter((ref) => reachable.has(ref)) }));

const npmPurls = new Set(bom.components.map((component) => component.purl));
for (const required of ["pkg:npm/react@19.3.1", "pkg:npm/react-dom@19.3.1"]) {
  if (!npmPurls.has(required)) throw new Error(`CycloneDX npm graph omitted required runtime dependency ${required}`);
}

const refs = new Set((bom.components ?? []).map((component) => component["bom-ref"]));
for (const component of runtimeComponents) {
  if (refs.has(component["bom-ref"])) throw new Error(`duplicate SBOM component ${component["bom-ref"]}`);
  bom.components.push(component);
  bom.dependencies.push({ ref: component["bom-ref"], dependsOn: [] });
}

const rootDependency = bom.dependencies.find((dependency) => dependency.ref === rootRef);
if (!rootDependency) throw new Error("npm SBOM omitted the root dependency graph");
rootDependency.dependsOn = [...new Set([...rootDependency.dependsOn, ...runtimeComponents.map((component) => component["bom-ref"])])].sort();

const output = `${JSON.stringify(bom, null, 2)}\n`;
const validationError = await new JsonValidator(Version.v1dot5).validate(output);
if (validationError !== null) throw new Error(`final CycloneDX validation failed: ${JSON.stringify(validationError)}`);
writeFileSync(path.join(root, "sbom.cdx.json"), output, { mode: 0o644 });
console.log(`Wrote CycloneDX SBOM with ${bom.components.length} components`);
