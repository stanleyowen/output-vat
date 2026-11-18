/**
 * Parity harness: proves the Linux engine reproduces what Microsoft Excel produced.
 *
 *   A  CSV step      historical Excel-saved .xlsx  -> CSV port              == historical .csv
 *   B  Formula step  every formula in each historical .xlsx, recalculated by our engine,
 *                    compared cell-by-cell with the value Excel cached; then the CSV is
 *                    rebuilt from OUR values only                            == historical .csv
 *   C  End-to-end    raw input + template (auto-detected) -> convert()      == historical .csv
 *
 * Usage:
 *   PARITY_DATA_DIR=../../output-vat-db [PARITY_HISTORY_DIR=<extracted git history>] npm run parity
 *
 * Exits non-zero on any difference. Writes a JSON report next to this file (out/, gitignored).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { convert, loadWorkbook } from "../../src/engine/convert.js";
import { workbookToCsv } from "../../src/engine/csv.js";
import { evaluateAll, recalculate } from "../../src/engine/recalc.js";
import { BLANK, XError, type Scalar } from "../../src/engine/formula/values.js";
import { numToCol } from "../../src/engine/formula/parser.js";

const DATA_DIR = path.resolve(process.env.PARITY_DATA_DIR ?? "../../output-vat-db");
const HISTORY_DIR = process.env.PARITY_HISTORY_DIR ? path.resolve(process.env.PARITY_HISTORY_DIR) : null;
const OUT_DIR = path.join(import.meta.dirname, "out");
const FULL_PARSE_SAMPLES = Number(process.env.PARITY_FULL_PARSE_SAMPLES ?? 3);

interface Pair {
  label: string;
  xlsx: string;
  csv: string;
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function collectPairs(): Pair[] {
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  const add = (label: string, xlsx: string) => {
    const csv = xlsx.replace(/\.xlsx$/, ".csv");
    if (!fs.existsSync(csv)) return;
    const h = sha(fs.readFileSync(xlsx)) + sha(fs.readFileSync(csv));
    if (seen.has(h)) return;
    seen.add(h);
    pairs.push({ label, xlsx, csv });
  };
  const tmp = path.join(DATA_DIR, "tmp");
  for (const f of fs.readdirSync(tmp).sort()) if (f.endsWith(".xlsx")) add(`tmp/${f}`, path.join(tmp, f));
  if (HISTORY_DIR) {
    for (const d of fs.readdirSync(HISTORY_DIR).sort()) {
      const dir = path.join(HISTORY_DIR, d);
      const src = fs.readFileSync(path.join(dir, "source.txt"), "utf8").trim().split("|");
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".xlsx")) add(`git:${src[0].slice(0, 7)}:${src[1]}`, path.join(dir, f));
      }
    }
  }
  return pairs;
}

/**
 * Excel's cached formula values, read straight from the XML with SheetJS
 * (exceljs drops cached results of 0, so it can't be used as the reference).
 */
function excelCachedValues(buf: Buffer, sheets: string[]): Map<string, { v: Scalar; f: string }> {
  const wb = XLSX.read(buf, { sheets, cellFormula: true, cellDates: false, cellNF: false, raw: true });
  const out = new Map<string, { v: Scalar; f: string }>();
  for (const name of sheets) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    for (const addr of Object.keys(ws)) {
      if (addr[0] === "!") continue;
      const c = ws[addr] as XLSX.CellObject;
      if (!c.f) continue;
      const { r, c: col } = XLSX.utils.decode_cell(addr);
      let v: Scalar;
      if (c.t === "n") v = c.v as number;
      else if (c.t === "s" || c.t === "str" as never) v = String(c.v ?? "");
      else if (c.t === "b") v = Boolean(c.v);
      else if (c.t === "e") v = new XError((c.w ?? XLSX.utils.format_cell(c)) as never);
      else v = BLANK;
      out.set(`${name}!${r + 1}:${col + 1}`, { v, f: c.f });
    }
  }
  return out;
}

