/**
 * Port of the desktop app's xlsx -> CSV step. It parses the *saved* workbook
 * with node-xlsx (same version as the desktop app) and reads the cached formula
 * results, exactly as the desktop did after Excel had recalculated the file.
 */
import xlsx from "node-xlsx";

/**
 * The e-Faktur CSV is ';'-joined with no escaping (kept for byte-parity with the
 * desktop app). A value containing ';', CR or LF would shift columns or forge extra
 * rows (e.g. a fake FK invoice line), so such data is refused instead of written.
 */
export class UnsafeCsvValueError extends Error {
  constructor(
    readonly row: number,
    readonly column: number,
    readonly value: string,
  ) {
    const shown = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    super(
      `Row ${row}, column ${column} of the CSV would contain a semicolon or line break (${JSON.stringify(shown)}). ` +
        "Remove it from the source file and convert again.",
    );
    this.name = "UnsafeCsvValueError";
  }
}

/**
 * @param fullParse  Parse every sheet like the desktop app did (slow: the template's
 *                   Data sheet is ~16k columns wide). The default parses only the
 *                   second sheet, which yields the identical rows for that sheet.
 */
export function workbookToCsv(xlsxBuffer: Buffer, { fullParse = false } = {}): string {
  // Processing DB sheet (second sheet, index 1)
  const sheet = fullParse
    ? xlsx.parse(xlsxBuffer)[1]
    : xlsx.parse(xlsxBuffer, { sheets: 1 } as Parameters<typeof xlsx.parse>[1])[0];
  if (!sheet) throw new Error("Workbook has no second sheet");

  const rows: unknown[][] = [];
  let writeStr = "";
  let j = 0;

  while (sheet.data[j]) {
    const row = sheet.data[j] as unknown[];
    if (row.length > 0) {
      // Handle quotes in the third column
      if (typeof row[2] === "string" && (row[2] as string).includes('"')) row[2] = JSON.stringify(row[2]);

      // Fill with empty strings if needed
      while (row.length < 21) row.push("");

      rows.push(row);
      j++;
    } else break;
  }

  for (let i = 0; i < rows.length; i++) {
    for (let c = 0; c < rows[i].length; c++) {
      const v = rows[i][c];
      // (Column C is JSON-quoted when it holds '"', which escapes CR/LF but not ';'.)
      if (typeof v === "string" && /[;\r\n]/.test(v)) {
        throw new UnsafeCsvValueError(i + 1, c + 1, v);
      }
    }
    writeStr += rows[i].join(";") + "\n";
  }
  return writeStr;
}
