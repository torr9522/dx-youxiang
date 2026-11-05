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
import { AuthService, audit, type AuthenticatedSession } from "./security.js";
import { presentMessage, remoteImageUrls, sanitizeOutgoingHtml } from "./mail.js";
import { fetchRemoteImage, MAX_IMAGE_BYTES, openRemoteImage, readLimitedImage } from "./remote-images.js";
import { StalwartClient, StalwartError } from "./stalwart.js";
import { clearTranslationCache, getTranslationSettings, saveTranslationSettings, testTranslationConnection, translateMessage, translationCacheCount, translationStatus } from "./translation.js";
import { OpenAiCompatibleProvider, providerEndpoint, type TranslationProvider } from "./translation-provider.js";

const localPart = z.string().min(1).max(64).regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/, "邮箱前缀格式无效");
const mailboxPassword = z.string().min(6, "密码至少需要 6 个字符").max(256);
const loginIdentifier = z.string().trim().min(1).max(254);
const bulkMailboxLimit = 100;
const routeId = z.string().regex(/^[1-9][0-9]*$/, "ID 必须为正整数").transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const spaRoute = /^\/(?:login|inbox(?:\/[1-9][0-9]*(?:\/[^/]+)?)?|mailboxes|settings(?:\/(?:domains|audit|translation))?|domains|audit)?\/?$/;

type CertificateStatusSource = Pick<X509Certificate, "validTo" | "issuer" | "subject" | "checkHost">;

