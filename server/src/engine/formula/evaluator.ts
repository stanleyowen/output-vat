/**
 * Formula evaluator over an abstract grid. Implements exactly the Excel
 * functions used by the VAT templates; any other function aborts the
 * conversion with UnsupportedFormulaError.
 */
import { numToCol, colToNum, MAX_COL, MAX_ROW, parseFormula, type Node } from "./parser.js";
import { serialToYMD, textToNumber, MAX_SERIAL } from "./dates.js";
import { formatNumber, formatText } from "./numfmt.js";
import {
  BLANK,
  ERR,
  isError,
  to15,
  toText,
  UnsupportedFormulaError,
  XError,
  type Scalar,
} from "./values.js";

/** Read access to the workbook. Implemented by the exceljs adapter. */
export interface Grid {
  /** Canonical sheet name for a (case-insensitive) reference, or null if unknown. */
  resolveSheet(name: string): string | null;
  /** Raw (non-formula) value of a cell, or the formula text if the cell holds one. */
  cell(sheet: string, row: number, col: number): { formula: string } | Scalar;
  /** Iterate the non-empty cells of a column range (row-ascending). */
  columnCells(sheet: string, col: number, r1: number, r2: number): Iterable<[row: number]>;
}

interface RefV {
  t: "ref";
  sheet: string;
  row: number;
  col: number;
}
interface RangeV {
  t: "range";
  sheet: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}
type EvalV = Scalar | RefV | RangeV;

const key = (sheet: string, row: number, col: number) => `${sheet}!${row}:${col}`;

/** Upper bound on cells a single SUM may scan (whole-sheet ranges would hang a worker). */
const MAX_RANGE_CELLS = 2_000_000;

export class Evaluator {
  private memo = new Map<string, Scalar>();
  private inProgress = new Set<string>();
  private astCache = new Map<string, Node>();
  private countifCache = new Map<string, Map<string, number>>();
  /** Functions encountered — for reporting. */
  readonly functionsUsed = new Set<string>();

  constructor(private grid: Grid) {}

  /** Final value of a cell as Excel would store it (blank formula results become 0). */
  valueOf(sheet: string, row: number, col: number): Scalar {
    const v = this.cellValue(sheet, row, col);
    return v;
  }

  /** Evaluate a formula cell; its stored result (BLANK -> 0 as Excel does). */
  evaluateCell(sheet: string, row: number, col: number): Scalar {
    const v = this.cellValue(sheet, row, col);
    return v === BLANK ? 0 : v;
  }

  private parse(formula: string): Node {
    let ast = this.astCache.get(formula);
    if (!ast) {
      ast = parseFormula(formula);
      this.astCache.set(formula, ast);
    }
    return ast;
  }

  /** Value of a cell for use inside another formula (blank stays BLANK). */
  private cellValue(sheet: string, row: number, col: number): Scalar {
    const k = key(sheet, row, col);
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    const raw = this.grid.cell(sheet, row, col);
    if (typeof raw !== "object" || raw instanceof XError || raw === null) {
      return raw as Scalar;
    }
    if (this.inProgress.has(k)) {
      throw new UnsupportedFormulaError(`Circular reference`, `${sheet}!${numToCol(col)}${row}`);
    }
    this.inProgress.add(k);
    let result: Scalar;
    try {
      const ast = this.parse(raw.formula);
      const ctx: Ctx = { sheet, row, col };
      const v = this.deref(this.eval(ast, ctx));
      // A formula returning a reference to a blank cell yields 0.
      result = v === BLANK ? 0 : v;
    } catch (e) {
      if (e instanceof UnsupportedFormulaError && !e.location) {
        throw new UnsupportedFormulaError(e.message, `${sheet}!${numToCol(col)}${row}`);
      }
      throw e;
    } finally {
      this.inProgress.delete(k);
    }
    this.memo.set(k, result);
    return result;
  }

  private deref(v: EvalV): Scalar {
    if (typeof v === "object" && v !== null && !(v instanceof XError)) {
      if (v.t === "ref") return this.cellValue(v.sheet, v.row, v.col);
      // Implicit intersection is not needed by the templates.
      if (v.r1 === v.r2 && v.c1 === v.c2) return this.cellValue(v.sheet, v.r1, v.c1);
      return ERR.VALUE;
    }
    return v as Scalar;
  }

