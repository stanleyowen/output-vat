import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { csvNameFor } from "../engine/convert.js";
import { audit } from "../db.js";
import { QueueFullError } from "../worker/pool.js";
import { readSettings } from "./settings.js";
import { findTemplate, loadTemplate } from "./templates.js";
import { HttpError, idParams, readXlsxUpload, sendDownload, UUID_RE } from "./util.js";

interface ConversionRow {
  id: string;
  input_name: string;
  output_name: string;
  template_id: string | null;
  template_name: string;
  use_reference_number: number;
  rows_copied: number;
  invoices: number;
  line_items: number;
  total_dpp: number;
  total_ppn: number;
  csv_rows: number;
  duration_ms: number;
  created_at: number;
}

const toApi = (r: ConversionRow) => ({
  id: r.id,
  inputName: r.input_name,
  outputName: r.output_name,
  templateId: r.template_id,
  templateName: r.template_name,
  useReferenceNumber: r.use_reference_number === 1,
  rowsCopied: r.rows_copied,
  invoices: r.invoices,
  lineItems: r.line_items,
  totalDpp: r.total_dpp,
  totalPpn: r.total_ppn,
  csvRows: r.csv_rows,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
});

/** Summarise the e-Faktur CSV: FK = invoice header rows, OF = line items. */
export function summarizeCsv(csv: string) {
  let invoices = 0;
  let lineItems = 0;
  let dpp = 0;
  let ppn = 0;
  const lines = csv.split("\n");
  for (let i = 3; i < lines.length; i++) {
    const cols = lines[i].split(";");
    if (cols[0] === "FK") {
      invoices++;
      dpp += Number(cols[10]) || 0;
      ppn += Number(cols[11]) || 0;
    } else if (cols[0] === "OF") lineItems++;
  }
  return { invoices, lineItems, dpp, ppn };
}

// The CSV is small (~40 KB/month); send it whole so the UI can list every invoice.
const PREVIEW_MAX = 2_000_000;
const PART_INPUT = "input";
const PART_XLSX = "xlsx";
const PART_CSV = "csv";

export async function conversionRoutes(app: FastifyInstance) {
  const { db } = app;
  const get = (id: string) => db.prepare("SELECT * FROM conversions WHERE id = ?").get(id) as ConversionRow | undefined;

  app.get(
    "/api/conversions",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            before: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req) => {
      const { limit, before } = req.query as { limit: number; before?: number };
      const rows = db
        .prepare("SELECT * FROM conversions WHERE created_at < ? ORDER BY created_at DESC LIMIT ?")
        .all(before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as ConversionRow[];
      return { conversions: rows.map(toApi) };
    },
  );

  app.post("/api/conversions", { config: { rateLimit: { max: 30, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const up = await readXlsxUpload(req, app.cfg.limits.inputMb);
    const templateId = up.fields.templateId;
    if (templateId !== undefined && !new RegExp(UUID_RE).test(templateId)) throw new HttpError(400, "Bad template id.");
    const template = findTemplate(app, templateId);
    if (!template) {
      throw new HttpError(templateId ? 404 : 409, templateId ? "Template not found." : "Upload a template in Templates first.");
    }
    const useReferenceNumber =
      up.fields.useReferenceNumber !== undefined
        ? up.fields.useReferenceNumber === "true"
        : readSettings(app).useReferenceNumber;

    let result;
    try {
      result = await app.pool.run({
        kind: "convert",
        input: up.data,
        template: await loadTemplate(app, template.id),
        useReferenceNumber,
      });
    } catch (e) {
      if (e instanceof QueueFullError) throw new HttpError(503, "The server is busy. Please try again in a moment.");
      if (e instanceof Error && /timed out/.test(e.message)) throw new HttpError(504, "The conversion took too long.");
      throw e;
    }
    if (!result.ok) {
      const status = result.code === "INTERNAL" ? 500 : 422;
      if (status === 500) req.log.error({ msg: result.message }, "conversion failed");
      throw new HttpError(status, status === 500 ? "Conversion failed." : result.message);
    }
    if (result.kind !== "convert") throw new Error("unexpected worker result");

    const id = randomUUID();
    const xlsx = Buffer.from(result.xlsx.buffer, result.xlsx.byteOffset, result.xlsx.byteLength);
    await Promise.all([
      app.store.put("conversions", id, PART_INPUT, up.data),
      app.store.put("conversions", id, PART_XLSX, xlsx),
      app.store.put("conversions", id, PART_CSV, Buffer.from(result.csv, "utf8")),
    ]);
    const s = summarizeCsv(result.csv);
    const stats = result.stats as { rowsCopied: number; csvRows: number; ms: number };
    db.prepare(
      `INSERT INTO conversions(id, input_name, output_name, template_id, template_name, use_reference_number,
         rows_copied, invoices, line_items, total_dpp, total_ppn, csv_rows, duration_ms, created_by, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      up.fileName,
      csvNameFor(up.fileName),
      template.id,
      template.name,
      useReferenceNumber ? 1 : 0,
      stats.rowsCopied,
      s.invoices,
      s.lineItems,
      s.dpp,
      s.ppn,
      stats.csvRows,
      stats.ms,
      req.user!.id,
      Date.now(),
    );
    audit(db, {
      userId: req.user!.id,
      action: "conversion.created",
      detail: { id, input: up.fileName, template: template.name },
      ip: req.clientIp,
      actor: req.access.email,
    });
    return reply.code(201).send({ conversion: toApi(get(id)!), preview: result.csv.slice(0, PREVIEW_MAX) });
  });

  app.get("/api/conversions/:id", { schema: { params: idParams } }, async (req) => {
    const r = get((req.params as { id: string }).id);
    if (!r) throw new HttpError(404, "Not found.");
    const csv = (await app.store.get("conversions", r.id, PART_CSV)).toString("utf8");
    return { conversion: toApi(r), preview: csv.slice(0, PREVIEW_MAX) };
  });

  app.get(
    "/api/conversions/:id/:part",
    {
      schema: {
        params: {
          type: "object",
          required: ["id", "part"],
          properties: { id: idParams.properties.id, part: { type: "string", enum: ["csv", "xlsx", "input"] } },
        },
      },
    },
    async (req, reply) => {
      const { id, part } = req.params as { id: string; part: "csv" | "xlsx" | "input" };
      const r = get(id);
      if (!r) throw new HttpError(404, "Not found.");
      const data = await app.store.get("conversions", id, part === "csv" ? PART_CSV : part === "xlsx" ? PART_XLSX : PART_INPUT);
      audit(db, { userId: req.user!.id, action: `conversion.download.${part}`, detail: { id }, ip: req.clientIp, actor: req.access.email });
      if (part === "csv") return sendDownload(reply, r.output_name, "text/csv; charset=utf-8", data);
      const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return sendDownload(reply, part === "xlsx" ? r.output_name.replace(/\.csv$/, ".xlsx") : r.input_name, xlsxType, data);
    },
  );

  app.delete("/api/conversions/:id", { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const r = get(id);
    if (!r) throw new HttpError(404, "Not found.");
    db.prepare("DELETE FROM conversions WHERE id = ?").run(id);
    await app.store.remove("conversions", id, [PART_INPUT, PART_XLSX, PART_CSV]);
    audit(db, { userId: req.user!.id, action: "conversion.deleted", detail: { id, input: r.input_name }, ip: req.clientIp, actor: req.access.email });
    return { ok: true };
  });
}
