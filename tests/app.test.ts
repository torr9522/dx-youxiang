import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import argon2 from "argon2";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessTlsCertificate, createApp } from "../src/server/app.js";
import { AppDatabase } from "../src/server/db.js";
import type { Config } from "../src/server/config.js";

const temp = mkdtempSync(join(tmpdir(), "dx-youxiang-test-"));
let context: ReturnType<typeof createApp>;
let csrf = "";
let cookie = "";
const listCalls: { accountId: string; options: Record<string, unknown> }[] = [];
const externalLoginCalls: { accountId: string; enabled: boolean; password?: string }[] = [];
const updateMailboxCalls: { accountId: string; patch: Record<string, unknown> }[] = [];
const createMailboxCalls: { localPart: string; domainId: string; description: string }[] = [];
const deleteMailboxCalls: string[] = [];
const translationCalls: Array<{ protocol: string; input: string }> = [];
let createdAccountSequence = 0;
const inlinePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe("TLS readiness", () => {
  const future = new Date(Date.now() + 30 * 86_400_000).toUTCString();

  it("rejects the self-signed bootstrap certificate", () => {
    expect(assessTlsCertificate({ validTo: future, subject: "CN=mail.example.test", issuer: "CN=mail.example.test", checkHost: () => "mail.example.test" }, "mail.example.test"))
      .toEqual({ ok: false, detail: "bootstrap self-signed certificate" });
  });

  it("rejects a certificate for another hostname", () => {
    expect(assessTlsCertificate({ validTo: future, subject: "CN=other.example.test", issuer: "CN=Example CA", checkHost: () => undefined }, "mail.example.test"))
      .toEqual({ ok: false, detail: "certificate hostname mismatch" });
  });

  it("accepts a non-self-issued certificate with the expected hostname and lifetime", () => {
    const result = assessTlsCertificate({ validTo: future, subject: "CN=mail.example.test", issuer: "CN=Example CA", checkHost: () => "mail.example.test" }, "mail.example.test");
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("production chain");
  });

  it("accepts only an explicitly identified staging certificate in staging mode", () => {
    const staging = assessTlsCertificate({ validTo: future, subject: "CN=mail.example.test", issuer: "CN=(STAGING) Ersatz Edamame E1", checkHost: () => "mail.example.test" }, "mail.example.test", "staging");
    expect(staging).toMatchObject({ ok: true });
    expect(staging.detail).toContain("not publicly trusted");
    expect(assessTlsCertificate({ validTo: future, subject: "CN=mail.example.test", issuer: "CN=Example CA", checkHost: () => "mail.example.test" }, "mail.example.test", "staging"))
      .toEqual({ ok: false, detail: "certificate is not from Let's Encrypt staging" });
  });

  it("never accepts a staging certificate in production mode", () => {
    expect(assessTlsCertificate({ validTo: future, subject: "CN=mail.example.test", issuer: "CN=(STAGING) Ersatz Edamame E1", checkHost: () => "mail.example.test" }, "mail.example.test", "production"))
      .toEqual({ ok: false, detail: "staging certificate is not valid for production" });
  });
});