  private sheetOf(name: string | null, ctx: Ctx): string {
    if (name === null) return ctx.sheet;
    const s = this.grid.resolveSheet(name);
    if (!s) throw new UnsupportedFormulaError(`Unknown sheet '${name}'`);
    return s;
  }

  private eval(n: Node, ctx: Ctx): EvalV {
    switch (n.kind) {
      case "num":
        return n.value;
      case "str":
        return n.value;
      case "bool":
        return n.value;
      case "ref":
        return { t: "ref", sheet: this.sheetOf(n.sheet, ctx), row: n.row, col: n.col };
      case "range":
        return { t: "range", sheet: this.sheetOf(n.sheet, ctx), r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 };
      case "unary": {
        const v = toNumber(this.deref(this.eval(n.arg, ctx)));
        if (isError(v)) return v;
        return n.op === "-" ? -v : v;
      }
      case "binary":
        return this.binary(n.op, this.deref(this.eval(n.left, ctx)), this.deref(this.eval(n.right, ctx)));
      case "call":
        return this.call(n.name, n.args, ctx);
    }
  }

  private binary(op: string, a: Scalar, b: Scalar): Scalar {
    if (op === "&") {
      const x = toText(a);
      if (isError(x)) return x;
      const y = toText(b);
      if (isError(y)) return y;
      return x + y;
    }
    if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
      if (isError(a)) return a;
      if (isError(b)) return b;
      const c = compare(a, b);
      switch (op) {
        case "=":
          return c === 0;
        case "<>":
          return c !== 0;
        case "<":
          return c < 0;
        case ">":
          return c > 0;
        case "<=":
          return c <= 0;
        default:
          return c >= 0;
      }
    }
    const x = toNumber(a);
    if (isError(x)) return x;
    const y = toNumber(b);
    if (isError(y)) return y;
    let r: number;
    switch (op) {
      case "+":
        r = x + y;
        break;
      case "-":
        r = x - y;
        break;
      case "*":
        r = x * y;
        break;
      case "/":
        if (y === 0) return ERR.DIV0;
        r = x / y;
        break;
      case "^":
        r = Math.pow(x, y);
        break;
      default:
        throw new UnsupportedFormulaError(`Operator ${op}`);
    }
    if (!Number.isFinite(r)) return ERR.NUM;
    return r;
  }

  private call(name: string, args: Node[], ctx: Ctx): EvalV {
    this.functionsUsed.add(name);
    const arity = (min: number, max: number) => {
      if (args.length < min || args.length > max) {
        throw new UnsupportedFormulaError(`${name} called with ${args.length} arguments`);
      }
    };
    const val = (i: number) => this.deref(this.eval(args[i], ctx));
    switch (name) {
      case "IF": {
        arity(1, 3);
        const c = toBool(val(0));
        if (isError(c)) return c;
        if (c) return args.length >= 2 ? this.eval(args[1], ctx) : true;
        return args.length >= 3 ? this.eval(args[2], ctx) : false;
      }
      case "ISNUMBER": {
        arity(1, 1);
        return typeof val(0) === "number";
      }
      case "ROW": {
        arity(0, 1);
        if (args.length === 0) return ctx.row;
        const r = this.eval(args[0], ctx);
        if (typeof r === "object" && r !== null && !(r instanceof XError)) {
          return r.t === "ref" ? r.row : r.r1;
        }
        throw new UnsupportedFormulaError(`ROW() of a non-reference`);
      }
      case "COLUMN": {
        arity(0, 1);
        if (args.length === 0) return ctx.col;
        const r = this.eval(args[0], ctx);
        if (typeof r === "object" && r !== null && !(r instanceof XError)) {
          return r.t === "ref" ? r.col : r.c1;
        }
        throw new UnsupportedFormulaError(`COLUMN() of a non-reference`);
      }
      case "ADDRESS": {
        arity(2, 5);
        const r = toNumber(val(0));
        if (isError(r)) return r;
        const c = toNumber(val(1));
        if (isError(c)) return c;
        const abs = args.length >= 3 ? toNumber(val(2)) : 1;
        if (isError(abs)) return abs;
        if (args.length >= 4) throw new UnsupportedFormulaError(`ADDRESS with a1/sheet arguments`);
        const row = Math.trunc(r);
        const col = Math.trunc(c);
        if (row < 1 || row > MAX_ROW || col < 1 || col > MAX_COL) return ERR.VALUE;
        const a = Math.trunc(abs);
        const colS = numToCol(col);
        switch (a) {
          case 1:
            return `$${colS}$${row}`;
          case 2:
            return `${colS}$${row}`;
          case 3:
            return `$${colS}${row}`;
          case 4:
            return `${colS}${row}`;
          default:
            return ERR.VALUE;
        }
      }
      case "INDIRECT": {
        arity(1, 2);
        if (args.length === 2) throw new UnsupportedFormulaError(`INDIRECT with R1C1 argument`);
        const t = val(0);
        if (isError(t)) return t;
        if (typeof t !== "string") return ERR.REF;
        const ref = parseA1(t);
        if (!ref) return ERR.REF;
        const sheet = ref.sheet === null ? ctx.sheet : this.grid.resolveSheet(ref.sheet);
        if (!sheet) return ERR.REF;
        return { t: "ref", sheet, row: ref.row, col: ref.col };
      }
      case "COUNTIF": {
        arity(2, 2);
        const rng = this.eval(args[0], ctx);
        if (typeof rng !== "object" || rng === null || rng instanceof XError) {
          throw new UnsupportedFormulaError(`COUNTIF range must be a reference`);
        }
        const crit = val(1);
        const range: RangeV =
          rng.t === "ref" ? { t: "range", sheet: rng.sheet, r1: rng.row, r2: rng.row, c1: rng.col, c2: rng.col } : rng;
        return this.countif(range, crit);
      }
      case "TEXT": {
        arity(2, 2);
        const v = val(0);
        if (isError(v)) return v;
        const f = toText(val(1));
        if (isError(f)) return f;
        let num: number;
        if (v === BLANK) num = 0;
        else if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
        else if (typeof v === "string") {
          const n = textToNumber(v);
          if (n === null) return formatText(v, f);
          num = n;
        } else num = v;
        const s = formatNumber(num, f);
        return s === null ? ERR.VALUE : s;
      }
      case "MONTH":
      case "YEAR": {
        arity(1, 1);
        const v = toNumber(val(0));
        if (isError(v)) return v;
        if (v < 0 || v > MAX_SERIAL) return ERR.NUM;
        const { y, m } = serialToYMD(v);
        return name === "MONTH" ? m : y;
      }
      case "CONCATENATE": {
        if (args.length < 1) throw new UnsupportedFormulaError(`CONCATENATE with no arguments`);
        let s = "";
        for (let i = 0; i < args.length; i++) {
          const t = toText(val(i));
          if (isError(t)) return t;
          s += t;
        }
        return s;
      }
      case "TRIM": {
        arity(1, 1);
        const t = toText(val(0));
        if (isError(t)) return t;
        return t.replace(/ +/g, " ").replace(/^ | $/g, "");
      }
      case "SUM": {
        if (args.length < 1) throw new UnsupportedFormulaError(`SUM with no arguments`);
        let total = 0;
        let cells = 0;
        for (const a of args) {
          const v = this.eval(a, ctx);
          if (typeof v === "object" && v !== null && !(v instanceof XError) && v.t === "range") {
            // References: only numeric cells count; text/logicals/blanks are ignored. Row-major order.
            const size = (v.r2 - v.r1 + 1) * (v.c2 - v.c1 + 1);
            cells += size;
            if (cells > MAX_RANGE_CELLS) throw new UnsupportedFormulaError(`SUM over more than ${MAX_RANGE_CELLS} cells`);
            for (let r = v.r1; r <= v.r2; r++) {
              for (let c = v.c1; c <= v.c2; c++) {
                const cv = this.cellValue(v.sheet, r, c);
                if (isError(cv)) return cv;
                if (typeof cv === "number") total += cv;
              }
            }
          } else if (typeof v === "object" && v !== null && !(v instanceof XError) && v.t === "ref") {
            const cv = this.cellValue(v.sheet, v.row, v.col);
            if (isError(cv)) return cv;
            if (typeof cv === "number") total += cv;
          } else {
            // Direct values: numbers, logicals and numeric text are coerced.
            const n = toNumber(v as Scalar);
            if (isError(n)) return n;
            total += n;
          }
        }
        return total;
      }
      case "ROUND":
      case "ROUNDDOWN":
      case "ROUNDUP": {
        arity(2, 2);
        const x = toNumber(val(0));
        if (isError(x)) return x;
        const d = toNumber(val(1));
        if (isError(d)) return d;
        return excelRound(x, Math.trunc(d), name === "ROUND" ? "half" : name === "ROUNDDOWN" ? "down" : "up");
      }
      default:
        throw new UnsupportedFormulaError(`Function ${name}() is not supported`);
    }
  }

  private countif(range: RangeV, crit: Scalar): number | XError {
    if (isError(crit)) return crit;
    const matcher = buildCriteria(crit);
    const rk = `${range.sheet}!${range.r1}:${range.c1}:${range.r2}:${range.c2}`;
    let perRange = this.countifCache.get(rk);
    if (!perRange) {
      perRange = new Map();
      this.countifCache.set(rk, perRange);
    }
    const ck = matcher.key;
    const hit = perRange.get(ck);
    if (hit !== undefined) return hit;
    let count = 0;
    let nonBlank = 0;
    for (let c = range.c1; c <= range.c2; c++) {
      for (const [row] of this.grid.columnCells(range.sheet, c, range.r1, range.r2)) {
        const v = this.cellValue(range.sheet, row, c);
        if (v === BLANK) continue;
        nonBlank++;
        if (matcher.test(v)) count++;
      }
    }
    if (matcher.matchesBlank) {
      const total = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
      count += total - nonBlank;
    }
    perRange.set(ck, count);
    return count;
  }
}

