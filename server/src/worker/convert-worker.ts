import { parentPort } from "node:worker_threads";
import { convert, loadWorkbook } from "../engine/convert.js";
import { evaluateAll } from "../engine/recalc.js";
import { UnsupportedFormulaError } from "../engine/formula/values.js";
import { InputDataError, TemplateShapeError } from "../engine/fill.js";
import { assertSafeZip, UnsafeZipError } from "../engine/zipguard.js";
import { UnsafeCsvValueError } from "../engine/csv.js";

export type Job =
  | { kind: "convert"; input: Uint8Array; template: Uint8Array; useReferenceNumber: boolean }
  | { kind: "inspectTemplate"; template: Uint8Array };

export type JobResult =
  | { ok: true; kind: "convert"; xlsx: Uint8Array; csv: string; stats: Record<string, unknown> }
  | { ok: true; kind: "inspectTemplate"; formulas: number; functions: string[]; sheets: string[] }
  | { ok: false; code: "UNSUPPORTED" | "BAD_TEMPLATE" | "BAD_INPUT" | "INTERNAL"; message: string };

function classify(e: unknown): JobResult {
  if (e instanceof UnsafeZipError || e instanceof UnsafeCsvValueError || e instanceof InputDataError) {
    return { ok: false, code: "BAD_INPUT", message: e.message };
  }
  if (e instanceof UnsupportedFormulaError) return { ok: false, code: "UNSUPPORTED", message: e.message };
  if (e instanceof TemplateShapeError) return { ok: false, code: "BAD_TEMPLATE", message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  if (/zip|central directory|end of data|invalid|corrupt/i.test(msg)) {
    return { ok: false, code: "BAD_INPUT", message: "The file is not a valid .xlsx workbook." };
  }
  return { ok: false, code: "INTERNAL", message: msg };
}

async function run(job: Job): Promise<{ result: JobResult; transfer: ArrayBuffer[] }> {
  try {
    // Bound decompression before exceljs inflates anything (zip-bomb guard).
    if (job.kind === "convert") assertSafeZip(job.input);
    assertSafeZip(job.template);
    if (job.kind === "convert") {
      const out = await convert(job.input, job.template, { useReferenceNumber: job.useReferenceNumber });
      const xlsx = new Uint8Array(out.xlsx.buffer, out.xlsx.byteOffset, out.xlsx.byteLength); // copied before transfer
      return {
        result: { ok: true, kind: "convert", xlsx, csv: out.csv, stats: { ...out.stats } },
        transfer: [],
      };
    }
    const wb = await loadWorkbook(job.template);
    const names = wb.worksheets.map((w) => w.name);
    if (!wb.getWorksheet("Data") || !wb.getWorksheet("DB") || wb.worksheets.length < 3) {
      throw new TemplateShapeError(
        `Template must have at least 3 sheets including "Data" and "DB" (found: ${names.join(", ")})`,
      );
    }
    if (names.indexOf("DB") !== 1) {
      throw new TemplateShapeError(`"DB" must be the second sheet — the CSV is taken from the second sheet`);
    }
    // Dry run: evaluating every formula surfaces any unsupported function/format now,
    // at upload time, instead of during a conversion.
    const values = evaluateAll(wb);
    const fns = new Set<string>();
    wb.worksheets.forEach((ws) =>
      ws.eachRow((row) =>
        row.eachCell((c) => {
          const f = c.formula;
          if (f) for (const m of f.matchAll(/([A-Z][A-Z0-9.]*)\(/g)) fns.add(m[1]);
        }),
      ),
    );
    return {
      result: { ok: true, kind: "inspectTemplate", formulas: values.size, functions: [...fns].sort(), sheets: names },
      transfer: [],
    };
  } catch (e) {
    return { result: classify(e), transfer: [] };
  }
}

parentPort!.on("message", async (msg: { id: number; job: Job }) => {
  const { result } = await run(msg.job);
  const transfer: ArrayBuffer[] = [];
  if (result.ok && result.kind === "convert") {
    // Node Buffers may live in a shared, non-transferable pool; move a private copy instead.
    const own = new Uint8Array(result.xlsx.byteLength);
    own.set(result.xlsx);
    result.xlsx = own;
    transfer.push(own.buffer);
  }
  try {
    parentPort!.postMessage({ id: msg.id, result }, transfer);
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, result: { ok: false, code: "INTERNAL", message: String(e) } satisfies JobResult });
  }
});
