import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import argon2 from "argon2";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { AppDatabase } from "../src/server/db.js";
import type { Config } from "../src/server/config.js";

const temp = mkdtempSync(join(tmpdir(), "pmh-test-"));
let context: ReturnType<typeof createApp>;
let csrf = "";
let cookie = "";
const listCalls: { accountId: string; options: Record<string, unknown> }[] = [];

const fake = {
  session: async () => ({}),
  getMessage: async (accountId: string, emailId: string) => accountId === "account-a" && emailId === "email-a" ? { id: "email-a", subject: "A only", textBody: [], htmlBody: [], bodyValues: {} } : null,
  listMessages: async (accountId: string, options: Record<string, unknown>) => {
    listCalls.push({ accountId, options });
    return accountId === "account-a"
      ? { total: 3, position: Number(options.position), list: [{ id: "email-a", subject: "A only", keywords: {} }] }
      : { total: 0, position: Number(options.position), list: [] };
  },
  mailboxStats: async (accountId: string) => accountId === "account-a"
    ? { id: "inbox-a", totalEmails: 3, unreadEmails: 1 }
    : { id: "inbox-b", totalEmails: 0, unreadEmails: 0 },
  setSeen: async () => undefined,
  deleteMessage: async () => undefined,
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

  it("accepts a valid CSRF token", async () => {
    await request(context.app).post("/api/auth/logout").set("Cookie", cookie).set("x-csrf-token", csrf).expect(204);
  });
});