const fake = {
  session: async () => ({}),
  getMessage: async (accountId: string, emailId: string) => accountId === "account-a" && emailId === "email-a" ? {
    id: "email-a", subject: "A only", textBody: [], htmlBody: [{ partId: "html" }],
    bodyValues: { html: { value: '<table><tbody><tr><td>Your verification code is 482731. Visit https://example.test to continue.</td></tr></tbody></table><img src="cid:logo@example.test"><img src="https://remote.example.test/pixel.png?secret=value">' } },
    attachments: [{ blobId: "inline-blob", cid: "<logo@example.test>", type: "image/png", size: inlinePng.length }],
  } : accountId === "account-b" && emailId === "email-b" ? {
    id: "email-b", subject: "B only", textBody: [{ partId: "text" }], htmlBody: [], bodyValues: { text: { value: "A separate English message for deletion testing." } }, attachments: [],
  } : null,
  listMessages: async (accountId: string, options: Record<string, unknown>) => {
    listCalls.push({ accountId, options });
    const position = Number(options.position);
    if (accountId !== "account-a") return { total: 0, position, list: [] };
    const messages = [
      { id: "email-a", subject: "A only", keywords: {} },
      { id: "email-a2", subject: "A second", keywords: { "$seen": true } },
      { id: "email-a3", subject: "A third", keywords: {} },
    ];
    return { total: messages.length, position, list: messages.slice(position, position + Number(options.limit)) };
  },
  mailboxStats: async (accountId: string) => accountId === "account-a"
    ? { id: "inbox-a", totalEmails: 3, unreadEmails: 1 }
    : { id: "inbox-b", totalEmails: 0, unreadEmails: 0 },
  setSeen: async () => undefined,
  deleteMessage: async () => undefined,
  setExternalLogin: async (accountId: string, enabled: boolean, password?: string) => { externalLoginCalls.push({ accountId, enabled, password }); },
  updateMailbox: async (accountId: string, patch: Record<string, unknown>) => { updateMailboxCalls.push({ accountId, patch }); },
  createMailbox: async (localPart: string, domainId: string, description: string) => {
    createMailboxCalls.push({ localPart, domainId, description });
    if (localPart === "fail") throw new Error("simulated account creation failure");
    return `created-account-${++createdAccountSequence}`;
  },
  deleteMailbox: async (accountId: string) => {
    deleteMailboxCalls.push(accountId);
    if (accountId === "account-b") throw new Error("simulated account deletion failure");
  },
  download: async () => new Response(inlinePng, { headers: { "content-type": "image/png" } }),
} as any;

const fakeTranslationProvider = {
  complete: async (config: { protocol: string }, _instructions: string, input: string) => {
    translationCalls.push({ protocol: config.protocol, input });
    if (input.startsWith("Connectivity test")) return "DX_TRANSLATION_OK";
    const parsed = JSON.parse(input) as { nodes: Array<{ id: string; text: string }> };
    return JSON.stringify({ translations: parsed.nodes.map((node) => ({
      id: node.id,
      text: node.text
        .replace("Your verification code is", "您的验证码是")
        .replace("Visit", "访问")
        .replace("to continue", "以继续")
        .replace("A separate English message for deletion testing.", "用于删除测试的独立英文邮件。"),
    })) });
  },
};

