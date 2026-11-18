import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Evaluator, type Grid } from "../src/engine/formula/evaluator.js";
import { parseDateText, textToNumber } from "../src/engine/formula/dates.js";
import { formatNumber } from "../src/engine/formula/numfmt.js";
import { colToNum } from "../src/engine/formula/parser.js";
import { BLANK, numberToText, UnsupportedFormulaError, XError, type Scalar } from "../src/engine/formula/values.js";

/** Tiny in-memory grid: { "S!A1": value | "=formula" } */
function grid(cells: Record<string, Scalar | string>): Grid {
  const map = new Map<string, Scalar | { formula: string }>();
  for (const [k, v] of Object.entries(cells)) {
    const [sheet, a1] = k.split("!");
    const m = /^([A-Z]+)(\d+)$/.exec(a1)!;
    const key = `${sheet}!${Number(m[2])}:${colToNum(m[1])}`;
    map.set(key, typeof v === "string" && v.startsWith("=") ? { formula: v.slice(1) } : (v as Scalar));
  }
  return {
    resolveSheet: (n) => (["S", "Data"].find((s) => s.toLowerCase() === n.toLowerCase()) ?? null),
    cell: (s, r, c) => map.get(`${s}!${r}:${c}`) ?? BLANK,
    *columnCells(s, c, r1, r2) {
      const rows = [...map.keys()]
        .map((k) => k.split(/[!:]/))
        .filter(([sh, , col]) => sh === s && Number(col) === c)
        .map(([, r]) => Number(r))
        .filter((r) => r >= r1 && r <= r2)
        .sort((a, b) => a - b);
      for (const r of rows) yield [r];
    },
  };
}

function evalOne(formula: string, cells: Record<string, Scalar | string> = {}): Scalar {
  const g = grid({ ...cells, "S!Z99": formula });
  return new Evaluator(g).evaluateCell("S", 99, 26);
}

describe("number -> text (General)", () => {
  it("formats like Excel", () => {
    assert.equal(numberToText(19449788), "19449788");
    assert.equal(numberToText(0.1 + 0.2), "0.3");
    assert.equal(numberToText(-2.5), "-2.5");
    assert.equal(numberToText(123456789012345), "123456789012345");
    assert.equal(numberToText(1271112406710002), "1.27111240671E+15");
    assert.equal(numberToText(1e-10), "1E-10");
  });
});

describe("TEXT formats used by the templates", () => {
  it("0, 00, 0.0", () => {
    assert.equal(formatNumber(6, "0"), "6");
    assert.equal(formatNumber(8, "00"), "08");
    assert.equal(formatNumber(45, "0.0"), "45.0");
    assert.equal(formatNumber(2.25, "0.0"), "2.3");
    assert.equal(formatNumber(1.005, "0.00"), "1.01"); // Excel rounds the decimal form, not the binary
    assert.equal(formatNumber(-0.4, "0"), "-0");
    assert.equal(formatNumber(1234567.891, "#,##0.00"), "1,234,567.89");
  });
  it("d/mm/yyyy", () => {
    assert.equal(formatNumber(46174, "d/mm/yyyy"), "1/06/2026");
    assert.equal(formatNumber(60, "d/mm/yyyy"), "29/02/1900"); // Excel's 1900 leap-year bug
    assert.equal(formatNumber(61, "dd/mm/yyyy"), "01/03/1900");
  });
  it("rejects unsupported formats loudly", () => {
    assert.throws(() => formatNumber(1, "[Red]0"), UnsupportedFormulaError);
    assert.throws(() => formatNumber(1, "0.00E+00"), UnsupportedFormulaError);
  });
});

describe("text -> number/date coercion (DMY locale)", () => {
  it("parses day-first dates", () => {
    assert.equal(parseDateText("1/06/2026"), 46174);
    assert.equal(parseDateText("13/06/2026"), 46186);
    assert.equal(parseDateText("31/02/2026"), null);
    assert.equal(parseDateText("2026-06-01"), 46174);
    assert.equal(parseDateText("1-Jun-2026"), 46174);
  });
  it("parses numbers", () => {
    assert.equal(textToNumber(" 1,234.5 "), 1234.5);
    assert.equal(textToNumber("50%"), 0.5);
    assert.equal(textToNumber("B 2238"), null);
  });
});