interface Ctx {
  sheet: string;
  row: number;
  col: number;
}

function parseA1(text: string): { sheet: string | null; row: number; col: number } | null {
  const m = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text.trim());
  if (!m) return null;
  const col = colToNum(m[3]);
  const row = Number(m[4]);
  if (row < 1 || row > MAX_ROW || col < 1 || col > MAX_COL) return null;
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? null);
  return { sheet, row, col };
}

/**
 * Excel ROUND/ROUNDDOWN/ROUNDUP: operates on the 15-significant-digit decimal value,
 * so ROUND(2.675,2)=2.68 and ROUNDDOWN(0.3*3,1)=0.9 (plain binary rounding gets both wrong).
 */
export function excelRound(x: number, digits: number, mode: "half" | "down" | "up"): number {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const p = Math.pow(10, Math.abs(digits));
  let y = digits >= 0 ? ax * p : ax / p;
  y = Number(y.toPrecision(15));
  y = mode === "half" ? Math.floor(y + 0.5) : mode === "down" ? Math.floor(y) : Math.ceil(y);
  const r = digits >= 0 ? y / p : y * p;
  return sign * r;
}

export function toNumber(v: Scalar): number | XError {
  if (v === BLANK) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = textToNumber(v);
    return n === null ? ERR.VALUE : n;
  }
  return v;
}

