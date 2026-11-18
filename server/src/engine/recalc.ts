/**
 * Recalculates every formula in an exceljs workbook with the built-in evaluator
 * and stores the results as cached values — the job Microsoft Excel used to do
 * when the desktop app opened and re-saved the file.
 */
import "./exceljs-patches.js";
import ExcelJS from "exceljs";
import { Evaluator, type Grid } from "./formula/evaluator.js";
import { jsDateToSerial } from "./formula/dates.js";
import { BLANK, XError, type ErrorCode, type Scalar, UnsupportedFormulaError } from "./formula/values.js";

const { ValueType } = ExcelJS;

function richTextToString(v: ExcelJS.CellRichTextValue): string {
  return v.richText.map((r) => r.text).join("");
}

export class WorkbookGrid implements Grid {
  private byLower = new Map<string, ExcelJS.Worksheet>();
  private date1904: boolean;

  constructor(private wb: ExcelJS.Workbook) {
    for (const ws of wb.worksheets) this.byLower.set(ws.name.toLowerCase(), ws);
    this.date1904 = Boolean((wb.properties as { date1904?: boolean }).date1904);
  }

  resolveSheet(name: string): string | null {
    return this.byLower.get(name.toLowerCase())?.name ?? null;
  }

  private ws(sheet: string): ExcelJS.Worksheet {
    return this.byLower.get(sheet.toLowerCase())!;
  }

  cell(sheet: string, row: number, col: number): { formula: string } | Scalar {
    const c = this.ws(sheet).findCell(row, col);
    if (!c) return BLANK;
    return cellToScalar(c, this.date1904);
  }

  *columnCells(sheet: string, col: number, r1: number, r2: number): Iterable<[number]> {
    const ws = this.ws(sheet);
    const last = Math.min(r2, ws.rowCount);
    for (let r = r1; r <= last; r++) {
      const c = ws.findCell(r, col);
      if (c && c.type !== ValueType.Null && c.type !== ValueType.Merge) yield [r];
    }
  }
}

export function cellToScalar(c: ExcelJS.Cell, date1904: boolean): { formula: string } | Scalar {
  switch (c.type) {
    case ValueType.Null:
    case ValueType.Merge:
      return BLANK;
    case ValueType.Number:
      return c.value as number;
    case ValueType.String:
      return c.value as string;
    case ValueType.Boolean:
      return c.value as boolean;
    case ValueType.Date:
      return jsDateToSerial(c.value as Date, date1904);
    case ValueType.RichText:
      return richTextToString(c.value as ExcelJS.CellRichTextValue);
    case ValueType.Hyperlink: {
      const t = (c.value as ExcelJS.CellHyperlinkValue).text;
      return typeof t === "string" ? t : richTextToString(t as unknown as ExcelJS.CellRichTextValue);
    }
    case ValueType.Error:
      return new XError((c.value as ExcelJS.CellErrorValue).error as ErrorCode);
    case ValueType.SharedString:
      return String(c.text);
    case ValueType.Formula: {
      const f = c.formula;
      if (!f) throw new UnsupportedFormulaError(`Unreadable formula`, c.fullAddress.address);
      const v = c.value as { shareType?: string; ref?: string };
      if (v && v.shareType === "array") {
        throw new UnsupportedFormulaError(`Array formulas are not supported`, c.fullAddress.address);
      }
      return { formula: f };
    }
    default:
      throw new UnsupportedFormulaError(`Unsupported cell type ${c.type}`, c.fullAddress.address);
  }
}

function toCachedResult(v: Scalar): ExcelJS.CellFormulaValue["result"] {
  if (v === BLANK) return 0;
  if (v instanceof XError) return { error: v.code } as ExcelJS.CellErrorValue;
  return v as number | string | boolean;
}

export interface RecalcStats {
  formulas: number;
  functionsUsed: string[];
}

/** Evaluate every formula cell (sheet order, row-major) and store the cached result in place. */
export function recalculate(wb: ExcelJS.Workbook): RecalcStats {
  const grid = new WorkbookGrid(wb);
  const ev = new Evaluator(grid);
  let formulas = 0;
  const targets: Array<[ExcelJS.Cell, string]> = [];
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.type === ValueType.Formula) {
          targets.push([cell, ws.name]);
        }
      });
    });
  }
  for (const [cell, sheet] of targets) {
    const result = ev.evaluateCell(sheet, Number(cell.row), Number(cell.col));
    // Keep the formula / shared-formula definition, replace only the cached result.
    const current = cell.value as unknown as Record<string, unknown>;
    cell.value = { ...current, result: toCachedResult(result) } as ExcelJS.CellValue;
    formulas++;
  }
  return { formulas, functionsUsed: [...ev.functionsUsed].sort() };
}

/** Evaluate without mutating; returns a map "Sheet!R:C" -> value. Used by the parity harness. */
export function evaluateAll(wb: ExcelJS.Workbook, sheets?: string[]): Map<string, Scalar> {
  const grid = new WorkbookGrid(wb);
  const ev = new Evaluator(grid);
  const out = new Map<string, Scalar>();
  for (const ws of wb.worksheets) {
    if (sheets && !sheets.includes(ws.name)) continue;
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.type === ValueType.Formula) {
          out.set(`${ws.name}!${cell.row}:${cell.col}`, ev.evaluateCell(ws.name, Number(cell.row), Number(cell.col)));
        }
      });
    });
  }
  return out;
}
