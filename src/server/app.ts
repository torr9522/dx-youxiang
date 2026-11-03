import { X509Certificate } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Config } from "./config.js";
import { AppDatabase, type MailboxRow } from "./db.js";
import { AuthService, audit } from "./security.js";
import { presentMessage } from "./mail.js";
import { StalwartClient, StalwartError } from "./stalwart.js";

const localPart = z.string().min(1).max(64).regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/, "邮箱前缀格式无效");
const mailboxPassword = z.string().min(6, "密码至少需要 6 个字符").max(256);
const bulkMailboxLimit = 100;
const routeId = z.string().regex(/^[1-9][0-9]*$/, "ID 必须为正整数").transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

type CertificateStatusSource = Pick<X509Certificate, "validTo" | "issuer" | "subject" | "checkHost">;

export function assessTlsCertificate(cert: CertificateStatusSource, mailHost: string, now = Date.now()) {
  const days = Math.floor((Date.parse(cert.validTo) - now) / 86_400_000);
  if (cert.subject === cert.issuer) return { ok: false, detail: "bootstrap self-signed certificate" };
  if (!cert.checkHost(mailHost)) return { ok: false, detail: "certificate hostname mismatch" };
  return { ok: days > 7, detail: `${days} days remaining` };
}

function queryInteger(defaultValue: number, minimum: number, maximum: number) {
  return z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return Number(value);
    return value;
  }, z.number().int().min(minimum).max(maximum));
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error(result.error.issues[0]?.message ?? "请求参数无效"), { status: 400 });
  return result.data;
}