function toBool(v: Scalar): boolean | XError {
  if (v === BLANK) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const u = v.toUpperCase();
    if (u === "TRUE") return true;
    if (u === "FALSE") return false;
    return ERR.VALUE;
  }
  return v;
}

/** Excel comparison: numbers < text < logicals; text is case-insensitive; blank adapts to the other side. */
export function compare(a: Scalar, b: Scalar): number {
  if (a === BLANK && b === BLANK) return 0;
  if (a === BLANK) a = blankLike(b);
  if (b === BLANK) b = blankLike(a);
  const rank = (v: Scalar) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") {
    const x = to15(a);
    const y = to15(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a === b ? 0 : a ? 1 : -1;
}

function blankLike(other: Scalar): Scalar {
  if (typeof other === "number") return 0;
  if (typeof other === "string") return "";
  if (typeof other === "boolean") return false;
  return 0;
}

interface Criteria {
  key: string;
  matchesBlank: boolean;
  test(v: Scalar): boolean;
}

type WTok = { k: "lit"; c: string } | { k: "one" } | { k: "any" };

/**
 * Excel wildcard matcher (* ? and ~ escapes), case-insensitive.
 * Iterative with single-star backtracking: O(n*m) worst case, never exponential
 * (a RegExp built from user data could backtrack catastrophically).
 */
function wildcardMatcher(pattern: string): (s: string) => boolean {
  const toks: WTok[] = [];
  const p = pattern.toLowerCase();
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "~" && i + 1 < p.length && "*?~".includes(p[i + 1])) toks.push({ k: "lit", c: p[++i] });
    else if (ch === "*") {
      if (toks[toks.length - 1]?.k !== "any") toks.push({ k: "any" });
    } else if (ch === "?") toks.push({ k: "one" });
    else toks.push({ k: "lit", c: ch });
  }
  return (input: string) => {
    const s = input.toLowerCase();
    let si = 0;
    let ti = 0;
    let starTi = -1;
    let starSi = 0;
    while (si < s.length) {
      const t = toks[ti];
      if (t && (t.k === "one" || (t.k === "lit" && t.c === s[si]))) {
        si++;
        ti++;
      } else if (t && t.k === "any") {
        starTi = ti++;
        starSi = si;
      } else if (starTi >= 0) {
        ti = starTi + 1;
        si = ++starSi;
      } else return false;
    }
    while (toks[ti]?.k === "any") ti++;
    return ti === toks.length;
  };
}

