import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { audit } from "../db.js";
import { QueueFullError } from "../worker/pool.js";
import { HttpError, idParams, readXlsxUpload, sendDownload } from "./util.js";

interface TemplateRow {
  id: string;
  name: string;
  file_name: string;
  size: number;
  sha256: string;
  formulas: number;
  functions: string;
  is_default: number;
  created_at: number;
}

const toApi = (r: TemplateRow) => ({
  id: r.id,
  name: r.name,
  fileName: r.file_name,
  size: r.size,
  formulas: r.formulas,
  functions: JSON.parse(r.functions) as string[],
  isDefault: r.is_default === 1,
  createdAt: r.created_at,
});

/** Small in-memory cache of decrypted templates (they're ~3 MB and reused every conversion). */
const cache = new Map<string, Buffer>();
export async function loadTemplate(app: FastifyInstance, id: string): Promise<Buffer> {
  const hit = cache.get(id);
  if (hit) return hit;
  const buf = await app.store.get("templates", id, "xlsx");
  cache.set(id, buf);
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return buf;
}

export function findTemplate(app: FastifyInstance, id?: string): TemplateRow | undefined {
  return (
    id
      ? app.db.prepare("SELECT * FROM templates WHERE id = ?").get(id)
      : app.db.prepare("SELECT * FROM templates WHERE is_default = 1").get()
  ) as TemplateRow | undefined;
}

export async function templateRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/api/templates", async () => {
    const rows = db.prepare("SELECT * FROM templates ORDER BY is_default DESC, created_at DESC").all() as unknown as TemplateRow[];
    return { templates: rows.map(toApi) };
  });

  app.post("/api/templates", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const up = await readXlsxUpload(req, app.cfg.limits.templateMb);
    const name = (up.fields.name ?? "").trim().slice(0, 80) || up.fileName.replace(/\.xlsx$/i, "");
    let result;
    try {
      result = await app.pool.run({ kind: "inspectTemplate", template: up.data });
    } catch (e) {
      if (e instanceof QueueFullError) throw new HttpError(503, "The server is busy. Please try again in a moment.");
      if (e instanceof Error && /timed out/.test(e.message)) throw new HttpError(504, "Checking the template took too long.");
      throw e;
    }
    if (!result.ok) {
      if (result.code === "INTERNAL") {
        req.log.error({ msg: result.message }, "template inspection failed");
        throw new HttpError(422, "This template can't be used: it could not be read.");
      }
      throw new HttpError(422, `This template can't be used: ${result.message}`);
    }
    if (result.kind !== "inspectTemplate") throw new Error("unexpected worker result");
    const id = randomUUID();
    await app.store.put("templates", id, "xlsx", up.data);
    const isFirst = (db.prepare("SELECT COUNT(*) AS n FROM templates").get() as { n: number }).n === 0;
    db.prepare(
      `INSERT INTO templates(id, name, file_name, size, sha256, formulas, functions, is_default, uploaded_by, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      name,
      up.fileName,
      up.data.length,
      createHash("sha256").update(up.data).digest("hex"),
      result.formulas,
      JSON.stringify(result.functions),
      isFirst ? 1 : 0,
      req.user!.id,
      Date.now(),
    );
    audit(db, { userId: req.user!.id, action: "template.uploaded", detail: { id, name }, ip: req.clientIp, actor: req.access.email });
    return reply.code(201).send({ template: toApi(findTemplate(app, id)!) });
  });

  app.patch(
    "/api/templates/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            isDefault: { type: "boolean", const: true },
          },
        },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as { name?: string; isDefault?: true };
      if (!findTemplate(app, id)) throw new HttpError(404, "Template not found.");
      db.exec("BEGIN");
      try {
        if (body.name) db.prepare("UPDATE templates SET name = ? WHERE id = ?").run(body.name.trim(), id);
        if (body.isDefault) {
          db.prepare("UPDATE templates SET is_default = 0 WHERE is_default = 1").run();
          db.prepare("UPDATE templates SET is_default = 1 WHERE id = ?").run(id);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      audit(db, { userId: req.user!.id, action: "template.updated", detail: { id, ...body }, ip: req.clientIp, actor: req.access.email });
      return { template: toApi(findTemplate(app, id)!) };
    },
  );

  app.delete("/api/templates/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const t = findTemplate(app, id);
    if (!t) throw new HttpError(404, "Template not found.");
    db.prepare("DELETE FROM templates WHERE id = ?").run(id);
    if (t.is_default) {
      // Promote the newest remaining template so there is always a default.
      db.prepare("UPDATE templates SET is_default = 1 WHERE id = (SELECT id FROM templates ORDER BY created_at DESC LIMIT 1)").run();
    }
    cache.delete(id);
    await app.store.remove("templates", id, ["xlsx"]);
    audit(db, { userId: req.user!.id, action: "template.deleted", detail: { id, name: t.name }, ip: req.clientIp, actor: req.access.email });
    return { ok: true };
  });

  app.get("/api/templates/:id/download", { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = findTemplate(app, id);
    if (!t) throw new HttpError(404, "Template not found.");
    return sendDownload(
      reply,
      t.file_name,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      await loadTemplate(app, id),
    );
  });
}
