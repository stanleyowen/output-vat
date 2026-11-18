/** Regression tests for the security review findings. */
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { assertSafeZip, UnsafeZipError } from "../src/engine/zipguard.js";
import { workbookToCsv, UnsafeCsvValueError } from "../src/engine/csv.js";
import { Evaluator, type Grid } from "../src/engine/formula/evaluator.js";
import { BLANK, UnsupportedFormulaError, type Scalar } from "../src/engine/formula/values.js";

/** Build a minimal zip with one deflated entry (local header + central directory + EOCD). */
function zipWith(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(data.length, 20);
  cen.writeUInt32LE(content.length, 24);
  cen.writeUInt16LE(n.length, 28);
  cen.writeUInt32LE(0, 42);
  const cdOffset = local.length + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cen.length + n.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, cen, n, eocd]);
}

function evalOne(formula: string, cells: Record<string, Scalar> = {}): Scalar {
  const g: Grid = {
    resolveSheet: (n) => (n.toLowerCase() === "s" ? "S" : null),
    cell: (s, r, c) => (r === 99 && c === 26 ? { formula: formula.slice(1) } : (cells[`${r}:${c}`] ?? BLANK)),
    *columnCells(_s, c, r1, r2) {
      for (const k of Object.keys(cells)) {
        const [r, cc] = k.split(":").map(Number);
        if (cc === c && r >= r1 && r <= r2) yield [r];
      }
    },
  };
  return new Evaluator(g).evaluateCell("S", 99, 26);
}

describe("zip-bomb guard (M2)", () => {
  it("rejects an entry that inflates past the budget", () => {
    const bomb = zipWith("xl/media/image1.png", Buffer.alloc(64 * 1024 * 1024)); // 64 MB of zeros, ~64 KB zipped
    assert.ok(bomb.length < 200_000);
    assert.throws(() => assertSafeZip(bomb, { maxTotalBytes: 16 * 1024 * 1024, maxEntries: 10 }), UnsafeZipError);
  });
  it("accepts a real workbook", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("A").getCell("A1").value = "x";
    const r = assertSafeZip(new Uint8Array(await wb.xlsx.writeBuffer()));
    assert.ok(r.entries > 3);
  });
  it("rejects non-zip data", () => {
    assert.throws(() => assertSafeZip(Buffer.from("not a zip at all, definitely not")), UnsafeZipError);
  });
});

describe("formula DoS limits (L1)", () => {
  it("wildcard COUNTIF criteria can't backtrack catastrophically", () => {
    const cells: Record<string, Scalar> = {};
    for (let r = 1; r <= 50; r++) cells[`${r}:2`] = "a".repeat(400);
    const t0 = performance.now();
    assert.equal(evalOne('=COUNTIF($B:$B,"*a*a*a*a*a*a*b")', cells), 0);
    assert.equal(evalOne('=COUNTIF($B:$B,"*a?a*")', cells), 50);
    assert.ok(performance.now() - t0 < 2000, "wildcard matching must be fast");
  });
  it("wildcards keep Excel semantics", () => {
    const cells: Record<string, Scalar> = { "1:2": "B 2238", "2:2": "b 22x8", "3:2": "A*B", "4:2": "AxB" };
    assert.equal(evalOne('=COUNTIF($B:$B,"b 22?8")', cells), 2);
    assert.equal(evalOne('=COUNTIF($B:$B,"A~*B")', cells), 1);
    assert.equal(evalOne('=COUNTIF($B:$B,"*")', cells), 4);
  });
  it("SUM refuses absurd ranges", () => {
    assert.throws(() => evalOne("=SUM(A1:XFD1048575)"), UnsupportedFormulaError);
  });
});

describe("CSV injection (L3)", () => {
  async function dbWorkbook(value: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Server");
    const db = wb.addWorksheet("DB");
    db.getCell("A1").value = "FK";
    db.getCell("B1").value = value;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  it("refuses values with ';' or line breaks", async () => {
    await assert.rejects(async () => workbookToCsv(await dbWorkbook("ACME;FK;forged")), UnsafeCsvValueError);
    await assert.rejects(async () => workbookToCsv(await dbWorkbook("line\nFK;x")), UnsafeCsvValueError);
  });
  it("leaves normal values untouched", async () => {
    assert.equal(workbookToCsv(await dbWorkbook("Jl. Rokan No.28, Pekanbaru")), "FK;Jl. Rokan No.28, Pekanbaru" + ";".repeat(19) + "\n");
  });
});

describe("formula cells in the sales export", () => {
  async function run(nValue: ExcelJS.CellValue) {
    const { convert } = await import("../src/engine/convert.js");
    const t = new ExcelJS.Workbook();
    t.addWorksheet("Server");
    const db = t.addWorksheet("DB");
    t.addWorksheet("Data");
    db.getCell("A1").value = "FK";
    db.getCell("A2").value = "LT";
    db.getCell("A3").value = "OF";
    db.getCell("A4").value = "FK";
    db.getCell("B4").value = { formula: "Data!J3" } as ExcelJS.CellFormulaValue;
    const i = new ExcelJS.Workbook();
    const ws = i.addWorksheet("Combine");
    ws.getCell("A3").value = 1;
    ws.getCell("K3").value = "INV-1";
    ws.getCell("D3").value = 1303;
    ws.getCell("N3").value = nValue;
    return convert(Buffer.from(await i.xlsx.writeBuffer()), Buffer.from(await t.xlsx.writeBuffer()), { useReferenceNumber: false });
  }
  it("are copied as the value Excel saved (like the desktop output)", async () => {
    const out = await run({ formula: '"005258534"&D3', result: "0052585341303" } as ExcelJS.CellFormulaValue);
    assert.equal(out.csv.split("\n")[3].split(";")[1], "0052585341303");
  });
  it("without a saved value are refused, not guessed", async () => {
    const { InputDataError } = await import("../src/engine/fill.js");
    await assert.rejects(run({ formula: '"005258534"&D3' } as ExcelJS.CellFormulaValue), InputDataError);
  });
});