beforeAll(async () => {
  const config = {
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000,
    PUBLIC_ORIGIN: "https://mail.example.test", MAIL_DOMAIN: "example.test", MAIL_HOST: "mail.example.test",
    DATABASE_PATH: join(temp, "app.db"), ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: await argon2.hash("Correct-Horse-99!"), SESSION_SECRET: "x".repeat(48),
    STALWART_BASE_URL: "http://127.0.0.1:8080", STALWART_USERNAME: "service@example.test", STALWART_PASSWORD: "fake-secret-for-test",
    TLS_CERT_PATH: join(temp, "cert.pem"), MAIL_STORAGE_PATH: temp, TRUST_PROXY: "loopback", ACME_MODE: "production",
  } satisfies Config;
  const db = new AppDatabase(config.DATABASE_PATH);
  db.db.prepare("INSERT INTO domains(stalwart_domain_id,name,is_default) VALUES('domain-a','example.test',1)").run();
  db.db.prepare("INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id) VALUES('account-a','a@example.test','a',1),('account-b','b@example.test','b',1)").run();
  context = createApp(config, { db, stalwart: fake, translationProvider: fakeTranslationProvider });
  const login = await request(context.app).post("/api/auth/login").send({ username: "admin", password: "Correct-Horse-99!" });
  csrf = login.body.csrfToken;
  cookie = login.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => { context.db.close(); rmSync(temp, { recursive: true, force: true }); });

describe("API access control", () => {
  it("distinguishes process health from dependency readiness", async () => {
    await request(context.app).get("/healthz").expect(200, { status: "ok", component: "web" });
    const readiness = await request(context.app).get("/readyz").expect(503);
    expect(readiness.body).toMatchObject({
      status: "degraded",
      checks: {
        web: { ok: true },
        database: { ok: true },
        jmap: { ok: true },
        stalwart: { ok: true },
        tls: { ok: false },
      },
    });
  });

  it("requires authentication", async () => {
    await request(context.app).get("/api/mailboxes").expect(401);
  });

  it("does not rewrite unknown API or static paths as SPA pages", async () => {
    const apiResponse = await request(context.app).get("/api/not-a-real-route").set("Cookie", cookie).expect(404);
    expect(apiResponse.headers["content-type"]).toContain("application/json");
    expect(apiResponse.body).toEqual({ error: "API 路径不存在" });
    const staticResponse = await request(context.app).get("/not-a-real-page").expect(404);
    expect(staticResponse.text).toContain("Cannot GET /not-a-real-page");
    expect(staticResponse.text).not.toContain('<div id="root">');
  });

  it("requires CSRF on state changes", async () => {
    await request(context.app).post("/api/auth/logout").set("Cookie", cookie).expect(403);
  });

  it("keeps fresh translation settings empty and never returns API key material", async () => {
    const fresh = await request(context.app).get("/api/settings/translation").set("Cookie", cookie).expect(200);
    expect(fresh.body).toMatchObject({ protocol: null, baseUrl: "", hasApiKey: false, model: "", targetLanguage: "zh-CN", enabled: false, configured: false, tested: false, cacheEntries: 0 });
    expect(JSON.stringify(fresh.body)).not.toContain("apiKey");

    const saved = await request(context.app).put("/api/settings/translation")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ protocol: "responses", baseUrl: "https://api.example.test/v1/", apiKey: "fictional-test-provider-key", model: "translation-test-model", targetLanguage: "zh-CN", enabled: true })
      .expect(200);
    expect(saved.body).toMatchObject({ protocol: "responses", hasApiKey: true, configured: true, tested: false, enabled: false });
    expect(JSON.stringify(saved.body)).not.toContain("fictional-test-provider-key");
    const stored = context.db.db.prepare("SELECT api_key_ciphertext FROM translation_settings WHERE id=1").get() as { api_key_ciphertext: string };
    expect(stored.api_key_ciphertext).not.toContain("fictional-test-provider-key");
  });

  it("requires a real connection test before enabling translation", async () => {
    const tested = await request(context.app).post("/api/settings/translation/test")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({}).expect(200);
    expect(tested.body).toMatchObject({ tested: true, enabled: false });
    expect(translationCalls.at(-1)?.protocol).toBe("responses");

    const enabled = await request(context.app).put("/api/settings/translation")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ protocol: "responses", baseUrl: "https://api.example.test/v1/", model: "translation-test-model", targetLanguage: "zh-CN", enabled: true })
      .expect(200);
    expect(enabled.body).toMatchObject({ tested: true, enabled: true });
  });

  it("translates owned HTML text nodes, protects identifiers and reuses the server cache", async () => {
    const detail = await request(context.app).get("/api/mailboxes/1/messages/email-a").set("Cookie", cookie).expect(200);
    expect(detail.body.translation).toMatchObject({ label: "英文", translatable: true, configured: true, enabled: true });
    const before = translationCalls.length;
    const translated = await request(context.app).post("/api/mailboxes/1/messages/email-a/translate")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({}).expect(200);
    expect(translated.body).toMatchObject({ cached: false, partial: false });
    expect(translated.body.html).toContain("<table>");
    expect(translated.body.html).toContain("482731");
    expect(translated.body.html).toContain("https://example.test");
    expect(translated.body.html).toContain("data-remote-src=");
    expect(translated.body.html).not.toContain("remote.example.test");
    const cached = await request(context.app).post("/api/mailboxes/1/messages/email-a/translate")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({}).expect(200);
    expect(cached.body).toMatchObject({ cached: true, partial: false, html: translated.body.html });
    expect(translationCalls).toHaveLength(before + 1);
    await request(context.app).post("/api/mailboxes/2/messages/email-a/translate")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({}).expect(404);
    expect(context.db.db.prepare("SELECT stalwart_account_id,email_id FROM translation_cache WHERE mailbox_id=1").get()).toEqual({ stalwart_account_id: "account-a", email_id: "email-a" });
  });

  it("cleans a message translation cache only after deleting the owning message", async () => {
    await request(context.app).post("/api/mailboxes/2/messages/email-b/translate")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({}).expect(200);
    expect(context.db.db.prepare("SELECT COUNT(*) count FROM translation_cache WHERE mailbox_id=2 AND email_id='email-b'").get()).toEqual({ count: 1 });
    await request(context.app).delete("/api/mailboxes/2/messages/email-b")
      .set("Cookie", cookie).set("x-csrf-token", csrf).expect(204);
    expect(context.db.db.prepare("SELECT COUNT(*) count FROM translation_cache WHERE mailbox_id=2 AND email_id='email-b'").get()).toEqual({ count: 0 });
  });

  it("derives the Stalwart account id from the selected mailbox", async () => {
    const own = await request(context.app).get("/api/mailboxes/1/messages/email-a").set("Cookie", cookie).expect(200);
    expect(own.body.subject).toBe("A only");
    expect(own.body.html).toContain("/api/mailboxes/1/messages/email-a/inline-images/inline-blob");
    expect(own.body.html).toContain("/api/mailboxes/1/messages/email-a/remote-images/");
    expect(own.body.html).not.toContain("remote.example.test");
    await request(context.app).get("/api/mailboxes/2/messages/email-a?accountId=account-a").set("Cookie", cookie).expect(404);
  });

  it("serves CID images only through the owning mailbox and validates image content", async () => {
    const own = await request(context.app).get("/api/mailboxes/1/messages/email-a/inline-images/inline-blob").set("Cookie", cookie).expect(200);
    expect(own.headers["content-type"]).toBe("image/png");
    expect(own.headers["x-content-type-options"]).toBe("nosniff");
    expect(own.body).toEqual(inlinePng);
    await request(context.app).get("/api/mailboxes/2/messages/email-a/inline-images/inline-blob").set("Cookie", cookie).expect(404);
    await request(context.app).get("/api/mailboxes/1/messages/email-a/inline-images/other-blob").set("Cookie", cookie).expect(404);
  });

  it("rejects tampered or cross-message remote image tokens", async () => {
    const detail = await request(context.app).get("/api/mailboxes/1/messages/email-a").set("Cookie", cookie).expect(200);
    const path = /data-remote-src="([^"]+)"/.exec(detail.body.html)?.[1]?.replaceAll("&amp;", "&");
    expect(path).toBeTruthy();
    const parts = String(path).split("/");
    const token = parts.at(-1)!;
    parts[parts.length - 1] = `${token.slice(0, 10)}${token[10] === "a" ? "b" : "a"}${token.slice(11)}`;
    await request(context.app).get(parts.join("/")).set("Cookie", cookie).expect(400);
    await request(context.app).get(String(path).replace("/messages/email-a/", "/messages/email-b/")).set("Cookie", cookie).expect(404);
  });

  it("preserves the numeric application id when Stalwart returns an inbox id", async () => {
    const response = await request(context.app).get("/api/mailboxes?stats=1").set("Cookie", cookie).expect(200);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, stalwart_account_id: "account-a", totalEmails: 3, unreadEmails: 1 }),
      expect.objectContaining({ id: 2, stalwart_account_id: "account-b", totalEmails: 0, unreadEmails: 0 }),
    ]));
    expect(response.body.some((row: { id: unknown }) => typeof row.id !== "number")).toBe(false);
  });

  it("validates mailbox ids and numeric pagination parameters", async () => {
    await request(context.app).get("/api/mailboxes/inbox-a/messages").set("Cookie", cookie).expect(400);
    await request(context.app).get("/api/mailboxes/1/messages?position=").set("Cookie", cookie).expect(400);
    await request(context.app).get("/api/mailboxes/1/messages?position=NaN").set("Cookie", cookie).expect(400);
    await request(context.app).get("/api/mailboxes/1/messages?limit=0").set("Cookie", cookie).expect(400);
    await request(context.app).get("/api/mailboxes/1/messages?limit=101").set("Cookie", cookie).expect(400);
    await request(context.app).get("/api/mailboxes/1/messages?read=invalid").set("Cookie", cookie).expect(400);
  });

  it("passes validated search, sort and pagination within the selected account", async () => {
    const response = await request(context.app)
      .get("/api/mailboxes/1/messages?q=needle&field=subject&read=unread&order=asc&position=50&limit=25")
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body).toMatchObject({ total: 3, position: 50 });
    expect(listCalls.at(-1)).toEqual({
      accountId: "account-a",
      options: { query: "needle", field: "subject", read: "unread", ascending: true, position: 50, limit: 25 },
    });
  });

  it("paginates multiple messages and returns an empty mailbox", async () => {
    const first = await request(context.app).get("/api/mailboxes/1/messages?position=0&limit=2").set("Cookie", cookie).expect(200);
    const second = await request(context.app).get("/api/mailboxes/1/messages?position=2&limit=2").set("Cookie", cookie).expect(200);
    const empty = await request(context.app).get("/api/mailboxes/2/messages?position=0&limit=2").set("Cookie", cookie).expect(200);
    expect(first.body).toMatchObject({ total: 3, position: 0 });
    expect(first.body.list).toHaveLength(2);
    expect(second.body).toMatchObject({ total: 3, position: 2 });
    expect(second.body.list).toHaveLength(1);
    expect(empty.body).toMatchObject({ total: 0, position: 0, list: [] });
  });

  it("accepts six-character mailbox passwords without composition rules", async () => {
    await request(context.app).patch("/api/mailboxes/1/external-login")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ enabled: true, password: "123456" }).expect(204);
    await request(context.app).post("/api/mailboxes/1/password")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ password: "aaaaaa" }).expect(204);
    expect(externalLoginCalls.at(-1)).toEqual({ accountId: "account-a", enabled: true, password: "123456" });
    expect(updateMailboxCalls.at(-1)).toEqual({ accountId: "account-a", patch: { credentials: { "0": { "@type": "Password", secret: "aaaaaa" } } } });
  });

  it("rejects mailbox passwords shorter than six characters", async () => {
    await request(context.app).patch("/api/mailboxes/1/external-login")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ enabled: true, password: "12345" }).expect(400);
    await request(context.app).post("/api/mailboxes/1/password")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ password: "abcde" }).expect(400);
  });

  it("bulk creates ranges of 10 and 100 through real account provisioning", async () => {
    const ten = Array.from({ length: 10 }, (_, index) => String(index + 1));
    const first = await request(context.app).post("/api/mailboxes/bulk")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({ localParts: ten }).expect(207);
    expect(first.body).toMatchObject({ total: 10, succeeded: 10, skippedExisting: 0, duplicates: 0, failed: 0 });

    const hundred = Array.from({ length: 100 }, (_, index) => String(index + 1));
    const second = await request(context.app).post("/api/mailboxes/bulk")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({ localParts: hundred }).expect(207);
    expect(second.body).toMatchObject({ total: 100, succeeded: 90, skippedExisting: 10, duplicates: 0, failed: 0 });
    expect(context.db.db.prepare("SELECT COUNT(*) count FROM mailboxes WHERE address LIKE '%@example.test'").get()?.count).toBe(102);
    expect(createMailboxCalls).toEqual(expect.arrayContaining([
      { localPart: "1", domainId: "domain-a", description: "1@example.test" },
      { localPart: "100", domainId: "domain-a", description: "100@example.test" },
    ]));
  });

  it("reports existing, duplicate, invalid and failed items without rolling back successes", async () => {
    const response = await request(context.app).post("/api/mailboxes/bulk")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ localParts: ["a", "Fresh", "fresh", "bad@prefix", "fail"] }).expect(207);
    expect(response.body).toMatchObject({ total: 5, succeeded: 1, skippedExisting: 1, duplicates: 1, failed: 2 });
    expect(response.body.results).toEqual([
      expect.objectContaining({ address: "a@example.test", status: "skipped_existing" }),
      expect.objectContaining({ address: "fresh@example.test", status: "created" }),
      expect.objectContaining({ address: "fresh@example.test", status: "duplicate" }),
      expect.objectContaining({ address: "bad@prefix@example.test", status: "failed", reason: "邮箱前缀格式无效" }),
      expect.objectContaining({ address: "fail@example.test", status: "failed" }),
    ]);
    expect(context.db.db.prepare("SELECT address FROM mailboxes WHERE address='fresh@example.test'").get()).toBeTruthy();
    expect(context.db.db.prepare("SELECT address FROM mailboxes WHERE address='fail@example.test'").get()).toBeUndefined();
  });

  it("rejects an empty or oversized bulk request instead of truncating it", async () => {
    await request(context.app).post("/api/mailboxes/bulk")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({ localParts: [] }).expect(400);
    await request(context.app).post("/api/mailboxes/bulk")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ localParts: Array.from({ length: 101 }, (_, index) => `over-${index}`) }).expect(400);
  });

  it("bulk deletes server-resolved accounts, deduplicates ids and continues after a failure", async () => {
    const before = deleteMailboxCalls.length;
    const response = await request(context.app).post("/api/mailboxes/bulk-delete")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({ ids: [1, 2, 2, 3] }).expect(207);
    expect(response.body).toMatchObject({ total: 3, deleted: 2, failed: 1 });
    expect(response.body.results).toEqual([
      expect.objectContaining({ id: 1, address: "a@example.test", status: "deleted" }),
      expect.objectContaining({ id: 2, address: "b@example.test", status: "failed", reason: "删除失败" }),
      expect.objectContaining({ id: 3, address: "1@example.test", status: "deleted" }),
    ]);
    expect(deleteMailboxCalls.slice(before)).toEqual(["account-a", "account-b", "created-account-1"]);
    expect(context.db.db.prepare("SELECT id FROM mailboxes WHERE id=1").get()).toBeUndefined();
    expect(context.db.db.prepare("SELECT COUNT(*) count FROM translation_cache WHERE mailbox_id=1").get()).toEqual({ count: 0 });
    expect(context.db.db.prepare("SELECT status FROM mailboxes WHERE id=2").get()).toEqual({ status: "error" });
    expect(context.db.db.prepare("SELECT id FROM mailboxes WHERE id=3").get()).toBeUndefined();
  });

  it("reports missing bulk deletion ids and rejects an oversized request", async () => {
    const response = await request(context.app).post("/api/mailboxes/bulk-delete")
      .set("Cookie", cookie).set("x-csrf-token", csrf).send({ ids: [999_999, 4] }).expect(207);
    expect(response.body).toMatchObject({ total: 2, deleted: 1, failed: 1 });
    expect(response.body.results[0]).toMatchObject({ id: 999_999, status: "failed", reason: "邮箱不存在" });
    await request(context.app).post("/api/mailboxes/bulk-delete")
      .set("Cookie", cookie).set("x-csrf-token", csrf)
      .send({ ids: Array.from({ length: 101 }, (_, index) => index + 1) }).expect(400);
  });

  it("deletes one mailbox without requiring the address in the request body", async () => {
    const row = context.db.db.prepare("SELECT id,stalwart_account_id FROM mailboxes WHERE address='3@example.test'").get() as { id: number; stalwart_account_id: string };
    await request(context.app).delete(`/api/mailboxes/${row.id}`)
      .set("Cookie", cookie).set("x-csrf-token", csrf).expect(204);
    expect(deleteMailboxCalls.at(-1)).toBe(row.stalwart_account_id);
    expect(context.db.db.prepare("SELECT id FROM mailboxes WHERE id=?").get(row.id)).toBeUndefined();
  });

  it("keeps the SQLite mailbox when a single Stalwart deletion fails", async () => {
    await request(context.app).delete("/api/mailboxes/2")
      .set("Cookie", cookie).set("x-csrf-token", csrf).expect(500);
    expect(context.db.db.prepare("SELECT status FROM mailboxes WHERE id=2").get()).toEqual({ status: "error" });
  });

  it("accepts a valid CSRF token", async () => {
    await request(context.app).post("/api/auth/logout").set("Cookie", cookie).set("x-csrf-token", csrf).expect(204);
  });
});
