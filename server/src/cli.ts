/**
 * Admin CLI (run inside the container):
 *   node dist/cli.js list-users                                   # users seen so far (by Cloudflare email)
 *   node dist/cli.js import-template <file.xlsx> [name] [--default]
 *
 * Who may sign in is controlled by the Cloudflare Access policy plus ALLOWED_EMAILS in .env.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { audit, openDb } from "./db.js";
import { EncryptedStore } from "./storage.js";
import { WorkerPool } from "./worker/pool.js";

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case "list-users": {
      const rows = db.prepare("SELECT email, created_at FROM users ORDER BY created_at").all() as Array<{ email: string; created_at: number }>;
      for (const u of rows) {
        const allowed = cfg.access.mode === "off" || cfg.access.allowedEmails.includes(u.email);
        console.log(`${u.email}\tfirst seen ${new Date(u.created_at).toISOString()}${allowed ? "" : "\t(not in ALLOWED_EMAILS)"}`);
      }
      console.log(`ALLOWED_EMAILS: ${cfg.access.allowedEmails.join(", ") || "(access off)"}`);
      break;
    }
    case "import-template": {
      const file = args[0];
      if (!file) throw new Error("Usage: import-template <file.xlsx> [name] [--default]");
      const data = readFileSync(file);
      const name = args[1] && args[1] !== "--default" ? args[1] : path.basename(file).replace(/\.xlsx$/i, "");
      const pool = new WorkerPool(1, 120_000);
      const r = await pool.run({ kind: "inspectTemplate", template: data });
      await pool.close();
      if (!r.ok || r.kind !== "inspectTemplate") throw new Error(`Template rejected: ${r.ok ? "?" : r.message}`);
      const id = randomUUID();
      await new EncryptedStore(cfg.dataDir, cfg.encryptionKey).put("templates", id, "xlsx", data);
      const makeDefault = args.includes("--default") || (db.prepare("SELECT COUNT(*) AS n FROM templates").get() as { n: number }).n === 0;
      if (makeDefault) db.prepare("UPDATE templates SET is_default = 0").run();
      db.prepare(
        `INSERT INTO templates(id, name, file_name, size, sha256, formulas, functions, is_default, uploaded_by, created_at)
         VALUES(?,?,?,?,?,?,?,?,NULL,?)`,
      ).run(id, name, path.basename(file), data.length, createHash("sha256").update(data).digest("hex"), r.formulas, JSON.stringify(r.functions), makeDefault ? 1 : 0, Date.now());
      audit(db, { action: "template.imported", actor: "cli", detail: { id, name } });
      console.log(`Imported template "${name}" (${r.formulas} formulas; ${r.functions.join(", ")})${makeDefault ? " [default]" : ""}`);
      break;
    }
    default:
      console.log("Commands: list-users | import-template <file> [name] [--default]");
      process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
