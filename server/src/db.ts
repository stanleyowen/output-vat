import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until  INTEGER,
    created_at    INTEGER NOT NULL,
    password_changed_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    access_email TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    formulas    INTEGER NOT NULL,
    functions   TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    uploaded_by INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE conversions (
    id            TEXT PRIMARY KEY,
    input_name    TEXT NOT NULL,
    output_name   TEXT NOT NULL,
    template_id   TEXT,
    template_name TEXT NOT NULL,
    use_reference_number INTEGER NOT NULL,
    rows_copied   INTEGER NOT NULL,
    invoices      INTEGER NOT NULL,
    line_items    INTEGER NOT NULL,
    total_dpp     REAL NOT NULL,
    total_ppn     REAL NOT NULL,
    csv_rows      INTEGER NOT NULL,
    duration_ms   INTEGER NOT NULL,
    created_by    INTEGER REFERENCES users(id),
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX conversions_created ON conversions(created_at DESC);
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    at         INTEGER NOT NULL,
    user_id    INTEGER,
    actor      TEXT,
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT
  );
  CREATE INDEX audit_at ON audit_log(at DESC);
  `,
  // v2: sign-in moved entirely to Cloudflare Access — users are keyed by email,
  // app passwords and sessions are gone.
  `
  DROP TABLE sessions;
  ALTER TABLE users ADD COLUMN email TEXT;
  UPDATE templates SET uploaded_by = NULL WHERE uploaded_by IN (SELECT id FROM users WHERE email IS NULL);
  UPDATE conversions SET created_by = NULL WHERE created_by IN (SELECT id FROM users WHERE email IS NULL);
  DELETE FROM users WHERE email IS NULL;
  CREATE UNIQUE INDEX users_email ON users(email);
  `,
];

export function openDb(dataDir: string): DB {
  // Database, WAL and stored files are private to the service user.
  process.umask(0o077);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "app.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as T) : fallback;
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}

export function audit(
  db: DB,
  entry: { userId?: number | null; actor?: string | null; action: string; detail?: unknown; ip?: string | null },
): void {
  db.prepare("INSERT INTO audit_log(at, user_id, actor, action, detail, ip) VALUES(?, ?, ?, ?, ?, ?)").run(
    Date.now(),
    entry.userId ?? null,
    entry.actor ?? null,
    entry.action,
    entry.detail === undefined ? null : JSON.stringify(entry.detail),
    entry.ip ?? null,
  );
}
