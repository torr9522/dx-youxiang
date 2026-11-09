import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import argon2 from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import type { Config } from "../src/server/config.js";
import { AppDatabase } from "../src/server/db.js";

let adminHash = "";

beforeAll(async () => { adminHash = await argon2.hash("Correct-Horse-99!"); });

type TestContext = ReturnType<typeof createApp> & {
  directory: string;
  cookie: string;
  csrf: string;
  deletedAccounts: string[];
};

async function testContext(): Promise<TestContext> {
  const directory = mkdtempSync(join(tmpdir(), "dx-mailbox-groups-"));
  const config = {
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000,
    PUBLIC_ORIGIN: "https://mail.example.test", MAIL_DOMAIN: "example.test", MAIL_HOST: "mail.example.test",
    DATABASE_PATH: join(directory, "app.db"), ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: adminHash, SESSION_SECRET: "x".repeat(48),
    STALWART_BASE_URL: "http://127.0.0.1:8080", STALWART_USERNAME: "service@example.test", STALWART_PASSWORD: "test-secret",
    TLS_CERT_PATH: join(directory, "cert.pem"), MAIL_STORAGE_PATH: directory, TRUST_PROXY: "loopback", ACME_MODE: "production",
  } satisfies Config;
  const deletedAccounts: string[] = [];
  let sequence = 0;
  const stalwart = {
    createMailbox: async (localPart: string) => `created-${localPart}-${++sequence}`,
    deleteMailbox: async (accountId: string) => {
      deletedAccounts.push(accountId);
      if (accountId.includes("fail")) throw new Error("simulated deletion failure");
    },
    authenticateMailbox: async (_address: string, password: string) => password === "mailbox-password"
      ? { accountIds: new Set(["account-a"]) } : null,
  } as any;
  const db = new AppDatabase(config.DATABASE_PATH);
  db.db.prepare("INSERT INTO domains(stalwart_domain_id,name,is_default) VALUES('domain-a','example.test',1)").run();
  db.db.prepare(`INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id)
    VALUES('account-a','a@example.test','a',1),('account-b','b@example.test','b',1)`).run();
  const app = createApp(config, { db, stalwart });
  const login = await request(app.app).post("/api/auth/login").send({ username: "admin", password: "Correct-Horse-99!" }).expect(200);
  return {
    ...app,
    directory,
    cookie: login.headers["set-cookie"][0].split(";")[0],
    csrf: login.body.csrfToken,
    deletedAccounts,
  };
}

function closeContext(context: TestContext) {
  context.db.close();
  rmSync(context.directory, { recursive: true, force: true });
}

async function createGroup(context: TestContext, name: string) {
  return request(context.app).post("/api/mailbox-groups")
    .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
    .send({ name }).expect(201);
}

async function deletePreview(context: TestContext, id: number) {
  return request(context.app).get(`/api/mailbox-groups/${id}/delete-preview`)
    .set("Cookie", context.cookie).expect(200);
}