describe("evaluator semantics", () => {
  it("MONTH/YEAR of a DMY text date", () => {
    assert.equal(evalOne('=TEXT(MONTH("1/06/2026"),0)'), "6");
    assert.equal(evalOne('=TEXT(YEAR(Data!A1),0)', { "Data!A1": "1/06/2026" }), "2026");
  });
  it("blank handling", () => {
    assert.equal(evalOne("=Data!A1"), 0); // reference to an empty cell yields 0
    assert.equal(evalOne('=IF(Data!A1="","empty","x")'), "empty");
    assert.equal(evalOne("=IF(Data!A1=0,1,2)"), 1);
    assert.equal(evalOne("=ISNUMBER(Data!A1)"), false);
    assert.equal(evalOne('=Data!A1&"x"'), "x");
  });
  it("comparison is case-insensitive and type-ordered", () => {
    assert.equal(evalOne('=IF("fk"="FK",1,0)'), 1);
    assert.equal(evalOne('=1="1"'), false);
    assert.equal(evalOne('=1<"a"'), true);
  });
  it("INDIRECT(ADDRESS(ROW()+n,COLUMN()))", () => {
    const g = grid({ "S!B1": "=INDIRECT(ADDRESS(ROW()+2,COLUMN()))", "S!B3": 42 });
    assert.equal(new Evaluator(g).evaluateCell("S", 1, 2), 42);
  });
  it("COUNTIF with text, numeric-text and wildcard criteria", () => {
    const cells = { "S!B1": "B 2238", "S!B2": "b 2238", "S!B3": "B 2239", "S!B4": 5, "S!B5": "5", "S!B6": "=Data!Q1" };
    assert.equal(evalOne('=COUNTIF($B:$B,"B 2238")', cells), 2);
    assert.equal(evalOne('=COUNTIF($B:$B,"B 223*")', cells), 3);
    assert.equal(evalOne("=COUNTIF($B:$B,5)", cells), 2);
    assert.equal(evalOne('=COUNTIF($B:$B,">4")', cells), 2);
    assert.equal(evalOne("=COUNTIF($B:$B,0)", cells), 1); // B6 references a blank cell -> 0
  });
  it("errors propagate and TRIM collapses spaces", () => {
    assert.ok(evalOne('=ROW()+""') instanceof XError);
    assert.equal(evalOne('=TRIM("  a   b ")'), "a b");
    assert.equal(evalOne('=CONCATENATE("""",Data!A1,"""")', { "Data!A1": "x" }), '"x"');
  });
  it("ROUND family uses Excel's decimal rounding", () => {
    assert.equal(evalOne("=ROUND(2.675,2)"), 2.68);
    assert.equal(evalOne("=ROUND(-2.5,0)"), -3);
    assert.equal(evalOne("=ROUND(1234.5,-2)"), 1200);
    assert.equal(evalOne("=ROUNDDOWN(0.3*3,1)"), 0.9);
    assert.equal(evalOne("=ROUNDUP(1.001,2)"), 1.01);
    assert.equal(evalOne("=ROUNDDOWN(-1.99,0)"), -1);
    assert.equal(evalOne("=200*11%"), 22);
  });
  it("refuses functions it does not implement", () => {
    assert.throws(() => evalOne("=VLOOKUP(1,A:B,2,FALSE)"), UnsupportedFormulaError);
    assert.throws(() => evalOne("=SUMPRODUCT(A1:A3)"), UnsupportedFormulaError);
    assert.equal(evalOne("=SUM(Data!A1:A3,2,TRUE)", { "Data!A1": 1.5, "Data!A2": "x", "Data!A3": 2 }), 6.5);
  });
});
