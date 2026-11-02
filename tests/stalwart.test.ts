import { afterEach, describe, expect, it, vi } from "vitest";
import { StalwartClient } from "../src/server/stalwart.js";
import type { Config } from "../src/server/config.js";

const config = {
  STALWART_BASE_URL: "http://127.0.0.1:8080",
  STALWART_USERNAME: "service@example.test",
  STALWART_PASSWORD: "not-a-real-secret",
} as Config;

afterEach(() => vi.unstubAllGlobals());

describe("Stalwart account provisioning", () => {
  it("returns only validated inbox counts from mailbox statistics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ methodResponses: [
      ["Mailbox/query", { accountId: "acc-a", ids: ["inbox-id"] }, "mq"],
      ["Mailbox/get", { accountId: "acc-a", list: [{ id: "inbox-id", totalEmails: 7, unreadEmails: 2 }] }, "mg"],
    ] }), { status: 200 })));
    await expect(new StalwartClient(config).mailboxStats("acc-a")).resolves.toEqual({ totalEmails: 7, unreadEmails: 2 });
  });

  it("scopes message queries to the selected account inbox", async () => {
    const payloads: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      const tag = payload.methodCalls[0][2];
      return tag === "inbox-query"
        ? new Response(JSON.stringify({ methodResponses: [["Mailbox/query", { accountId: "acc-a", ids: ["inbox-a"] }, tag]] }), { status: 200 })
        : new Response(JSON.stringify({ methodResponses: [
          ["Email/query", { accountId: "acc-a", ids: ["mail-a"], total: 1, position: 0 }, "eq"],
          ["Email/get", { accountId: "acc-a", list: [{ id: "mail-a" }] }, "eg"],
        ] }), { status: 200 });
    }));

    await expect(new StalwartClient(config).listMessages("acc-a", { query: "needle", field: "subject", position: 0, limit: 25 })).resolves.toMatchObject({ total: 1 });
    expect(payloads[0].methodCalls[0][1]).toMatchObject({ accountId: "acc-a", filter: { role: "inbox" } });
    expect(payloads[1].methodCalls[0][1]).toMatchObject({ accountId: "acc-a", filter: { inMailbox: "inbox-a", subject: "needle" }, position: 0, limit: 25 });
    expect(payloads[1].methodCalls[1][1].accountId).toBe("acc-a");
  });

  it("creates a real user with receive enabled and authentication/send disabled", async () => {
    let payload: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ methodResponses: [["x:Account/set", { created: { account: { id: "acc-a" } } }, "account-create"]] }), { status: 200 });
    }));
    const id = await new StalwartClient(config).createMailbox("a", "domain-a", "A");
    const account = payload.methodCalls[0][1].create.account;
    expect(id).toBe("acc-a");
    expect(account["@type"]).toBe("User");
    expect(account.roles["@type"]).toBe("Custom");
    expect(account.permissions.enabledPermissions.emailReceive).toBe(true);
    expect(account.permissions.disabledPermissions).toEqual({ authenticate: true, emailSend: true });
    expect(account.permissions.disabledPermissions.emailReceive).toBeUndefined();
  });

  it("explicitly grants authentication only while external login is enabled", async () => {
    const payloads: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ methodResponses: [["x:Account/set", { updated: { "acc-a": null } }, "account-update"]] }), { status: 200 });
    }));
    const client = new StalwartClient(config);
    await client.setExternalLogin("acc-a", true, "Strong-Test-Password!9");
    await client.setExternalLogin("acc-a", false);

    const enabled = payloads[0].methodCalls[0][1].update["acc-a"].permissions;
    const disabled = payloads[1].methodCalls[0][1].update["acc-a"].permissions;
    expect(enabled.enabledPermissions.authenticate).toBe(true);
    expect(enabled.disabledPermissions).toEqual({ emailSend: true });
    expect(disabled.enabledPermissions.authenticate).toBeUndefined();
    expect(disabled.disabledPermissions).toEqual({ authenticate: true, emailSend: true });
  });
});