describe("mailbox group migration", () => {
  it("backfills a v0.1.8 database once and keeps the renamed default identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "dx-group-migration-"));
    const path = join(directory, "app.db");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE domains (
        id INTEGER PRIMARY KEY,
        stalwart_domain_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        is_default INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        dns_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE mailboxes (
        id INTEGER PRIMARY KEY,
        stalwart_account_id TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL UNIQUE COLLATE NOCASE,
        local_part TEXT NOT NULL,
        domain_id INTEGER NOT NULL REFERENCES domains(id),
        note TEXT NOT NULL DEFAULT '',
        external_login INTEGER NOT NULL DEFAULT 0,
        email_send INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO domains(id,stalwart_domain_id,name,is_default) VALUES(7,'domain-a','example.test',1);
      INSERT INTO mailboxes(id,stalwart_account_id,address,local_part,domain_id)
        VALUES(11,'account-a','a@example.test','a',7),(12,'account-b','b@example.test','b',7);
    `);
    legacy.close();

    const first = new AppDatabase(path);
    const defaultGroup = first.db.prepare("SELECT id,name,sort_order,is_system_default FROM mailbox_groups").get() as any;
    expect(defaultGroup).toMatchObject({ name: "dx", sort_order: 0, is_system_default: 1 });
    expect(first.db.prepare("SELECT id,group_id FROM mailboxes ORDER BY id").all()).toEqual([
      { id: 11, group_id: defaultGroup.id }, { id: 12, group_id: defaultGroup.id },
    ]);
    first.db.prepare("UPDATE mailbox_groups SET name='私人邮箱' WHERE id=?").run(defaultGroup.id);
    first.close();

    const second = new AppDatabase(path);
    expect(second.db.prepare("SELECT id,name FROM mailbox_groups WHERE is_system_default=1").all()).toEqual([
      { id: defaultGroup.id, name: "私人邮箱" },
    ]);
    expect(() => second.db.prepare("DELETE FROM mailbox_groups WHERE id=?").run(defaultGroup.id)).toThrow(/cannot be deleted/);
    expect(() => second.db.prepare("UPDATE mailbox_groups SET is_system_default=0 WHERE id=?").run(defaultGroup.id)).toThrow(/immutable/);
    second.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("mailbox group API", () => {
  it("creates, renames and atomically reorders ordinary groups while protecting the default", async () => {
    const context = await testContext();
    try {
      const work = await createGroup(context, "工作");
      const friends = await createGroup(context, "朋友");
      await request(context.app).patch(`/api/mailbox-groups/${work.body.id}`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ name: "工作邮箱" }).expect(200);
      await request(context.app).post("/api/mailbox-groups")
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ name: "工作邮箱" }).expect(409);
      await request(context.app).post("/api/mailbox-groups/reorder")
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ groupIds: [friends.body.id, work.body.id] }).expect(204);
      const groups = await request(context.app).get("/api/mailbox-groups").set("Cookie", context.cookie).expect(200);
      expect(groups.body.map((group: any) => [group.name, group.sort_order])).toEqual([
        ["dx", 0], ["朋友", 1], ["工作邮箱", 2],
      ]);
      await request(context.app).post("/api/mailbox-groups/reorder")
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ groupIds: [groups.body[0].id, friends.body.id, work.body.id] }).expect(400);
      await request(context.app).get(`/api/mailbox-groups/${groups.body[0].id}/delete-preview`)
        .set("Cookie", context.cookie).expect(409);
    } finally { closeContext(context); }
  });

  it("keeps group management admin-only", async () => {
    const context = await testContext();
    try {
      context.db.db.prepare("UPDATE mailboxes SET external_login=1 WHERE id=1").run();
      const login = await request(context.app).post("/api/auth/login")
        .send({ username: "a@example.test", password: "mailbox-password" }).expect(200);
      const mailboxCookie = login.headers["set-cookie"][0].split(";")[0];
      await request(context.app).get("/api/mailbox-groups").set("Cookie", mailboxCookie).expect(403);
      await request(context.app).post("/api/mailbox-groups")
        .set("Cookie", mailboxCookie).set("x-csrf-token", login.body.csrfToken)
        .send({ name: "越权" }).expect(403);
    } finally { closeContext(context); }
  });

  it("assigns single and bulk-created mailboxes and moves only the SQLite group relationship", async () => {
    const context = await testContext();
    try {
      const group = await createGroup(context, "测试邮箱");
      const created = await request(context.app).post("/api/mailboxes")
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ localPart: "single", domainId: 1, note: "keep", groupId: group.body.id }).expect(201);
      const bulk = await request(context.app).post("/api/mailboxes/bulk")
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ localParts: ["bulk-a", "bulk-b", "a"], groupId: group.body.id }).expect(207);
      expect(bulk.body).toMatchObject({ succeeded: 2, skippedExisting: 1 });
      expect(context.db.db.prepare("SELECT COUNT(*) count FROM mailboxes WHERE group_id=?").get(group.body.id)).toEqual({ count: 3 });
      const before = context.db.db.prepare(`SELECT stalwart_account_id,address,note,external_login,email_send
        FROM mailboxes WHERE id=?`).get(created.body.id);
      const defaultGroup = context.db.db.prepare("SELECT id FROM mailbox_groups WHERE is_system_default=1").get() as { id: number };
      await request(context.app).patch(`/api/mailboxes/${created.body.id}/group`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ groupId: defaultGroup.id }).expect(204);
      expect(context.db.db.prepare(`SELECT stalwart_account_id,address,note,external_login,email_send
        FROM mailboxes WHERE id=?`).get(created.body.id)).toEqual(before);
      expect(context.db.db.prepare("SELECT group_id FROM mailboxes WHERE id=?").get(created.body.id)).toEqual({ group_id: defaultGroup.id });
    } finally { closeContext(context); }
  });

  it("moves every member transactionally when deleting to a selected target", async () => {
    const context = await testContext();
    try {
      const source = await createGroup(context, "来源");
      const target = await createGroup(context, "目标");
      context.db.db.prepare("UPDATE mailboxes SET group_id=?").run(source.body.id);
      const preview = await deletePreview(context, source.body.id);
      await request(context.app).post(`/api/mailbox-groups/${source.body.id}/delete`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ mode: "MOVE_TO_TARGET", targetGroupId: target.body.id, memberVersion: preview.body.memberVersion }).expect(200);
      expect(context.db.db.prepare("SELECT COUNT(*) count FROM mailboxes WHERE group_id=?").get(target.body.id)).toEqual({ count: 2 });
      expect(context.db.db.prepare("SELECT id FROM mailbox_groups WHERE id=?").get(source.body.id)).toBeUndefined();
    } finally { closeContext(context); }
  });

  it("rolls back every member and the group when a target migration fails", async () => {
    const context = await testContext();
    try {
      const source = await createGroup(context, "事务来源");
      const target = await createGroup(context, "事务目标");
      context.db.db.prepare("UPDATE mailboxes SET group_id=?").run(source.body.id);
      const preview = await deletePreview(context, source.body.id);
      context.db.db.exec(`CREATE TRIGGER test_reject_group_move
        BEFORE UPDATE OF group_id ON mailboxes
        WHEN OLD.group_id=${source.body.id}
        BEGIN SELECT RAISE(ABORT, 'simulated group move failure'); END;`);
      await request(context.app).post(`/api/mailbox-groups/${source.body.id}/delete`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ mode: "MOVE_TO_TARGET", targetGroupId: target.body.id, memberVersion: preview.body.memberVersion }).expect(500);
      expect(context.db.db.prepare("SELECT id FROM mailbox_groups WHERE id=?").get(source.body.id)).toBeTruthy();
      expect(context.db.db.prepare("SELECT COUNT(*) count FROM mailboxes WHERE group_id=?").get(source.body.id)).toEqual({ count: 2 });
      expect(context.db.db.prepare("SELECT COUNT(*) count FROM mailboxes WHERE group_id=?").get(target.body.id)).toEqual({ count: 0 });
    } finally { closeContext(context); }
  });

  it("uses the stable default identity after rename and rejects a stale member snapshot", async () => {
    const context = await testContext();
    try {
      const source = await createGroup(context, "待迁移");
      const defaultGroup = context.db.db.prepare("SELECT id FROM mailbox_groups WHERE is_system_default=1").get() as { id: number };
      context.db.db.prepare("UPDATE mailbox_groups SET name='私人邮箱' WHERE id=?").run(defaultGroup.id);
      context.db.db.prepare("UPDATE mailboxes SET group_id=? WHERE id=1").run(source.body.id);
      const stale = await deletePreview(context, source.body.id);
      context.db.db.prepare(`INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id,group_id)
        VALUES('account-new','new@example.test','new',1,?)`).run(source.body.id);
      await request(context.app).post(`/api/mailbox-groups/${source.body.id}/delete`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ mode: "MOVE_TO_DEFAULT", memberVersion: stale.body.memberVersion }).expect(409);
      const current = await deletePreview(context, source.body.id);
      await request(context.app).post(`/api/mailbox-groups/${source.body.id}/delete`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ mode: "MOVE_TO_DEFAULT", memberVersion: current.body.memberVersion }).expect(200);
      expect(context.db.db.prepare("SELECT COUNT(*) count FROM mailboxes WHERE group_id=?").get(defaultGroup.id)).toEqual({ count: 3 });
      expect(context.db.db.prepare("SELECT name FROM mailbox_groups WHERE id=?").get(defaultGroup.id)).toEqual({ name: "私人邮箱" });
    } finally { closeContext(context); }
  });

  it("deletes complete accounts through the existing flow and stops on the first failure", async () => {
    const context = await testContext();
    try {
      const successGroup = await createGroup(context, "完整删除");
      context.db.db.prepare(`INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id,group_id)
        VALUES('delete-ok','delete-ok@example.test','delete-ok',1,?)`).run(successGroup.body.id);
      const successPreview = await deletePreview(context, successGroup.body.id);
      await request(context.app).post(`/api/mailbox-groups/${successGroup.body.id}/delete`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ mode: "DELETE_WITH_MAILBOXES", memberVersion: successPreview.body.memberVersion, confirmation: "DELETE 1" }).expect(200);
      expect(context.deletedAccounts).toContain("delete-ok");
      expect(context.db.db.prepare("SELECT id FROM mailbox_groups WHERE id=?").get(successGroup.body.id)).toBeUndefined();

      const partialGroup = await createGroup(context, "部分失败");
      context.db.db.prepare(`INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id,group_id)
        VALUES('delete-first','delete-first@example.test','delete-first',1,?),
              ('delete-fail','delete-fail@example.test','delete-fail',1,?),
              ('delete-never','delete-never@example.test','delete-never',1,?)`).run(partialGroup.body.id, partialGroup.body.id, partialGroup.body.id);
      const partialPreview = await deletePreview(context, partialGroup.body.id);
      const partial = await request(context.app).post(`/api/mailbox-groups/${partialGroup.body.id}/delete`)
        .set("Cookie", context.cookie).set("x-csrf-token", context.csrf)
        .send({ mode: "DELETE_WITH_MAILBOXES", memberVersion: partialPreview.body.memberVersion, confirmation: "DELETE 3" }).expect(207);
      expect(partial.body).toMatchObject({ status: "partial_failure", groupDeleted: false, failed: { address: "delete-fail@example.test" } });
      expect(context.deletedAccounts).not.toContain("delete-never");
      expect(context.db.db.prepare("SELECT id FROM mailbox_groups WHERE id=?").get(partialGroup.body.id)).toBeTruthy();
      expect(context.db.db.prepare("SELECT status FROM mailboxes WHERE address='delete-fail@example.test'").get()).toEqual({ status: "error" });
    } finally { closeContext(context); }
  });
});

afterAll(() => undefined);
