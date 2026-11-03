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
let createdAccountSequence = 0;

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
  });
});

const fake = {
  session: async () => ({}),
  getMessage: async (accountId: string, emailId: string) => accountId === "account-a" && emailId === "email-a" ? { id: "email-a", subject: "A only", textBody: [], htmlBody: [], bodyValues: {} } : null,
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
  deleteMailbox: async () => undefined,
} as any;

beforeAll(async () => {
  const config = {
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000,
    PUBLIC_ORIGIN: "https://mail.example.test", MAIL_DOMAIN: "example.test", MAIL_HOST: "mail.example.test",
    DATABASE_PATH: join(temp, "app.db"), ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: await argon2.hash("Correct-Horse-99!"), SESSION_SECRET: "x".repeat(48),
    STALWART_BASE_URL: "http://127.0.0.1:8080", STALWART_USERNAME: "service@example.test", STALWART_PASSWORD: "fake-secret-for-test",
    TLS_CERT_PATH: join(temp, "cert.pem"), MAIL_STORAGE_PATH: temp, TRUST_PROXY: "loopback",
  } satisfies Config;
  const db = new AppDatabase(config.DATABASE_PATH);
  db.db.prepare("INSERT INTO domains(stalwart_domain_id,name,is_default) VALUES('domain-a','example.test',1)").run();
  db.db.prepare("INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id) VALUES('account-a','a@example.test','a',1),('account-b','b@example.test','b',1)").run();
  context = createApp(config, { db, stalwart: fake });
  const login = await request(context.app).post("/api/auth/login").send({ username: "admin", password: "Correct-Horse-99!" });
  csrf = login.body.csrfToken;
  cookie = login.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => { context.db.close(); rmSync(temp, { recursive: true, force: true }); });

describe("API access control", () => {
  it("requires authentication", async () => {
    await request(context.app).get("/api/mailboxes").expect(401);
  });

  it("requires CSRF on state changes", async () => {
    await request(context.app).post("/api/auth/logout").set("Cookie", cookie).expect(403);
  });

  it("derives the Stalwart account id from the selected mailbox", async () => {
    const own = await request(context.app).get("/api/mailboxes/1/messages/email-a").set("Cookie", cookie).expect(200);
    expect(own.body.subject).toBe("A only");
    await request(context.app).get("/api/mailboxes/2/messages/email-a?accountId=account-a").set("Cookie", cookie).expect(404);
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
  });

  it("passes validated search, sort and pagination within the selected account", async () => {
    const response = await request(context.app)
      .get("/api/mailboxes/1/messages?q=needle&field=subject&order=asc&position=50&limit=25")
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body).toMatchObject({ total: 3, position: 50 });
    expect(listCalls.at(-1)).toEqual({
      accountId: "account-a",
      options: { query: "needle", field: "subject", ascending: true, position: 50, limit: 25 },
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

  it("accepts a valid CSRF token", async () => {
    await request(context.app).post("/api/auth/logout").set("Cookie", cookie).set("x-csrf-token", csrf).expect(204);
  });
});