export function createApp(config: Config, deps?: { db?: AppDatabase; stalwart?: StalwartClient }) {
  const db = deps?.db ?? new AppDatabase(config.DATABASE_PATH);
  const stalwart = deps?.stalwart ?? new StalwartClient(config);
  const auth = new AuthService(db, config);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  }));
  app.use(express.json({ limit: "128kb" }));
  app.use(cookieParser());

  app.get("/healthz", (_req, res) => res.json({ status: "ok", component: "web" }));
  app.get("/readyz", async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = { web: { ok: true } };
    try { checks.database = { ok: db.health() }; } catch { checks.database = { ok: false, detail: "database unavailable" }; }
    try { await stalwart.session(); checks.jmap = { ok: true }; checks.stalwart = { ok: true }; } catch { checks.jmap = { ok: false, detail: "JMAP unavailable" }; checks.stalwart = { ok: false }; }
    try {
      const stat = await fs.statfs(config.MAIL_STORAGE_PATH);
      const free = stat.bavail * stat.bsize;
      const total = stat.blocks * stat.bsize;
      const freePercent = total > 0 ? (free / total) * 100 : 0;
      checks.mailStorage = {
        ok: free > 512 * 1024 * 1024 && freePercent >= 15,
        detail: `${Math.round(free / 1024 / 1024)} MiB free (${freePercent.toFixed(1)}%)`,
      };
    } catch { checks.mailStorage = { ok: false, detail: "mail storage unavailable" }; }
    try {
      const cert = new X509Certificate(await fs.readFile(config.TLS_CERT_PATH));
      checks.tls = assessTlsCertificate(cert, config.MAIL_HOST);
    } catch { checks.tls = { ok: false, detail: "certificate unavailable" }; }
    const ok = Object.values(checks).every((check) => check.ok);
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded", checks });
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false, skipSuccessfulRequests: true });
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const input = parse(z.object({ username: z.string().max(64), password: z.string().max(512) }), req.body);
    const ok = await auth.verifyLogin(input.username, input.password);
    db.db.prepare("INSERT INTO login_attempts(ip,username,success) VALUES(?,?,?)").run(req.ip ?? "unknown", input.username.slice(0, 64), ok ? 1 : 0);
    db.db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now','-30 days')").run();
    if (!ok) {
      audit(db, req, "login.failed", "admin", undefined, { username: input.username });
      return res.status(401).json({ error: "用户名或密码错误" });
    }
    const csrfToken = auth.createSession(req, res);
    audit(db, req, "login.success", "admin");
    res.json({ username: config.ADMIN_USERNAME, csrfToken });
  });

  app.use("/api", auth.authenticate);
  app.use("/api", auth.csrf);
  app.get("/api/auth/session", (_req, res) => res.json({ username: config.ADMIN_USERNAME, csrfToken: res.locals.csrfToken }));
  app.post("/api/auth/logout", (req, res) => { auth.destroySession(req, res); audit(db, req, "logout", "admin"); res.status(204).end(); });

  app.get("/api/domains", (_req, res) => {
    const rows = db.db.prepare("SELECT * FROM domains ORDER BY is_default DESC,name").all();
    res.json(rows);
  });

  app.post("/api/domains/check", async (req, res) => {
    const { name } = parse(z.object({ name: z.string().min(3).max(253).toLowerCase() }), req.body);
    const mx = await dns.resolveMx(name).catch(() => []);
    const expected = config.MAIL_HOST.toLowerCase();
    res.json({ name, mx, valid: mx.some((record) => record.exchange.toLowerCase().replace(/\.$/, "") === expected) });
  });

  app.post("/api/domains", async (req, res) => {
    const input = parse(z.object({ name: z.string().min(3).max(253).toLowerCase(), makeDefault: z.boolean().default(false) }), req.body);
    const { name } = input;
    const mx = await dns.resolveMx(name).catch(() => []);
    if (!mx.some((record) => record.exchange.toLowerCase().replace(/\.$/, "") === config.MAIL_HOST.toLowerCase())) return res.status(409).json({ error: `MX 必须指向 ${config.MAIL_HOST}` });
    const stalwartId = await stalwart.createDomain(name);
    db.db.exec("BEGIN IMMEDIATE");
    try {
      if (input.makeDefault) db.db.prepare("UPDATE domains SET is_default=0").run();
      db.db.prepare("INSERT INTO domains(stalwart_domain_id,name,is_default,dns_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP)").run(stalwartId, name, input.makeDefault ? 1 : 0);
      db.db.exec("COMMIT");
    } catch (error) { db.db.exec("ROLLBACK"); throw error; }
    audit(db, req, "domain.create", "domain", stalwartId, { name });
    res.status(201).json({ id: Number(db.db.prepare("SELECT id FROM domains WHERE name=?").get(name)?.id), name });
  });

  app.patch("/api/domains/:id/default", (req, res) => {
    const id = parse(routeId, req.params.id);
    db.db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.db.prepare("SELECT id FROM domains WHERE id=? AND enabled=1").get(id)) throw Object.assign(new Error("域名不存在或未启用"), { status: 404 });
      db.db.prepare("UPDATE domains SET is_default=0").run();
      db.db.prepare("UPDATE domains SET is_default=1 WHERE id=?").run(id);
      db.db.exec("COMMIT");
    } catch (error) { db.db.exec("ROLLBACK"); throw error; }
    audit(db, req, "domain.default", "domain", String(id));
    res.status(204).end();
  });

  app.get("/api/mailboxes", async (req, res) => {
    const search = String(req.query.search ?? "").slice(0, 128);
    const rows = db.db.prepare(`SELECT m.*,d.name domain FROM mailboxes m JOIN domains d ON d.id=m.domain_id
      WHERE m.address LIKE ? OR m.note LIKE ? ORDER BY m.created_at DESC`).all(`%${search}%`, `%${search}%`) as any[];
    const withStats = req.query.stats === "1";
    const result = await Promise.all(rows.map(async (row) => {
      if (!withStats) return row;
      try {
        const stats = await stalwart.mailboxStats(row.stalwart_account_id);
        return { ...row, totalEmails: stats.totalEmails, unreadEmails: stats.unreadEmails };
      }
      catch { return { ...row, totalEmails: null, unreadEmails: null }; }
    }));
    res.json(result);
  });

  app.get("/api/dashboard", async (_req, res) => {
    const rows = db.db.prepare("SELECT * FROM mailboxes WHERE status='active'").all() as unknown as MailboxRow[];
    const stats = await Promise.all(rows.map(async (row) => ({ row, stats: await stalwart.mailboxStats(row.stalwart_account_id).catch(() => ({ totalEmails: 0, unreadEmails: 0 })) })));
    res.json({
      mailboxCount: rows.length,
      receivingCount: rows.length,
      unreadCount: stats.reduce((sum, item) => sum + Number(item.stats.unreadEmails ?? 0), 0),
      mailboxes: stats.map(({ row, stats: count }) => ({ id: row.id, address: row.address, unreadEmails: count.unreadEmails ?? 0 })),
    });
  });

  async function createMailboxRecord(input: { localPart: string; domain: any; note: string }, req: Request) {
    const normalizedLocalPart = input.localPart.toLowerCase();
    const address = `${normalizedLocalPart}@${input.domain.name}`;
    if (db.db.prepare("SELECT id FROM mailboxes WHERE address=?").get(address)) {
      throw Object.assign(new Error("邮箱地址已存在"), { status: 409 });
    }
    const accountId = await stalwart.createMailbox(normalizedLocalPart, input.domain.stalwart_domain_id, input.note || address);
    try {
      const result = db.db.prepare(`INSERT INTO mailboxes(stalwart_account_id,address,local_part,domain_id,note) VALUES(?,?,?,?,?)`)
        .run(accountId, address, normalizedLocalPart, input.domain.id, input.note);
      audit(db, req, "mailbox.create", "mailbox", String(result.lastInsertRowid), { address });
      return { id: Number(result.lastInsertRowid), address, external_login: 0 };
    } catch (error) {
      await stalwart.deleteMailbox(accountId).catch(() => undefined);
      throw error;
    }
  }

  app.post("/api/mailboxes", async (req, res) => {
    const input = parse(z.object({ localPart, domainId: z.number().int().positive(), note: z.string().max(500).default("") }), req.body);
    const domain = db.db.prepare("SELECT * FROM domains WHERE id=? AND enabled=1").get(input.domainId) as any;
    if (!domain) return res.status(400).json({ error: "域名未配置或未启用" });
    res.status(201).json(await createMailboxRecord({ localPart: input.localPart, domain, note: input.note }, req));
  });

  app.post("/api/mailboxes/bulk", async (req, res) => {
    const input = parse(z.object({
      localParts: z.array(z.string().max(256)).min(1, "至少提供一个邮箱前缀").max(bulkMailboxLimit, `每次最多创建 ${bulkMailboxLimit} 个邮箱`),
    }), req.body);
    const domain = db.db.prepare("SELECT * FROM domains WHERE enabled=1 AND is_default=1 LIMIT 1").get() as any;
    if (!domain) return res.status(409).json({ error: "默认邮箱域名未配置或未启用" });

    const results: Array<{ localPart: string; address: string; status: "created" | "skipped_existing" | "duplicate" | "failed"; reason?: string }> = [];
    const seen = new Set<string>();
    for (const rawLocalPart of input.localParts) {
      const normalizedLocalPart = rawLocalPart.trim().toLowerCase();
      const address = `${normalizedLocalPart}@${domain.name}`;
      if (seen.has(normalizedLocalPart)) {
        results.push({ localPart: normalizedLocalPart, address, status: "duplicate", reason: "本批次中重复" });
        continue;
      }
      seen.add(normalizedLocalPart);
      const validation = localPart.safeParse(normalizedLocalPart);
      if (!validation.success) {
        results.push({ localPart: normalizedLocalPart, address, status: "failed", reason: validation.error.issues[0]?.message ?? "邮箱前缀格式无效" });
        continue;
      }
      if (db.db.prepare("SELECT id FROM mailboxes WHERE address=?").get(address)) {
        results.push({ localPart: normalizedLocalPart, address, status: "skipped_existing", reason: "邮箱已存在" });
        continue;
      }
      try {
        await createMailboxRecord({ localPart: normalizedLocalPart, domain, note: "" }, req);
        results.push({ localPart: normalizedLocalPart, address, status: "created" });
      } catch (error) {
        const reason = error instanceof StalwartError ? error.message : error instanceof Error && (error as any).status < 500 ? error.message : "创建失败";
        results.push({ localPart: normalizedLocalPart, address, status: "failed", reason });
      }
    }
    const count = (status: (typeof results)[number]["status"]) => results.filter((item) => item.status === status).length;
    res.status(207).json({
      total: results.length,
      succeeded: count("created"),
      skippedExisting: count("skipped_existing"),
      duplicates: count("duplicate"),
      failed: count("failed"),
      results,
    });
  });

  function mailbox(idValue: string) {
    const id = parse(routeId, idValue);
    const row = db.db.prepare(`SELECT m.*,d.name domain FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id=?`).get(id) as any;
    if (!row) throw Object.assign(new Error("邮箱不存在"), { status: 404 });
    return row;
  }

  app.get("/api/mailboxes/:id", (req, res) => res.json(mailbox(req.params.id)));
  app.patch("/api/mailboxes/:id/note", async (req, res) => {
    const row = mailbox(req.params.id);
    const { note } = parse(z.object({ note: z.string().max(500) }), req.body);
    await stalwart.updateMailbox(row.stalwart_account_id, { description: note || row.address });
    db.db.prepare("UPDATE mailboxes SET note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(note, row.id);
    audit(db, req, "mailbox.note", "mailbox", String(row.id));
    res.status(204).end();
  });

  app.patch("/api/mailboxes/:id/external-login", async (req, res) => {
    const row = mailbox(req.params.id);
    const input = parse(z.object({ enabled: z.boolean(), password: mailboxPassword.optional() }).superRefine((value, ctx) => {
      if (value.enabled && !value.password) ctx.addIssue({ code: "custom", message: "开启外部登录时必须设置新密码", path: ["password"] });
    }), req.body);
    await stalwart.setExternalLogin(row.stalwart_account_id, input.enabled, input.password);
    db.db.prepare("UPDATE mailboxes SET external_login=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.enabled ? 1 : 0, row.id);
    audit(db, req, input.enabled ? "mailbox.login.enable" : "mailbox.login.disable", "mailbox", String(row.id));
    res.status(204).end();
  });

  app.post("/api/mailboxes/:id/password", async (req, res) => {
    const row = mailbox(req.params.id);
    const { password } = parse(z.object({ password: mailboxPassword }), req.body);
    await stalwart.updateMailbox(row.stalwart_account_id, { credentials: { "0": { "@type": "Password", secret: password } } });
    audit(db, req, "mailbox.password.reset", "mailbox", String(row.id));
    res.status(204).end();
  });

  async function deleteMailboxRecord(row: any, req: Request) {
    db.db.prepare("UPDATE mailboxes SET status='deleting',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
    try {
      await stalwart.deleteMailbox(row.stalwart_account_id);
      db.db.prepare("DELETE FROM mailboxes WHERE id=?").run(row.id);
      audit(db, req, "mailbox.delete", "mailbox", String(row.id), { address: row.address });
    } catch (error) {
      db.db.prepare("UPDATE mailboxes SET status='error',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
      throw error;
    }
  }

  app.delete("/api/mailboxes/:id", async (req, res) => {
    const row = mailbox(req.params.id);
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
    if (confirm !== row.address) return res.status(400).json({ error: "请输入完整邮箱地址确认删除" });
    await deleteMailboxRecord(row, req);
    res.status(204).end();
  });

  app.post("/api/mailboxes/bulk-delete", async (req, res) => {
    const input = parse(z.object({
      ids: z.array(z.number().int().positive()).min(1, "至少选择一个邮箱").max(bulkMailboxLimit, `每次最多删除 ${bulkMailboxLimit} 个邮箱`),
    }), req.body);
    const ids = [...new Set(input.ids)];
    const results: Array<{ id: number; address?: string; status: "deleted" | "failed"; reason?: string }> = [];
    for (const id of ids) {
      const row = db.db.prepare(`SELECT m.*,d.name domain FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id=?`).get(id) as any;
      if (!row) {
        results.push({ id, status: "failed", reason: "邮箱不存在" });
        continue;
      }
      try {
        await deleteMailboxRecord(row, req);
        results.push({ id, address: row.address, status: "deleted" });
      } catch (error) {
        const reason = error instanceof StalwartError ? error.message : "删除失败";
        results.push({ id, address: row.address, status: "failed", reason });
      }
    }
    const deleted = results.filter((item) => item.status === "deleted").length;
    res.status(207).json({ total: results.length, deleted, failed: results.length - deleted, results });
  });

  app.get("/api/mailboxes/:id/messages", async (req, res) => {
    const row = mailbox(req.params.id);
    const input = parse(z.object({
      q: z.string().max(256).optional(),
      field: z.enum(["text", "from", "subject", "body"]).default("text"),
      position: queryInteger(0, 0, Number.MAX_SAFE_INTEGER),
      limit: queryInteger(50, 1, 100),
      order: z.enum(["asc", "desc"]).default("desc"),
    }), req.query);
    res.json(await stalwart.listMessages(row.stalwart_account_id, { query: input.q, field: input.field, position: input.position, limit: input.limit, ascending: input.order === "asc" }));
  });

  app.get("/api/mailboxes/:id/messages/:emailId", async (req, res) => {
    const row = mailbox(req.params.id);
    const message = await stalwart.getMessage(row.stalwart_account_id, req.params.emailId);
    if (!message) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    res.json(presentMessage(message));
  });

  app.patch("/api/mailboxes/:id/messages/:emailId/read", async (req, res) => {
    const row = mailbox(req.params.id);
    const { read } = parse(z.object({ read: z.boolean() }), req.body);
    if (!await stalwart.getMessage(row.stalwart_account_id, req.params.emailId)) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    await stalwart.setSeen(row.stalwart_account_id, req.params.emailId, read);
    res.status(204).end();
  });

  app.delete("/api/mailboxes/:id/messages/:emailId", async (req, res) => {
    const row = mailbox(req.params.id);
    if (!await stalwart.getMessage(row.stalwart_account_id, req.params.emailId)) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    await stalwart.deleteMessage(row.stalwart_account_id, req.params.emailId);
    audit(db, req, "message.delete", "mailbox", String(row.id), { emailId: req.params.emailId });
    res.status(204).end();
  });

  app.get("/api/mailboxes/:id/messages/:emailId/attachments/:blobId", async (req, res) => {
    const row = mailbox(req.params.id);
    const message = await stalwart.getMessage(row.stalwart_account_id, req.params.emailId);
    const attachment = message?.attachments?.find((item: any) => item.blobId === req.params.blobId);
    if (!attachment) return res.status(404).json({ error: "附件不存在于当前邮件" });
    const name = String(attachment.name ?? "attachment").replace(/[\r\n"\\/]/g, "_").slice(0, 180);
    const upstream = await stalwart.download(row.stalwart_account_id, attachment.blobId, name, attachment.type);
    res.set({
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    if (upstream.body) return void (await import("node:stream")).Readable.fromWeb(upstream.body as any).pipe(res);
    res.end();
  });

  app.get("/api/audit", (_req, res) => res.json(db.db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200").all()));

  const clientDir = path.resolve("dist/client");
  app.use(express.static(clientDir, { index: false, maxAge: config.NODE_ENV === "production" ? "1h" : 0 }));
  app.get("/{*path}", (req, res, next) => req.path.startsWith("/api/") ? next() : res.sendFile(path.join(clientDir, "index.html")));

  app.use((error: any, req: Request, res: Response, _next: NextFunction) => {
    const status = error.status ?? (error instanceof StalwartError ? 502 : 500);
    const requestId = req.get("x-request-id") ?? "none";
    console.error(JSON.stringify({ level: "error", requestId, path: req.path, status, error: error.name, message: status < 500 ? error.message : "internal error" }));
    res.status(status).json({ error: status < 500 ? error.message : error instanceof StalwartError ? "邮件核心操作失败" : "服务器内部错误" });
  });

  return { app, db, stalwart };
}