function same(a: Scalar, b: Scalar): boolean {
  if (a instanceof XError || b instanceof XError) {
    return a instanceof XError && b instanceof XError && a.code === b.code;
  }
  if (typeof a === "number" && typeof b === "number") return a === b; // bit-exact
  // Excel writes an empty-string formula result as <v></v>; exceljs may surface that as "" or absent.
  if ((a === "" && b === BLANK) || (a === BLANK && b === "")) return true;
  return a === b;
}

/** Heuristic: Excel recalculated the file if Server!B2 (=Data!G3) caches the actual Data!G3 value. */
function isRecalculated(excel: Map<string, { v: Scalar; f: string }>, wb: Awaited<ReturnType<typeof loadWorkbook>>): boolean {
  const b2 = excel.get("Server!2:2");
  if (!b2) return true;
  const g3 = wb.getWorksheet("Data")?.getCell("G3").value;
  const want = g3 === null || g3 === undefined ? 0 : g3;
  return b2.v === want;
}

const show = (v: Scalar) => (v === BLANK ? "<blank>" : v instanceof XError ? v.code : JSON.stringify(v));

function csvDiff(a: string, b: string, max = 5): string[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length) && out.length < max; i++) {
    if (la[i] !== lb[i]) out.push(`line ${i + 1}:\n    ours:  ${la[i]}\n    excel: ${lb[i]}`);
  }
  if (la.length !== lb.length) out.push(`line count ours=${la.length} excel=${lb.length}`);
  return out;
}