export function assessTlsCertificate(cert: CertificateStatusSource, mailHost: string, acmeMode: "staging" | "production" = "production", now = Date.now()) {
  const days = Math.floor((Date.parse(cert.validTo) - now) / 86_400_000);
  if (cert.subject === cert.issuer) return { ok: false, detail: "bootstrap self-signed certificate" };
  if (!cert.checkHost(mailHost)) return { ok: false, detail: "certificate hostname mismatch" };
  const stagingCertificate = cert.issuer.includes("(STAGING)");
  if (acmeMode === "staging" && !stagingCertificate) return { ok: false, detail: "certificate is not from Let's Encrypt staging" };
  if (acmeMode === "production" && stagingCertificate) return { ok: false, detail: "staging certificate is not valid for production" };
  const trust = acmeMode === "staging" ? "staging test chain (not publicly trusted)" : "production chain";
  return { ok: days > 7, detail: `${trust}; ${days} days remaining` };
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

export function createApp(config: Config, deps?: { db?: AppDatabase; stalwart?: StalwartClient; translationProvider?: TranslationProvider }) {
  const db = deps?.db ?? new AppDatabase(config.DATABASE_PATH);
  const stalwart = deps?.stalwart ?? new StalwartClient(config);
  const translationProvider = deps?.translationProvider ?? new OpenAiCompatibleProvider(config.NODE_ENV);
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
  app.use(express.json({ limit: "2mb" }));
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
      checks.tls = assessTlsCertificate(cert, config.MAIL_HOST, config.ACME_MODE);
    } catch { checks.tls = { ok: false, detail: "certificate unavailable" }; }
    const ok = Object.values(checks).every((check) => check.ok);
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded", checks });
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false, skipSuccessfulRequests: true });
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const input = parse(z.object({ username: loginIdentifier, password: z.string().max(512) }), req.body);
    const normalized = input.username.toLowerCase();
    let identity: { role: "admin" | "mailbox_user"; mailboxId?: number; credential?: string; username: string } | null = null;
    if (await auth.verifyLogin(input.username, input.password)) {
      identity = { role: "admin", username: config.ADMIN_USERNAME };
    } else if (normalized.includes("@")) {
      const row = db.db.prepare(`SELECT id,address,stalwart_account_id FROM mailboxes
        WHERE address=? AND external_login=1 AND status='active'`).get(normalized) as { id: number; address: string; stalwart_account_id: string } | undefined;
      if (row) {
        const verified = await stalwart.authenticateMailbox(row.address, input.password).catch(() => null);
        if (verified?.accountIds.has(row.stalwart_account_id)) {
          identity = { role: "mailbox_user", mailboxId: row.id, credential: input.password, username: row.address };
        }
      }
    }
    const ok = identity !== null;
    db.db.prepare("INSERT INTO login_attempts(ip,username,success) VALUES(?,?,?)").run(req.ip ?? "unknown", input.username.slice(0, 64), ok ? 1 : 0);
    db.db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now','-30 days')").run();
    if (!identity) {
      audit(db, req, "login.failed", "identity", undefined, { username: input.username.slice(0, 254) });
      return res.status(401).json({ error: "用户名或密码错误" });
    }
    const csrfToken = auth.createSession(req, res, identity);
    audit(db, req, "login.success", identity.role, identity.mailboxId ? String(identity.mailboxId) : undefined);
    res.json({ username: identity.username, role: identity.role, mailboxId: identity.mailboxId ?? null, csrfToken });
  });

  app.use("/api", auth.authenticate);
  app.use("/api", auth.csrf);
  app.get("/api/auth/session", (_req, res) => {
    const identity = res.locals.auth as AuthenticatedSession;
    res.json({
      username: identity.role === "admin" ? config.ADMIN_USERNAME : identity.address,
      role: identity.role,
      mailboxId: identity.mailboxId,
      emailSend: identity.role === "admin" ? true : identity.emailSend,
      csrfToken: res.locals.csrfToken,
    });
  });
  app.post("/api/auth/logout", (req, res) => {
    const identity = res.locals.auth as AuthenticatedSession;
    auth.destroySession(req, res);
    audit(db, req, "logout", identity.role, identity.mailboxId ? String(identity.mailboxId) : undefined);
    res.status(204).end();
  });

  app.use(["/api/settings", "/api/domains", "/api/dashboard", "/api/audit"], auth.requireAdmin);

  const translationSettingsSchema = z.object({
    protocol: z.enum(["responses", "chat_completions"]).nullable(),
    baseUrl: z.string().max(2048),
    apiKey: z.string().min(1).max(4096).optional(),
    clearApiKey: z.boolean().optional(),
    model: z.string().max(256),
    targetLanguage: z.enum(["zh-CN", "zh-TW", "en", "ja", "ko", "es", "fr", "de"]),
    enabled: z.boolean(),
  });
  app.get("/api/settings/translation", (_req, res) => res.json({ ...getTranslationSettings(db), cacheEntries: translationCacheCount(db) }));
  app.put("/api/settings/translation", (req, res) => {
    const input = parse(translationSettingsSchema, req.body);
    if (input.baseUrl) providerEndpoint(input.baseUrl, input.protocol ?? "responses", config.NODE_ENV);
    const result = saveTranslationSettings(db, config.SESSION_SECRET, input);
    audit(db, req, "translation.settings.update", "settings", "translation", { protocol: input.protocol, enabled: result.enabled, hasApiKey: result.hasApiKey });
    res.json({ ...result, cacheEntries: translationCacheCount(db) });
  });
  const translationLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false });
  app.post("/api/settings/translation/test", translationLimiter, async (req, res) => {
    try {
      const result = await testTranslationConnection(db, config.SESSION_SECRET, translationProvider);
      audit(db, req, "translation.connection.test", "settings", "translation", { protocol: result.protocol, success: true });
      res.json({ ...result, cacheEntries: translationCacheCount(db) });
    } catch (error) {
      audit(db, req, "translation.connection.test", "settings", "translation", { success: false });
      res.status(502).json({ error: error instanceof Error ? error.message : "翻译连接测试失败" });
    }
  });
  app.delete("/api/settings/translation/cache", (req, res) => {
    const deleted = clearTranslationCache(db);
    audit(db, req, "translation.cache.clear", "settings", "translation", { deleted });
    res.json({ deleted, cacheEntries: 0 });
  });

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
    const identity = res.locals.auth as AuthenticatedSession;
    const ownership = identity.role === "mailbox_user" ? "AND m.id=?" : "";
    const args = identity.role === "mailbox_user" ? [`%${search}%`, `%${search}%`, identity.mailboxId] : [`%${search}%`, `%${search}%`];
    const rows = db.db.prepare(`SELECT m.*,d.name domain FROM mailboxes m JOIN domains d ON d.id=m.domain_id
      WHERE (m.address LIKE ? OR m.note LIKE ?) ${ownership} ORDER BY m.created_at DESC`).all(...args) as any[];
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

  app.post("/api/mailboxes", auth.requireAdmin, async (req, res) => {
    const input = parse(z.object({ localPart, domainId: z.number().int().positive(), note: z.string().max(500).default("") }), req.body);
    const domain = db.db.prepare("SELECT * FROM domains WHERE id=? AND enabled=1").get(input.domainId) as any;
    if (!domain) return res.status(400).json({ error: "域名未配置或未启用" });
    res.status(201).json(await createMailboxRecord({ localPart: input.localPart, domain, note: input.note }, req));
  });

  app.post("/api/mailboxes/bulk", auth.requireAdmin, async (req, res) => {
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

  function mailbox(idValue: unknown, res: Response) {
    const id = parse(routeId, idValue);
    const identity = res.locals.auth as AuthenticatedSession;
    if (identity.role === "mailbox_user" && identity.mailboxId !== id) throw Object.assign(new Error("邮箱不存在"), { status: 404 });
    const row = db.db.prepare(`SELECT m.*,d.name domain FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id=?`).get(id) as any;
    if (!row) throw Object.assign(new Error("邮箱不存在"), { status: 404 });
    return row;
  }

  app.get("/api/mailboxes/:id", (req, res) => res.json(mailbox(req.params.id, res)));
  app.patch("/api/mailboxes/:id/note", auth.requireAdmin, async (req, res) => {
    const row = mailbox(req.params.id, res);
    const { note } = parse(z.object({ note: z.string().max(500) }), req.body);
    await stalwart.updateMailbox(row.stalwart_account_id, { description: note || row.address });
    db.db.prepare("UPDATE mailboxes SET note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(note, row.id);
    audit(db, req, "mailbox.note", "mailbox", String(row.id));
    res.status(204).end();
  });

  app.patch("/api/mailboxes/:id/external-login", auth.requireAdmin, async (req, res) => {
    const row = mailbox(req.params.id, res);
    const input = parse(z.object({ enabled: z.boolean(), password: mailboxPassword.optional() }).superRefine((value, ctx) => {
      if (value.enabled && !value.password) ctx.addIssue({ code: "custom", message: "开启外部登录时必须设置新密码", path: ["password"] });
    }), req.body);
    await stalwart.setMailboxPermissions(row.stalwart_account_id, input.enabled, row.email_send === 1, input.password);
    db.db.prepare("UPDATE mailboxes SET external_login=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.enabled ? 1 : 0, row.id);
    audit(db, req, input.enabled ? "mailbox.login.enable" : "mailbox.login.disable", "mailbox", String(row.id));
    res.status(204).end();
  });

  app.patch("/api/mailboxes/:id/send-permission", auth.requireAdmin, async (req, res) => {
    const row = mailbox(req.params.id, res);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    await stalwart.setMailboxPermissions(row.stalwart_account_id, row.external_login === 1, enabled);
    db.db.prepare("UPDATE mailboxes SET email_send=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(enabled ? 1 : 0, row.id);
    audit(db, req, enabled ? "mailbox.send.enable" : "mailbox.send.disable", "mailbox", String(row.id));
    res.status(204).end();
  });

  app.get("/api/mailboxes/:id/client-config", (req, res) => {
    const row = mailbox(req.params.id, res);
    res.json({
      username: row.address,
      externalLogin: row.external_login === 1,
      emailSend: row.email_send === 1,
      imap: { host: config.MAIL_HOST, port: 993, security: "SSL/TLS" },
      smtp: { host: config.MAIL_HOST, port: 587, security: "STARTTLS", alternative: { port: 465, security: "SSL/TLS" } },
    });
  });

  app.post("/api/mailboxes/:id/password", auth.requireAdmin, async (req, res) => {
    const row = mailbox(req.params.id, res);
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

  app.delete("/api/mailboxes/:id", auth.requireAdmin, async (req, res) => {
    const row = mailbox(req.params.id, res);
    await deleteMailboxRecord(row, req);
    res.status(204).end();
  });

  app.post("/api/mailboxes/bulk-delete", auth.requireAdmin, async (req, res) => {
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
    const row = mailbox(req.params.id, res);
    const input = parse(z.object({
      q: z.string().max(256).optional(),
      field: z.enum(["text", "from", "subject", "body"]).default("text"),
      read: z.enum(["all", "unread", "read"]).default("all"),
      position: queryInteger(0, 0, Number.MAX_SAFE_INTEGER),
      limit: queryInteger(50, 1, 100),
      order: z.enum(["asc", "desc"]).default("desc"),
      folder: z.enum(["inbox", "sent", "drafts"]).default("inbox"),
    }), req.query);
    res.json(await stalwart.listMessages(row.stalwart_account_id, { folder: input.folder, query: input.q, field: input.field, read: input.read, position: input.position, limit: input.limit, ascending: input.order === "asc" }));
  });

  const sendLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false });
  const recipient = z.string().trim().toLowerCase().email().max(254);
  const attachment = z.object({
    blobId: z.string().min(1).max(512),
    type: z.string().min(1).max(255).regex(/^[\w.+-]+\/[\w.+-]+$/),
    name: z.string().min(1).max(180).transform((value) => value.replace(/[\r\n"\\/]/g, "_")),
    size: z.number().int().nonnegative().max(20 * 1024 * 1024),
  });
  const composeSchema = z.object({
    to: z.array(recipient).max(50).default([]),
    cc: z.array(recipient).max(50).default([]),
    bcc: z.array(recipient).max(50).default([]),
    subject: z.string().max(998).default(""),
    text: z.string().max(1_000_000).default(""),
    html: z.string().max(1_000_000).optional(),
    attachments: z.array(attachment).max(20).default([]),
    replyToEmailId: z.string().min(1).max(512).optional(),
  }).superRefine((value, ctx) => {
    if (value.to.length + value.cc.length + value.bcc.length > 50) ctx.addIssue({ code: "custom", message: "每封邮件最多 50 个收件人" });
  });

  function sendingIdentity(res: Response) {
    const identity = res.locals.auth as AuthenticatedSession;
    if (identity.role !== "mailbox_user" || !identity.mailboxId || !identity.address || !identity.accountId) {
      throw Object.assign(new Error("仅邮箱用户可以提交邮件"), { status: 403 });
    }
    if (!identity.emailSend) throw Object.assign(new Error("当前邮箱未启用发信权限"), { status: 403 });
    return identity;
  }

  app.post("/api/mailboxes/:id/uploads", sendLimiter, express.raw({ type: "application/octet-stream", limit: "20mb" }), async (req, res) => {
    const row = mailbox(req.params.id, res);
    const identity = sendingIdentity(res);
    if (row.id !== identity.mailboxId) return res.status(404).json({ error: "邮箱不存在" });
    const type = parse(z.string().min(1).max(255).regex(/^[\w.+-]+\/[\w.+-]+$/), req.query.type ?? "application/octet-stream");
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) return res.status(400).json({ error: "附件为空" });
    const uploaded = await stalwart.uploadAs(identity.address!, auth.credential(res), identity.accountId!, body, type);
    res.status(201).json(uploaded);
  });

  app.post("/api/mailboxes/:id/drafts", sendLimiter, async (req, res) => {
    const row = mailbox(req.params.id, res);
    const identity = sendingIdentity(res);
    if (row.id !== identity.mailboxId) return res.status(404).json({ error: "邮箱不存在" });
    const input = parse(composeSchema, req.body);
    const result = await stalwart.saveDraftOrSubmit({ ...input, html: input.html ? sanitizeOutgoingHtml(input.html) : undefined,
      address: identity.address!, password: auth.credential(res), accountId: identity.accountId!, submit: false });
    audit(db, req, "message.draft.create", "mailbox", String(row.id), { emailId: result.emailId, attachments: input.attachments.length });
    res.status(201).json(result);
  });

  app.post("/api/mailboxes/:id/submissions", sendLimiter, async (req, res) => {
    const row = mailbox(req.params.id, res);
    const identity = sendingIdentity(res);
    if (row.id !== identity.mailboxId) return res.status(404).json({ error: "邮箱不存在" });
    const input = parse(composeSchema, req.body);
    if (!input.to.length && !input.cc.length && !input.bcc.length) return res.status(400).json({ error: "至少需要一个收件人" });
    let inReplyTo: string | undefined;
    let references: string[] | undefined;
    if (input.replyToEmailId) {
      const original = await stalwart.getMessage(row.stalwart_account_id, input.replyToEmailId);
      if (!original) return res.status(404).json({ error: "回复的原邮件不存在" });
      inReplyTo = Array.isArray(original.messageId) ? original.messageId[0] : undefined;
      references = [...new Set([...(Array.isArray(original.references) ? original.references : []), ...(inReplyTo ? [inReplyTo] : [])])].slice(-50);
    }
    const result = await stalwart.saveDraftOrSubmit({ ...input, html: input.html ? sanitizeOutgoingHtml(input.html) : undefined,
      address: identity.address!, password: auth.credential(res), accountId: identity.accountId!, submit: true, inReplyTo, references });
    audit(db, req, "message.submit", "mailbox", String(row.id), { emailId: result.emailId, submissionId: result.submissionId, recipients: input.to.length + input.cc.length + input.bcc.length });
    res.status(202).json(result);
  });

  app.get("/api/mailboxes/:id/messages/:emailId", async (req, res) => {
    const row = mailbox(req.params.id, res);
    const message = await stalwart.getMessage(row.stalwart_account_id, req.params.emailId);
    if (!message) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    const presented = presentMessage(message, { mailboxId: row.id, emailId: req.params.emailId, sessionSecret: config.SESSION_SECRET });
    res.json({ ...presented, translation: translationStatus(db, presented.html, presented.plain) });
  });

  app.post("/api/mailboxes/:id/messages/:emailId/translate", translationLimiter, async (req, res) => {
    const emailId = String(req.params.emailId);
    const row = mailbox(req.params.id, res);
    const message = await stalwart.getMessage(row.stalwart_account_id, emailId);
    if (!message) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    const presented = presentMessage(message, { mailboxId: row.id, emailId, sessionSecret: config.SESSION_SECRET });
    try {
      const result = await translateMessage({
        db,
        secret: config.SESSION_SECRET,
        provider: translationProvider,
        mailboxId: row.id,
        accountId: row.stalwart_account_id,
        emailId,
        bodyHash: presented.bodyHash,
        html: presented.html,
        plain: presented.plain,
      });
      res.set("Server-Timing", [
        `translate;dur=${result.metrics.totalMs}`,
        `extract;dur=${result.metrics.textExtractionMs}`,
        `provider;dur=${result.metrics.providerWallMs}`,
        `mapping;dur=${result.metrics.domMappingMs}`,
        `cache;dur=${result.metrics.cacheWriteMs}`,
      ].join(", "));
      audit(db, req, "message.translate", "mailbox", String(row.id), { emailId, cached: result.cached, partial: result.partial });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "邮件翻译失败" });
    }
  });

  app.patch("/api/mailboxes/:id/messages/:emailId/read", async (req, res) => {
    const row = mailbox(req.params.id, res);
    const { read } = parse(z.object({ read: z.boolean() }), req.body);
    if (!await stalwart.getMessage(row.stalwart_account_id, req.params.emailId)) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    await stalwart.setSeen(row.stalwart_account_id, req.params.emailId, read);
    res.status(204).end();
  });

  app.delete("/api/mailboxes/:id/messages/:emailId", async (req, res) => {
    const row = mailbox(req.params.id, res);
    if (!await stalwart.getMessage(row.stalwart_account_id, req.params.emailId)) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    await stalwart.deleteMessage(row.stalwart_account_id, req.params.emailId);
    db.db.prepare("DELETE FROM translation_cache WHERE mailbox_id=? AND email_id=?").run(row.id, req.params.emailId);
    audit(db, req, "message.delete", "mailbox", String(row.id), { emailId: req.params.emailId });
    res.status(204).end();
  });

  app.get("/api/mailboxes/:id/messages/:emailId/attachments/:blobId", async (req, res) => {
    const row = mailbox(req.params.id, res);
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

  app.get("/api/mailboxes/:id/messages/:emailId/inline-images/:blobId", async (req, res) => {
    const row = mailbox(req.params.id, res);
    const message = await stalwart.getMessage(row.stalwart_account_id, req.params.emailId);
    const attachment = message?.attachments?.find((item: any) => item.blobId === req.params.blobId && item.cid);
    if (!attachment) return res.status(404).json({ error: "内嵌图片不存在于当前邮件" });
    if (typeof attachment.size === "number" && attachment.size > MAX_IMAGE_BYTES) return res.status(413).json({ error: "图片超过大小限制" });
    const declaredType = String(attachment.type ?? "").toLowerCase();
    if (!new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]).has(declaredType)) return res.status(415).json({ error: "不支持的内嵌图片格式" });
    const upstream = await stalwart.download(row.stalwart_account_id, attachment.blobId, "inline-image", declaredType);
    const { body, type } = await readLimitedImage(upstream, declaredType);
    res.set({
      "content-type": type,
      "content-length": String(body.length),
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    });
    res.end(body);
  });

  app.get("/api/mailboxes/:id/messages/:emailId/remote-images/:token", async (req, res) => {
    const row = mailbox(req.params.id, res);
    const message = await stalwart.getMessage(row.stalwart_account_id, req.params.emailId);
    if (!message) return res.status(404).json({ error: "邮件不存在于当前邮箱" });
    let imageUrl: string;
    try {
      imageUrl = openRemoteImage(req.params.token, row.id, req.params.emailId, config.SESSION_SECRET);
    } catch {
      return res.status(400).json({ error: "无效图片令牌" });
    }
    if (!remoteImageUrls(message).has(imageUrl)) return res.status(404).json({ error: "远程图片不存在于当前邮件" });
    try {
      const { body, type } = await fetchRemoteImage(imageUrl);
      res.set({
        "content-type": type,
        "content-length": String(body.length),
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      });
      res.end(body);
    } catch {
      res.status(502).json({ error: "远程图片无法安全加载" });
    }
  });

  app.get("/api/audit", (_req, res) => res.json(db.db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200").all()));

  app.use("/api", (_req, res) => res.status(404).json({ error: "API 路径不存在" }));

  const clientDir = path.resolve("dist/client");
  app.use(express.static(clientDir, { index: false, maxAge: config.NODE_ENV === "production" ? "1h" : 0 }));
  app.get(spaRoute, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));

  app.use((error: any, req: Request, res: Response, _next: NextFunction) => {
    const status = error.status ?? (error instanceof StalwartError ? 502 : 500);
    const requestId = req.get("x-request-id") ?? "none";
    console.error(JSON.stringify({ level: "error", requestId, path: req.path, status, error: error.name, message: status < 500 ? error.message : "internal error" }));
    res.status(status).json({ error: status < 500 ? error.message : error instanceof StalwartError ? "邮件核心操作失败" : "服务器内部错误" });
  });

  return { app, db, stalwart };
}
