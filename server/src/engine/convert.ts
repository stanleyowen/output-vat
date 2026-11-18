/**
 * End-to-end conversion: raw input workbook + template -> filled & recalculated
 * workbook + CSV. Pure function of its inputs (no file system, no clock).
 */
import "./exceljs-patches.js";
import ExcelJS from "exceljs";
import { workbookToCsv } from "./csv.js";
import { fillTemplate, type FillResult } from "./fill.js";
import { recalculate, type RecalcStats } from "./recalc.js";

export interface ConvertOptions {
  useReferenceNumber: boolean;
}

export interface ConvertResult {
  xlsx: Buffer;
  csv: string;
  stats: FillResult & RecalcStats & { csvRows: number; ms: number };
}

export async function loadWorkbook(buf: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

export async function convert(
  inputBuf: Buffer | Uint8Array,
  templateBuf: Buffer | Uint8Array,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const t0 = performance.now();
  const [input, template] = await Promise.all([loadWorkbook(inputBuf), loadWorkbook(templateBuf)]);
  const fill = fillTemplate(input, template, opts);
  stripHyperlinks(template);
  const recalc = recalculate(template);
  // Like Excel: ask spreadsheet apps to recalculate when the user opens the file.
  template.calcProperties = { ...(template.calcProperties ?? {}), fullCalcOnLoad: true };
  const xlsx = Buffer.from(await template.xlsx.writeBuffer());
  const csv = workbookToCsv(xlsx);
  const csvRows = csv === "" ? 0 : csv.split("\n").length - 1;
  return { xlsx, csv, stats: { ...fill, ...recalc, csvRows, ms: Math.round(performance.now() - t0) } };
}

/**
 * Input cells are copied verbatim into the template, including hyperlink objects
 * (which could point at file:/javascript: targets in the downloaded workbook).
 * Keep only their text — the value Excel's formulas see is unchanged.
 */
function stripHyperlinks(wb: ExcelJS.Workbook): void {
  for (const ws of wb.worksheets) {
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Hyperlink) {
          const t = (cell.value as ExcelJS.CellHyperlinkValue).text;
          cell.value = (typeof t === "string" ? t : (t as unknown as ExcelJS.CellRichTextValue)) as ExcelJS.CellValue;
        }
      }),
    );
  }
}

/** "KK PPN 2606(CT).xlsx" -> "KK PPN 2606(CT).csv" (same rule as the desktop app). */
export function csvNameFor(inputName: string): string {
  const base = inputName.replace(/^.*[\\/]/, "");
  return base.includes(".xlsx") ? base.replace(".xlsx", ".csv") : `${base}.csv`;
}
