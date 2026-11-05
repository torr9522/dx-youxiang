import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(handler: (payload: any) => unknown) {
  const directory = await mkdtemp(join(tmpdir(), "dx-bootstrap-test-"));
  temporaryDirectories.push(directory);
  const credentialFile = join(directory, "admin.json");
  const outputFile = join(directory, "output.json");
  await writeFile(credentialFile, JSON.stringify({ username: "admin", secret: "fixture-secret" }));
  const payloads: any[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      payloads.push(payload);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ methodResponses: handler(payload) }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  return { directory, credentialFile, outputFile, payloads, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("Stalwart bootstrap maintenance", () => {
  it("rotates an imported service identity and updates the imported certificate path", async () => {
    let request = 0;
    const test = await fixture((_payload) => {
      request += 1;
      if (request === 1) return [
        ["x:Domain/query", { ids: ["domain-1"] }, "dq"],
        ["x:Account/query", { ids: ["service-1"] }, "aq"],
        ["x:NetworkListener/query", { ids: ["smtp-1", "http-1"] }, "lq"],
        ["x:Certificate/query", { ids: ["certificate-1"] }, "cq"],
      ];
      if (request === 2) return [["x:NetworkListener/get", { list: [
        { id: "smtp-1", name: "smtp" }, { id: "http-1", name: "http" },
      ] }, "lg"]];
      return [
        ["x:Account/set", { updated: { "service-1": null } }, "service"],
        ["x:Certificate/set", { updated: { "certificate-1": null } }, "cert"],
        ["x:NetworkListener/set", { updated: { "smtp-1": null, "http-1": null } }, "listeners"],
        ["x:Authentication/set", { updated: { singleton: null } }, "authentication"],
      ];
    });

    await run(process.execPath, ["scripts/bootstrap-stalwart.mjs"], { cwd: process.cwd(), env: {
      ...process.env, MODE: "configure", STALWART_BASE_URL: test.baseUrl,
      OUTPUT_FILE: test.outputFile, ADMIN_CREDENTIAL_FILE: test.credentialFile,
      MAIL_HOST: "mail.example.test", MAIL_DOMAIN: "example.test",
    } });

    const mutation = test.payloads[2].methodCalls;
    expect(mutation[0][1].update["service-1"].permissions.enabledPermissions).toMatchObject({ emailSend: true, jmapEmailCreate: true, jmapEmailSubmissionCreate: true, jmapBlobUpload: true });
    expect(mutation[0][1].update["service-1"].permissions.disabledPermissions).toEqual({});
    expect(mutation[0][1].update["service-1"].credentials["0"].secret.length).toBeGreaterThan(30);
    expect(mutation[1][1].update["certificate-1"].certificate.filePath).toBe("/etc/dx-youxiang/tls/fullchain.pem");
    expect(mutation[2][1].create).toMatchObject({
      submission: { bind: { "0.0.0.0:587": true }, protocol: "smtp", useTls: true, implicitTls: false },
      submissions: { bind: { "0.0.0.0:465": true }, protocol: "smtp", useTls: true, implicitTls: true },
    });
    expect(mutation[3]).toEqual(["x:Authentication/set", { update: { singleton: {
      minPasswordLength: 6,
      minPasswordStrength: "zero",
    } } }, "authentication"]);
    expect(JSON.parse(await readFile(test.outputFile, "utf8"))).toMatchObject({
      domainId: "domain-1", serviceId: "service-1", serviceUsername: "dx-youxiang@example.test",
    });
  });

  it("schedules the documented account reindex task with the recovery administrator", async () => {
    const test = await fixture(() => [["x:Task/set", { created: { reindex: { id: "task-1" } } }, "reindex"]]);
    await run(process.execPath, ["scripts/bootstrap-stalwart.mjs"], { cwd: process.cwd(), env: {
      ...process.env, MODE: "reindex", STALWART_BASE_URL: test.baseUrl,
      OUTPUT_FILE: test.outputFile, ADMIN_CREDENTIAL_FILE: test.credentialFile,
    } });

    expect(test.payloads[0].methodCalls[0]).toEqual(["x:Task/set", { create: { reindex: {
      "@type": "StoreMaintenance", maintenanceType: "reindexAccounts",
    } } }, "reindex"]);
    expect(JSON.parse(await readFile(test.outputFile, "utf8"))).toEqual({ taskId: "task-1" });
  });
});
