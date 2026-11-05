import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import argon2 from "argon2";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";

export const SESSION_COOKIE = "dx_session";
export type SessionRole = "admin" | "mailbox_user";
export type AuthenticatedSession = {
  role: SessionRole;
  mailboxId: number | null;
  address: string | null;
  accountId: string | null;
  emailSend: boolean;
  encryptedCredential: string | null;
};

function digest(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function credentialKey(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "dx-youxiang-session", "stalwart-credential-v1", 32));
}

export function encryptSessionCredential(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptSessionCredential(value: string, secret: string) {
  const packed = Buffer.from(value, "base64url");
  if (packed.length < 29) throw new Error("Invalid session credential");
  const decipher = createDecipheriv("aes-256-gcm", credentialKey(secret), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}

export class AuthService {
  constructor(private db: AppDatabase, private config: Config) {}

  async verifyLogin(username: string, password: string) {
    const usernameOk = safeEqual(username, this.config.ADMIN_USERNAME);
    const passwordOk = await argon2.verify(this.config.ADMIN_PASSWORD_HASH, password).catch(() => false);
    return usernameOk && passwordOk;
  }

  createSession(req: Request, res: Response, identity: { role: SessionRole; mailboxId?: number; credential?: string }) {
    const previous = req.cookies?.[SESSION_COOKIE];
    if (previous) this.db.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(previous, this.config.SESSION_SECRET));
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const encryptedCredential = identity.credential ? encryptSessionCredential(identity.credential, this.config.SESSION_SECRET) : null;
    this.db.db.prepare(`INSERT INTO sessions(token_hash,csrf_token,role,mailbox_id,stalwart_credential_ciphertext,ip,user_agent,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(digest(token, this.config.SESSION_SECRET), csrf, identity.role, identity.mailboxId ?? null,
        encryptedCredential, req.ip ?? "unknown", req.get("user-agent")?.slice(0, 512) ?? "", expires.toISOString());
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires,
    });
    return csrf;
  }

  destroySession(req: Request, res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) this.db.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token, this.config.SESSION_SECRET));
    res.clearCookie(SESSION_COOKIE, { path: "/", sameSite: "strict", secure: this.config.NODE_ENV === "production" });
  }

  authenticate = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: "需要登录" });
    const tokenHash = digest(token, this.config.SESSION_SECRET);
    const session = this.db.db.prepare(`SELECT s.csrf_token,s.role,s.mailbox_id,s.stalwart_credential_ciphertext,
      m.address,m.stalwart_account_id,m.external_login,m.email_send,m.status
      FROM sessions s LEFT JOIN mailboxes m ON m.id=s.mailbox_id
      WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP`).get(tokenHash) as any;
    if (!session) return res.status(401).json({ error: "会话已过期" });
    if (session.role === "mailbox_user" && (!session.mailbox_id || session.external_login !== 1 || session.status !== "active")) {
      this.db.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash);
      return res.status(401).json({ error: "会话已过期" });
    }
    res.locals.csrfToken = session.csrf_token;
    res.locals.auth = {
      role: session.role,
      mailboxId: session.mailbox_id ?? null,
      address: session.address ?? null,
      accountId: session.stalwart_account_id ?? null,
      emailSend: session.email_send === 1,
      encryptedCredential: session.stalwart_credential_ciphertext ?? null,
    } satisfies AuthenticatedSession;
    this.db.db.prepare("UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?").run(tokenHash);
    next();
  };

  requireAdmin = (_req: Request, res: Response, next: NextFunction) => {
    if ((res.locals.auth as AuthenticatedSession | undefined)?.role !== "admin") return res.status(403).json({ error: "没有管理员权限" });
    next();
  };

  credential(res: Response) {
    const value = (res.locals.auth as AuthenticatedSession | undefined)?.encryptedCredential;
    if (!value) throw Object.assign(new Error("邮箱凭据不可用，请重新登录"), { status: 401 });
    return decryptSessionCredential(value, this.config.SESSION_SECRET);
  }

  csrf = (req: Request, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const token = req.get("x-csrf-token") ?? "";
    if (!token || !safeEqual(token, String(res.locals.csrfToken ?? ""))) return res.status(403).json({ error: "CSRF 校验失败" });
    const origin = req.get("origin");
    if (origin && origin !== this.config.PUBLIC_ORIGIN) return res.status(403).json({ error: "请求来源无效" });
    next();
  };
}

export function audit(db: AppDatabase, req: Request, action: string, targetType: string, targetId?: string, details: object = {}) {
  db.db.prepare("INSERT INTO audit_log(action,target_type,target_id,ip,details_json) VALUES(?,?,?,?,?)")
    .run(action, targetType, targetId ?? null, req.ip ?? "unknown", JSON.stringify(details));
}
