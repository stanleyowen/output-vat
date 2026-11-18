/**
 * Port of `parseExcelTemplate` from the desktop app (src/components/home.components.tsx),
 * minus the file-system and Excel-automation parts. The logic, including its
 * quirks (loose equality, invoice counting, fixed column map), is kept 1:1 so the
 * filled workbook is identical to what the desktop app handed to Excel.
 *
 * One deliberate difference: input cells that hold formulas (e.g. a faktur number
 * built as ="005258534"&D3) are copied as the value Excel saved for them, not as the
 * formula. Verified against the desktop app's Excel output for 2509/2601: the Data
 * sheet holds those saved values (no formulas), and the CSV matches byte for byte.
 */
import type ExcelJS from "exceljs";

/* eslint-disable eqeqeq -- loose equality is intentional: it mirrors the desktop code exactly. */

const COLUMN_MAP: ReadonlyArray<readonly [template: string, input: string]> = [
  ["A", "E"],
  ["B", "F"],
  ["C", "G"],
  ["D", "H"],
  ["E", "I"],
  ["F", "J"],
  ["G", "K"],
  ["H", "L"],
  ["I", "M"],
  ["J", "N"],
  ["K", "O"],
  ["L", "P"],
  ["M", "Q"],
  ["N", "R"],
  ["O", "S"],
  ["P", "T"],
  ["Q", "U"],
  ["R", "V"],
  ["S", "W"],
  ["T", "X"],
  ["U", "Y"],
  ["V", "Z"],
];

const DB_CLEAR_COLUMNS = "ABCDEFGHIJKLMNOPQR".split("");

export interface FillResult {
  /** Number of input rows copied into the template's Data sheet. */
  rowsCopied: number;
  /** Unique invoice numbers found in column K. */
  uniqueInvoices: number;
}

/** The input workbook can't be used as-is (reported to the user, not a server fault). */
export class InputDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputDataError";
  }
}

/** The value Excel shows for an input cell: a formula's saved result, otherwise the raw value. */
function displayedValue(cell: ExcelJS.Cell): ExcelJS.CellValue {
  const v = cell.value as unknown;
  if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) {
    const result = (v as { result?: unknown }).result;
    if (result === undefined) {
      throw new InputDataError(
        `Cell ${cell.address} in the export is a formula with no saved value. ` +
          "Open the file in Excel, save it, and upload it again.",
      );
    }
    return result as ExcelJS.CellValue;
  }
  return v as ExcelJS.CellValue;
}

export class TemplateShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateShapeError";
  }
}

export function fillTemplate(
  input: ExcelJS.Workbook,
  template: ExcelJS.Workbook,
  opts: { useReferenceNumber: boolean },
): FillResult {
  const activeTab = input.views?.[0]?.activeTab ?? 0;
  const fileData = input.worksheets[activeTab];
  if (!fileData) throw new TemplateShapeError("Input workbook has no active worksheet");
  const templateData = template.getWorksheet("Data");
  const templateDB = template.getWorksheet("DB");
  if (!templateData || !templateDB) {
    throw new TemplateShapeError('Template must contain worksheets named "Data" and "DB"');
  }
  if (template.worksheets.length < 3) {
    throw new TemplateShapeError("Template must contain at least 3 worksheets");
  }

  let rowIndexFile = 3;
  let rowIndexTemplate = 3;
  let invoices: unknown[] = [];
  let invoiceIndex = 3;
  let invoicesLength = 0;

  // Count the unique Invoice Number
  while (fileData.getCell(`K${invoiceIndex}`).value != "" && fileData.getCell(`K${invoiceIndex}`).value != null) {
    invoices.push(fileData.getCell(`K${invoiceIndex}`).value);
    invoiceIndex++;
    invoicesLength++;
  }

  // remove duplicate invoice number
  // Same result as the desktop's filter(indexOf) (first occurrences, in order) but O(n).
  invoices = [...new Set(invoices)];
  invoicesLength += invoices.length;

  let rowsCopied = 0;
  while (fileData.getCell(`A${rowIndexFile}`).value != "" && fileData.getCell(`A${rowIndexFile}`).value != null) {
    for (const [colTemplate, col] of COLUMN_MAP) {
      templateData.getCell(`${colTemplate}${rowIndexTemplate}`).value = displayedValue(fileData.getCell(`${col}${rowIndexFile}`));
    }

    if (fileData.getCell(`C${rowIndexFile + 1}`).value == "1") rowIndexTemplate++;

    rowIndexFile++;
    rowIndexTemplate++;
    rowsCopied++;
  }

  // Delete the remaining unused rows in the template
  rowIndexFile = 4;
  while (rowIndexFile <= 2500) {
    // Add Reference Number if useReferenceNumber is true
    if (rowIndexFile < invoicesLength + 4 && rowIndexFile > 4 && opts.useReferenceNumber) {
      templateDB.getCell(`S${rowIndexFile}`).value = {
        formula: `TRIM(Data!G${rowIndexFile - 2})`,
      } as ExcelJS.CellFormulaValue;
    }

    if (rowIndexFile >= invoicesLength + 4) {
      for (const col of DB_CLEAR_COLUMNS) templateDB.getCell(`${col}${rowIndexFile}`).value = null;
    }
    rowIndexFile++;
  }

  // Hide the first and the third sheets
  template.worksheets[0].state = "hidden";
  template.worksheets[2].state = "hidden";

  return { rowsCopied, uniqueInvoices: invoices.length };
}