/** COUNTIF criteria semantics (operator prefix, numeric coercion, wildcards). */
function buildCriteria(crit: Scalar): Criteria {
  if (crit === BLANK) crit = "";
  if (typeof crit === "number") {
    const n = to15(crit);
    return {
      key: `n:${n}`,
      matchesBlank: false,
      test: (v) => numericOf(v) === n,
    };
  }
  if (typeof crit === "boolean") {
    return { key: `b:${crit}`, matchesBlank: false, test: (v) => v === crit };
  }
  const s = crit as string;
  const om = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(s)!;
  const op = om[1] ?? "=";
  const rhs = om[2];
  const k = `s:${op}:${rhs.toLowerCase()}`;
  if (rhs === "") {
    if (op === "=") {
      // "" (no operator) matches blank and empty-text cells; "=" matches blank only.
      const noOp = om[1] === undefined;
      return { key: k + (noOp ? ":any" : ":eq"), matchesBlank: true, test: (v) => noOp && v === "" };
    }
    if (op === "<>") return { key: k, matchesBlank: false, test: (v) => v !== "" };
    throw new UnsupportedFormulaError(`COUNTIF criteria "${s}"`);
  }
  const num = textToNumber(rhs);
  if (num !== null) {
    const n = to15(num);
    const cmp = (x: number) =>
      op === "=" ? x === n : op === "<>" ? x !== n : op === "<" ? x < n : op === ">" ? x > n : op === "<=" ? x <= n : x >= n;
    return {
      key: k,
      matchesBlank: op === "<>",
      test: (v) => {
        const x = numericOf(v);
        if (x === null) return op === "<>";
        return cmp(x);
      },
    };
  }
  const upper = rhs.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") {
    const b = upper === "TRUE";
    if (op !== "=" && op !== "<>") throw new UnsupportedFormulaError(`COUNTIF criteria "${s}"`);
    return { key: k, matchesBlank: op === "<>", test: (v) => (op === "=" ? v === b : v !== b) };
  }
  if (op === "=" || op === "<>") {
    const match = wildcardMatcher(rhs);
    return {
      key: k,
      matchesBlank: op === "<>",
      test: (v) => {
        const hit = typeof v === "string" && match(v);
        return op === "=" ? hit : !hit;
      },
    };
  }
  throw new UnsupportedFormulaError(`COUNTIF criteria "${s}"`);
}

/** Numeric value used by COUNTIF numeric criteria: numbers, and text that parses as a number. */
function numericOf(v: Scalar): number | null {
  if (typeof v === "number") return to15(v);
  if (typeof v === "string") {
    const n = textToNumber(v);
    return n === null ? null : to15(n);
  }
  return null;
}
