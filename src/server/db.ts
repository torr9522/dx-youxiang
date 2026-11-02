import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type MailboxRow = {
  id: number;
  stalwart_account_id: string;
  address: string;
  local_part: string;
  domain_id: number;
  note: string;
  external_login: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domains (
        id INTEGER PRIMARY KEY,
        stalwart_domain_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        dns_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_default_domain ON domains(is_default) WHERE is_default=1;
      CREATE TABLE IF NOT EXISTS mailboxes (
        id INTEGER PRIMARY KEY,
        stalwart_account_id TEXT NOT NULL UNIQUE,
        address TEXT NOT NULL UNIQUE COLLATE NOCASE,
        local_part TEXT NOT NULL,
        domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
        note TEXT NOT NULL DEFAULT '',
        external_login INTEGER NOT NULL DEFAULT 0 CHECK(external_login IN (0,1)),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleting','error')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS mailboxes_domain ON mailboxes(domain_id);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY,
        ip TEXT NOT NULL,
        username TEXT NOT NULL,
        success INTEGER NOT NULL CHECK(success IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS login_attempts_lookup ON login_attempts(ip, created_at);
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        ip TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created_at DESC);
    `);
  }

  health(): boolean {
    const row = this.db.prepare("PRAGMA quick_check").get() as Record<string, string>;
    return Object.values(row)[0] === "ok";
  }

  close() { this.db.close(); }
}