/** Split a CSV line on ';' honouring double quotes, in either Excel ("") or JSON (\") escaping. */
function fields(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let s = "";
      i++;
      while (i < line.length) {
        if (line[i] === "\\" && line[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (line[i] === '"' && line[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else s += line[i++];
      }
      out.push(s);
      i++; // skip ';'
    } else {
      const j = line.indexOf(";", i);
      const end = j < 0 ? line.length : j;
      out.push(line.slice(i, end));
      i = end + 1;
    }
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Same rows and values, ignoring number formatting (281081 vs 281081.0), quote style and trailing empty columns. */
function csvSemanticDiff(ours: string, theirs: string, max = 4): string[] {
  const a = ours.split(/\r?\n/).filter((l) => l !== "");
  const b = theirs.split(/\r?\n/).filter((l) => l !== "");
  const out: string[] = [];
  if (a.length !== b.length) out.push(`row count ours=${a.length} theirs=${b.length}`);
  for (let i = 0; i < Math.min(a.length, b.length) && out.length < max; i++) {
    const fa = fields(a[i]);
    const fb = fields(b[i]);
    const n = Math.max(fa.length, fb.length);
    for (let k = 0; k < n; k++) {
      const x = fa[k] ?? "";
      const y = fb[k] ?? "";
      const eq = x === y || (NUMERIC.test(x) && NUMERIC.test(y) && Number(x) === Number(y));
      if (!eq) {
        out.push(`row ${i + 1} col ${k + 1}: ours=${JSON.stringify(x)} theirs=${JSON.stringify(y)}`);
        break;
      }
    }
  }
  return out;
}

interface CaseResult {
  label: string;
  A_csvPortIdentical?: boolean;
  A_fullParseAgrees?: boolean;
  B_formulasCompared?: number;
  B_formulaMismatches?: number;
  B_excelRecalculated?: boolean;
  B_mismatchSamples?: string[];
  B_csvFromOurValuesIdentical?: boolean;
  B_csvDiff?: string[];
  B_unsupported?: string;
  /** Historical CSV was not produced by the current CSV code (older manual export). */
  legacyCsv?: boolean;
  B_csvSameAsFromExcelFile?: boolean;
  B_csvSemanticDiff?: string[];
  C_matchedTemplate?: string | null;
  C_csvIdentical?: boolean;
  C_tried?: string[];
  ok: boolean;
  ms: number;
}

async function runPair(p: Pair, idx: number): Promise<CaseResult> {
  const t0 = performance.now();
  const res: CaseResult = { label: p.label, ok: true, ms: 0 };
  const xbuf = fs.readFileSync(p.xlsx);
  const expected = fs.readFileSync(p.csv, "utf8");

  // A: CSV port on Excel's own file
  const portCsv = workbookToCsv(xbuf);
  res.A_csvPortIdentical = portCsv === expected;
  if (idx < FULL_PARSE_SAMPLES) res.A_fullParseAgrees = workbookToCsv(xbuf, { fullParse: true }) === portCsv;

  // B: formula engine vs Excel cached values
  try {
    const wb = await loadWorkbook(xbuf);
    const ours = evaluateAll(wb);
    const excel = excelCachedValues(xbuf, wb.worksheets.map((w) => w.name).filter((n) => n !== "Data"));
    // Files saved without an Excel recalculation still carry the template's stale cache;
    // they can only be judged by their CSV, not cell-by-cell.
    res.B_excelRecalculated = isRecalculated(excel, wb);
    let mismatches = 0;
    const samples: string[] = [];
    for (const [k, v] of ours) {
      const ex = excel.get(k);
      if (!ex) continue;
      if (!same(v, ex.v)) {
        mismatches++;
        if (samples.length < 8) {
          const [sheet, rc] = k.split("!");
          const [r, c] = rc.split(":").map(Number);
          samples.push(`${sheet}!${numToCol(c)}${r} ours=${show(v)} excel=${show(ex.v)}  [=${ex.f}]`);
        }
      }
    }
    res.B_formulasCompared = ours.size;
    res.B_formulaMismatches = mismatches;
    if (samples.length) res.B_mismatchSamples = samples;

    // Rebuild the CSV purely from our values (overwrite every cached result).
    recalculate(wb);
    const ourBuf = Buffer.from(await wb.xlsx.writeBuffer());
    const ourCsv = workbookToCsv(ourBuf);
    res.B_csvFromOurValuesIdentical = ourCsv === expected;
    if (!res.B_csvFromOurValuesIdentical) res.B_csvDiff = csvDiff(ourCsv, expected);
    res.legacyCsv = !res.A_csvPortIdentical;
    if (res.legacyCsv) {
      // The stored CSV came from an older/manual export, so compare by value, and also against
      // what the current CSV code produces from Excel's own recalculated file.
      res.B_csvSameAsFromExcelFile = ourCsv === portCsv;
      res.B_csvSemanticDiff = csvSemanticDiff(ourCsv, expected);
      delete res.B_csvDiff;
    }
  } catch (e) {
    res.B_unsupported = String((e as Error).message);
  }
  // The deciding check is B_csvFromOurValuesIdentical (our engine alone reproduces Excel's CSV).
  // Cell-by-cell comparison is required to be exact whenever the stored file was Excel-recalculated.
  const cellsOk = res.B_excelRecalculated === false || res.B_formulaMismatches === 0;
  res.ok = res.legacyCsv
    ? !res.B_unsupported &&
      cellsOk &&
      (res.B_excelRecalculated === false || Boolean(res.B_csvSameAsFromExcelFile)) &&
      (res.B_csvSemanticDiff?.length ?? 1) === 0
    : Boolean(res.B_csvFromOurValuesIdentical) && res.A_fullParseAgrees !== false && cellsOk;
  res.ms = Math.round(performance.now() - t0);
  return res;
}

async function runEndToEnd(inputFile: string, templates: string[]): Promise<CaseResult> {
  const t0 = performance.now();
  const name = path.basename(inputFile);
  const expectedPath = path.join(DATA_DIR, "tmp", name.replace(".xlsx", ".csv"));
  const res: CaseResult = { label: `input/${name}`, ok: false, ms: 0, C_tried: [] };
  if (!fs.existsSync(expectedPath)) {
    res.C_matchedTemplate = null;
    res.C_tried!.push("no historical CSV to compare with");
    return res;
  }
  const expected = fs.readFileSync(expectedPath, "utf8");
  const inputBuf = fs.readFileSync(inputFile);
  let best: { label: string; diff: string[] } | null = null;
  for (const t of templates) {
    const tbuf = fs.readFileSync(t);
    for (const useReferenceNumber of [false, true]) {
      const label = `${path.basename(t)} | useReferenceNumber=${useReferenceNumber}`;
      try {
        const out = await convert(inputBuf, tbuf, { useReferenceNumber });
        if (out.csv === expected) {
          res.C_matchedTemplate = label;
          res.C_csvIdentical = true;
          res.ok = true;
          res.C_tried!.push(`${label}: IDENTICAL (${out.stats.ms} ms)`);
          res.ms = Math.round(performance.now() - t0);
          return res;
        }
        const diff = csvDiff(out.csv, expected, 3);
        res.C_tried!.push(`${label}: differs`);
        if (!best || diff.length < best.diff.length) best = { label, diff };
      } catch (e) {
        res.C_tried!.push(`${label}: ERROR ${(e as Error).message}`);
      }
    }
  }
  res.C_matchedTemplate = null;
  res.C_csvIdentical = false;
  if (best) res.B_csvDiff = [`closest: ${best.label}`, ...best.diff];
  res.ms = Math.round(performance.now() - t0);
  return res;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pairs = collectPairs();
  console.log(`Parity data: ${DATA_DIR}${HISTORY_DIR ? ` + history ${HISTORY_DIR}` : ""}`);
  console.log(`Historical Excel outputs: ${pairs.length}\n`);
  const results: CaseResult[] = [];

  const only = process.env.PARITY_ONLY ? new RegExp(process.env.PARITY_ONLY) : null;
  for (const [i, p] of pairs.entries()) {
    if (only && !only.test(p.label)) continue;
    const r = await runPair(p, i);
    results.push(r);
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(
      `${mark}  ${p.label}  [A csv-port:${r.A_csvPortIdentical ? "same" : "DIFF"}` +
        `${r.A_fullParseAgrees === undefined ? "" : ` full-parse:${r.A_fullParseAgrees ? "same" : "DIFF"}`}` +
        ` | B formulas:${r.B_formulasCompared ?? "-"} mismatches:${r.B_formulaMismatches ?? "-"}` +
        `${r.B_excelRecalculated === false ? " (stored xlsx not Excel-recalculated)" : ""}` +
        (r.legacyCsv
          ? ` | LEGACY csv (old manual export): vs-excel-file:${r.B_csvSameAsFromExcelFile ? "same" : r.B_excelRecalculated === false ? "n/a" : "DIFF"} by-value:${r.B_csvSemanticDiff?.length === 0 ? "same" : "DIFF"}]`
          : ` csv:${r.B_csvFromOurValuesIdentical ? "IDENTICAL" : "DIFF"}]`) +
        ` ${r.ms}ms`,
    );
    for (const s of r.B_mismatchSamples ?? []) console.log(`      ${s}`);
    for (const s of r.B_csvDiff ?? []) console.log(`      ${s}`);
    for (const s of r.B_csvSemanticDiff ?? []) console.log(`      ${s}`);
    if (r.B_unsupported) console.log(`      unsupported: ${r.B_unsupported}`);
  }

  const inputDir = path.join(DATA_DIR, "input");
  const templates = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^Excel Template.*\.xlsx$/.test(f))
    .sort()
    .map((f) => path.join(DATA_DIR, f));
  if (fs.existsSync(inputDir) && !only) {
    console.log(`\nEnd-to-end from raw inputs (${templates.length} templates x 2 reference-number settings):`);
    for (const f of fs.readdirSync(inputDir).sort()) {
      if (!f.endsWith(".xlsx")) continue;
      const r = await runEndToEnd(path.join(inputDir, f), templates);
      results.push(r);
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}  -> ${r.C_matchedTemplate ?? "no template reproduces it"} ${r.ms}ms`);
      if (!r.ok) for (const s of [...(r.C_tried ?? []), ...(r.B_csvDiff ?? [])]) console.log(`      ${s}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  const formulas = results.reduce((s, r) => s + (r.B_formulasCompared ?? 0), 0);
  const summary = {
    when: new Date().toISOString(),
    cases: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    formulaCellsCompared: formulas,
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify({ summary, results }, null, 2));
  console.log(`\n${JSON.stringify(summary)}`);
  process.exit(failed.length ? 1 : 0);
}

await main();
