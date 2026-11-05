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

    await expect(new StalwartClient(config).listMessages("acc-a", { query: "needle", field: "subject", read: "unread", position: 0, limit: 25 })).resolves.toMatchObject({ total: 1 });
    expect(payloads[0].methodCalls[0][1]).toMatchObject({ accountId: "acc-a", filter: { role: "inbox" } });
    expect(payloads[1].methodCalls[0][1]).toMatchObject({ accountId: "acc-a", filter: { inMailbox: "inbox-a", subject: "needle", notKeyword: "$seen" }, position: 0, limit: 25 });
    expect(payloads[1].methodCalls[1][1].accountId).toBe("acc-a");
  });

  it("combines read-state filters with the selected account inbox", async () => {
    const payloads: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      const tag = payload.methodCalls[0][2];
      return tag === "inbox-query"
        ? new Response(JSON.stringify({ methodResponses: [["Mailbox/query", { ids: ["inbox-a"] }, tag]] }), { status: 200 })
        : new Response(JSON.stringify({ methodResponses: [["Email/query", { ids: [], total: 0, position: 0 }, "eq"], ["Email/get", { list: [] }, "eg"]] }), { status: 200 });
    }));
    const client = new StalwartClient(config);
    await client.listMessages("acc-a", { read: "read" });
    expect(payloads[1].methodCalls[0][1].filter).toEqual({ inMailbox: "inbox-a", hasKeyword: "$seen" });
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
    await client.setExternalLogin("acc-a", true, "123456");
    await client.setExternalLogin("acc-a", false);

    const enabled = payloads[0].methodCalls[0][1].update["acc-a"].permissions;
    const disabled = payloads[1].methodCalls[0][1].update["acc-a"].permissions;
    expect(enabled.enabledPermissions.authenticate).toBe(true);
    expect(payloads[0].methodCalls[0][1].update["acc-a"].credentials["0"].secret).toBe("123456");
    expect(enabled.disabledPermissions).toEqual({ emailSend: true });
    expect(disabled.enabledPermissions.authenticate).toBeUndefined();
    expect(disabled.disabledPermissions).toEqual({ authenticate: true, emailSend: true });
  });

  it("grants submission only when external login and sending are both enabled", async () => {
    let payload: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ methodResponses: [["x:Account/set", { updated: { "acc-a": null } }, "account-update"]] }), { status: 200 });
    }));
    await new StalwartClient(config).setMailboxPermissions("acc-a", true, true);
    const permissions = payload.methodCalls[0][1].update["acc-a"].permissions;
    expect(permissions.enabledPermissions).toMatchObject({ authenticate: true, emailSend: true, jmapEmailCreate: true, jmapEmailSubmissionCreate: true, jmapBlobUpload: true });
    expect(permissions.disabledPermissions).toEqual({});
  });

  it("submits a user-authenticated JMAP message with a server-derived identity and Sent move", async () => {
    const requests: Array<{ headers: any; payload: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      requests.push({ headers: init?.headers, payload });
      if (requests.length === 1) return new Response(JSON.stringify({ methodResponses: [
        ["Mailbox/query", { ids: ["drafts-id"] }, "drafts"],
        ["Mailbox/query", { ids: ["sent-id"] }, "sent"],
        ["Identity/get", { list: [{ id: "identity-id", email: "a@example.test" }] }, "identities"],
      ] }), { status: 200 });
      return new Response(JSON.stringify({ methodResponses: [
        ["Email/set", { created: { message: { id: "email-id" } } }, "email-create"],
        ["EmailSubmission/set", { created: { submission: { id: "submission-id" } } }, "submission-create"],
      ] }), { status: 200 });
    }));
    const result = await new StalwartClient(config).saveDraftOrSubmit({ address: "a@example.test", password: "mailbox-password", accountId: "acc-a", to: ["b@example.test"], cc: [], bcc: [], subject: "Hello", text: "Body", attachments: [], submit: true });
    expect(result).toEqual({ emailId: "email-id", submissionId: "submission-id", status: "queued" });
    expect(requests[1].headers.authorization).toBe(`Basic ${Buffer.from("a@example.test:mailbox-password").toString("base64")}`);
    expect(requests[1].payload.methodCalls[0][1].create.message.from).toEqual([{ email: "a@example.test" }]);
    expect(requests[1].payload.methodCalls[1][1]).toMatchObject({ accountId: "acc-a", create: { submission: { identityId: "identity-id", emailId: "#message" } } });
    expect(requests[1].payload.using).toContain("urn:ietf:params:jmap:submission");
    expect(requests[1].payload.methodCalls[1][1].onSuccessUpdateEmail["#submission"]).toMatchObject({ "mailboxIds/drafts-id": null, "mailboxIds/sent-id": true, "keywords/$draft": null });
  });

  it("submits an admin-selected mailbox through the protected service identity", async () => {
    const requests: Array<{ headers: any; payload: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      requests.push({ headers: init?.headers, payload });
      if (requests.length === 1) return new Response(JSON.stringify({ methodResponses: [
        ["Mailbox/query", { ids: ["drafts-id"] }, "drafts"],
        ["Mailbox/query", { ids: ["sent-id"] }, "sent"],
        ["Identity/get", { list: [{ id: "identity-id", email: "selected@example.test" }] }, "identities"],
      ] }), { status: 200 });
      return new Response(JSON.stringify({ methodResponses: [
        ["Email/set", { created: { message: { id: "email-id" } } }, "email-create"],
        ["EmailSubmission/set", { created: { submission: { id: "submission-id" } } }, "submission-create"],
      ] }), { status: 200 });
    }));

    const result = await new StalwartClient(config).saveDraftOrSubmitAsService({
      address: "selected@example.test", accountId: "selected-account", to: ["recipient@example.test"],
      cc: [], bcc: [], subject: "Admin", text: "Body", attachments: [], submit: true,
    });

    expect(result.status).toBe("queued");
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.authorization).toBe(`Basic ${Buffer.from("service@example.test:not-a-real-secret").toString("base64")}`);
    }
    expect(requests[1].payload.methodCalls[0][1]).toMatchObject({
      accountId: "selected-account",
      create: { message: { from: [{ email: "selected@example.test" }] } },
    });
    expect(requests[1].payload.methodCalls[1][1]).toMatchObject({
      accountId: "selected-account",
      create: { submission: { identityId: "identity-id", emailId: "#message" } },
    });
  });

  it("discovers standard folders by JMAP role and exposes junk counts", async () => {
    let payload: any;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ methodResponses: [["Mailbox/get", { list: [
        { id: "inbox-id", name: "Inbox", role: "inbox", totalEmails: 4, unreadEmails: 2 },
        { id: "junk-id", name: "Junk Mail", role: "junk", totalEmails: 3, unreadEmails: 1 },
        { id: "trash-id", name: "Trash", role: "trash", totalEmails: 0, unreadEmails: 0 },
      ] }, "mailbox-folders"]] }), { status: 200 });
    }));

    const folders = await new StalwartClient(config).listFolders("acc-a");
    expect(payload.methodCalls[0][1]).toEqual({ accountId: "acc-a", properties: ["id", "name", "role", "totalEmails", "unreadEmails"] });
    expect(folders.find((folder) => folder.role === "junk")).toEqual({ role: "junk", id: "junk-id", name: "Junk Mail", totalEmails: 3, unreadEmails: 1 });
    expect(folders.find((folder) => folder.role === "sent")).toMatchObject({ id: null, totalEmails: 0, unreadEmails: 0 });
  });

  it("queries junk on the server instead of filtering an inbox page", async () => {
    const payloads: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      return payload.methodCalls[0][0] === "Mailbox/query"
        ? new Response(JSON.stringify({ methodResponses: [["Mailbox/query", { ids: ["junk-id"] }, "inbox-query"]] }), { status: 200 })
        : new Response(JSON.stringify({ methodResponses: [
          ["Email/query", { ids: ["spam-1"], total: 1, position: 0 }, "eq"],
          ["Email/get", { list: [{ id: "spam-1", subject: "Server result" }] }, "eg"],
        ] }), { status: 200 });
    }));

    await new StalwartClient(config).listMessages("acc-a", { folder: "junk", query: "needle", position: 50, limit: 25 });
    expect(payloads[0].methodCalls[0][1]).toMatchObject({ accountId: "acc-a", filter: { role: "junk" } });
    expect(payloads[1].methodCalls[0][1]).toMatchObject({ accountId: "acc-a", filter: { inMailbox: "junk-id", text: "needle" }, position: 50, limit: 25, calculateTotal: true });
  });

  it("moves messages with Email/set patches while preserving ids and unrelated memberships", async () => {
    const payloads: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      const method = payload.methodCalls[0][0];
      if (method === "Mailbox/get") return new Response(JSON.stringify({ methodResponses: [["Mailbox/get", { list: [
        { id: "inbox-id", role: "inbox" }, { id: "junk-id", role: "junk" }, { id: "trash-id", role: "trash" },
      ] }, "mailbox-folders"]] }), { status: 200 });
      if (method === "Email/get") return new Response(JSON.stringify({ methodResponses: [["Email/get", {
        list: [{ id: "mail-1", mailboxIds: { "inbox-id": true, "archive-id": true }, keywords: { "$seen": true } }],
        notFound: ["foreign-mail"],
      }, "email-action-get"]] }), { status: 200 });
      return new Response(JSON.stringify({ methodResponses: [["Email/set", { updated: { "mail-1": null } }, "email-action-set"]] }), { status: 200 });
    }));

    const result = await new StalwartClient(config).manageMessages("acc-a", ["mail-1", "foreign-mail", "mail-1"], "markSpam");
    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1, succeededIds: ["mail-1"] });
    expect(payloads[2].methodCalls[0][1]).toEqual({
      accountId: "acc-a",
      update: { "mail-1": {
        mailboxIds: { "archive-id": true, "junk-id": true },
        "keywords/$junk": true,
        "keywords/$notjunk": null,
      } },
    });
  });

  it("restores junk to inbox and moves junk to Trash without destroying the Email", async () => {
    const actions: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      const method = payload.methodCalls[0][0];
      if (method === "Mailbox/get") return new Response(JSON.stringify({ methodResponses: [["Mailbox/get", { list: [
        { id: "inbox-id", role: "inbox" }, { id: "junk-id", role: "junk" }, { id: "trash-id", role: "trash" },
      ] }, "mailbox-folders"]] }), { status: 200 });
      if (method === "Email/get") return new Response(JSON.stringify({ methodResponses: [["Email/get", { list: [
        { id: "mail-1", mailboxIds: { "junk-id": true }, keywords: { "$junk": true, "$seen": true } },
      ] }, "email-action-get"]] }), { status: 200 });
      actions.push(payload.methodCalls[0][1]);
      return new Response(JSON.stringify({ methodResponses: [["Email/set", { updated: { "mail-1": null } }, "email-action-set"]] }), { status: 200 });
    }));

    const client = new StalwartClient(config);
    await client.manageMessages("acc-a", ["mail-1"], "markNotSpam");
    await client.manageMessages("acc-a", ["mail-1"], "trash");
    expect(actions[0].update["mail-1"]).toEqual({ mailboxIds: { "inbox-id": true }, "keywords/$junk": null, "keywords/$notjunk": true });
    expect(actions[1].update["mail-1"]).toEqual({ mailboxIds: { "trash-id": true } });
    expect(actions.every((action) => action.destroy === undefined)).toBe(true);
  });

  it("reports Email/set partial failures without counting failed updates as successes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      const method = payload.methodCalls[0][0];
      if (method === "Mailbox/get") return new Response(JSON.stringify({ methodResponses: [["Mailbox/get", { list: [
        { id: "inbox-id", role: "inbox" }, { id: "junk-id", role: "junk" }, { id: "trash-id", role: "trash" },
      ] }, "mailbox-folders"]] }), { status: 200 });
      if (method === "Email/get") return new Response(JSON.stringify({ methodResponses: [["Email/get", { list: [
        { id: "mail-1", mailboxIds: { "inbox-id": true } },
        { id: "mail-2", mailboxIds: { "inbox-id": true } },
      ] }, "email-action-get"]] }), { status: 200 });
      return new Response(JSON.stringify({ methodResponses: [["Email/set", {
        updated: { "mail-1": null },
        notUpdated: { "mail-2": { type: "invalidProperties", description: "Mailbox update rejected" } },
      }, "email-action-set"]] }), { status: 200 });
    }));

    const result = await new StalwartClient(config).manageMessages("acc-a", ["mail-1", "mail-2"], "markSpam");
    expect(result).toEqual({
      total: 2,
      succeeded: 1,
      failed: 1,
      succeededIds: ["mail-1"],
      failures: [{ id: "mail-2", reason: "Mailbox update rejected" }],
    });
  });
});
