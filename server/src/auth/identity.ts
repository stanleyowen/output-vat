/**
 * Users are identified by their Cloudflare Access email (verified JWT) — there are
 * no app passwords or sessions. A user row is created on first use so uploads,
 * conversions and the audit log can reference it.
 */
import type { DB } from "../db.js";

export interface AppUser {
  id: number;
  email: string;
}

export function ensureUser(db: DB, email: string): AppUser {
  const e = email.trim().toLowerCase();
  const row = db.prepare("SELECT id, email FROM users WHERE email = ?").get(e) as AppUser | undefined;
  if (row) return row;
  const now = Date.now();
  // username/password_hash are legacy columns; '!' can never match any password.
  db.prepare(
    "INSERT INTO users(username, password_hash, created_at, password_changed_at, email) VALUES(?, '!', ?, ?, ?)",
  ).run(e, now, now, e);
  return db.prepare("SELECT id, email FROM users WHERE email = ?").get(e) as unknown as AppUser;
}
