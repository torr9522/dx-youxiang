import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import argon2 from "argon2";
import type { AppDatabase } from "./db.js";
import type { Config } from "./config.js";

export const SESSION_COOKIE = "dx_session";

function digest(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AuthService {
  constructor(private db: AppDatabase, private config: Config) {}

  async verifyLogin(username: string, password: string) {
    const usernameOk = safeEqual(username, this.config.ADMIN_USERNAME);
    const passwordOk = await argon2.verify(this.config.ADMIN_PASSWORD_HASH, password).catch(() => false);
    return usernameOk && passwordOk;
  }

  createSession(req: Request, res: Response) {
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
    this.db.db.prepare(`INSERT INTO sessions(token_hash,csrf_token,ip,user_agent,expires_at)
      VALUES(?,?,?,?,?)`).run(digest(token, this.config.SESSION_SECRET), csrf, req.ip ?? "unknown", req.get("user-agent")?.slice(0, 512) ?? "", expires.toISOString());
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
    if (!token) return res.status(401).json({ error: "需要管理员登录" });
    const session = this.db.db.prepare(`SELECT csrf_token,expires_at FROM sessions
      WHERE token_hash=? AND expires_at > CURRENT_TIMESTAMP`).get(digest(token, this.config.SESSION_SECRET)) as { csrf_token: string; expires_at: string } | undefined;
    if (!session) return res.status(401).json({ error: "会话已过期" });
    res.locals.csrfToken = session.csrf_token;
    this.db.db.prepare("UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE token_hash=?").run(digest(token, this.config.SESSION_SECRET));
    next();
  };

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
