/**
 * Tokenizer + recursive-descent parser for the Excel formula subset used by the
 * VAT templates. Anything outside the grammar throws UnsupportedFormulaError.
 */
import { UnsupportedFormulaError } from "./values.js";

export type Node =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "ref"; sheet: string | null; row: number; col: number }
  | {
      kind: "range";
      sheet: string | null;
      r1: number; // 1-based; 1 for whole-column
      c1: number;
      r2: number; // 1048576 for whole-column
      c2: number;
    }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "unary"; op: "-" | "+"; arg: Node }
  | { kind: "binary"; op: BinOp; left: Node; right: Node };

export type BinOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

export const MAX_ROW = 1048576;
export const MAX_COL = 16384;

export function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string } // function names, booleans
  | { t: "ref"; v: string; sheet: string | null } // A1, $A$1, A:A, A1:B2 (raw text)
  | { t: "op"; v: string }
  | { t: "("; v: "(" }
  | { t: ")"; v: ")" }
  | { t: ","; v: "," };

const CELL_RE = /^\$?[A-Za-z]{1,3}\$?\d+/;
const COL_RANGE_RE = /^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}(?![A-Za-z0-9(])/;
const CELL_RANGE_RE = /^\$?[A-Za-z]{1,3}\$?\d+:\$?[A-Za-z]{1,3}\$?\d+/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new UnsupportedFormulaError(`Unterminated string in formula: ${src}`);
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ t: "str", v: s });
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ t: ch, v: ch } as Tok);
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "%") {
      out.push({ t: "op", v: "%" });
      i++;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "@" || ch === "#" || ch === ";" || ch === ":") {
      throw new UnsupportedFormulaError(`Unsupported syntax '${ch}' in formula: ${src}`);
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new UnsupportedFormulaError(`Bad number in formula: ${src}`);
      // A bare row range like 1:1 is not supported.
      if (src[i + m[0].length] === ":") throw new UnsupportedFormulaError(`Row ranges unsupported: ${src}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    // Sheet-qualified reference: 'Sheet name'!A1 or Sheet!A1
    let sheet: string | null = null;
    let j = i;
    if (ch === "'") {
      let s = "";
      j++;
      for (;;) {
        if (j >= src.length) throw new UnsupportedFormulaError(`Unterminated sheet name: ${src}`);
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          j++;
          break;
        }
        s += src[j++];
      }
      if (src[j] !== "!") throw new UnsupportedFormulaError(`Expected '!' after sheet name: ${src}`);
      sheet = s;
      j++;
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*!/.exec(src.slice(i));
      if (m) {
        sheet = m[0].slice(0, -1);
        j = i + m[0].length;
      }
    }
    const rest = src.slice(j);
    const rm = CELL_RANGE_RE.exec(rest) || COL_RANGE_RE.exec(rest);
    if (rm) {
      out.push({ t: "ref", v: rm[0], sheet });
      i = j + rm[0].length;
      continue;
    }
    const cm = CELL_RE.exec(rest);
    // A cell ref must not be immediately followed by '(' (e.g. LOG10( ) or letters.
    if (cm && !/[A-Za-z0-9_(]/.test(rest[cm[0].length] ?? "")) {
      out.push({ t: "ref", v: cm[0], sheet });
      i = j + cm[0].length;
      continue;
    }
    if (sheet !== null) throw new UnsupportedFormulaError(`Bad sheet reference in formula: ${src}`);
    const im = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (im) {
      out.push({ t: "ident", v: im[0].toUpperCase() });
      i += im[0].length;
      continue;
    }
    throw new UnsupportedFormulaError(`Unexpected character '${ch}' in formula: ${src}`);
  }
  return out;
}

function parseRefText(text: string, sheet: string | null): Node {
  const clean = text.replace(/\$/g, "").toUpperCase();
  if (clean.includes(":")) {
    const [a, b] = clean.split(":");
    const ma = /^([A-Z]+)(\d*)$/.exec(a)!;
    const mb = /^([A-Z]+)(\d*)$/.exec(b)!;
    const whole = ma[2] === "" && mb[2] === "";
    const c1 = colToNum(ma[1]);
    const c2 = colToNum(mb[1]);
    const r1 = whole ? 1 : Number(ma[2]);
    const r2 = whole ? MAX_ROW : Number(mb[2]);
    return {
      kind: "range",
      sheet,
      r1: Math.min(r1, r2),
      r2: Math.max(r1, r2),
      c1: Math.min(c1, c2),
      c2: Math.max(c1, c2),
    };
  }
  const m = /^([A-Z]+)(\d+)$/.exec(clean)!;
  return { kind: "ref", sheet, col: colToNum(m[1]), row: Number(m[2]) };
}

// Excel operator precedence (low -> high): comparison, &, + -, * /, ^, unary -
const PREC: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

export function parseFormula(formula: string): Node {
  const src = formula.startsWith("=") ? formula.slice(1) : formula;
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function parseExpr(minPrec: number): Node {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op") break;
      const prec = PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      // ^ is left-associative in Excel too.
      const right = parseExpr(prec + 1);
      left = { kind: "binary", op: t.v as BinOp, left, right };
    }
    return left;
  }

  function parseUnary(): Node {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      next();
      // Excel: unary minus binds tighter than ^ ( -2^2 = 4 )
      return { kind: "unary", op: t.v, arg: parseUnary() };
    }
    // Postfix percent binds tighter than ^ and looser than negation: x% == x/100
    let node = parsePrimary();
    while (peek()?.t === "op" && peek()!.v === "%") {
      next();
      node = { kind: "binary", op: "/", left: node, right: { kind: "num", value: 100 } };
    }
    return node;
  }

  function parsePrimary(): Node {
    const t = next();
    if (!t) throw new UnsupportedFormulaError(`Unexpected end of formula: ${formula}`);
    switch (t.t) {
      case "num":
        return { kind: "num", value: t.v };
      case "str":
        return { kind: "str", value: t.v };
      case "ref":
        return parseRefText(t.v, t.sheet);
      case "(": {
        const e = parseExpr(0);
        const c = next();
        if (!c || c.t !== ")") throw new UnsupportedFormulaError(`Missing ')' in formula: ${formula}`);
        return e;
      }
      case "ident": {
        if (peek()?.t === "(") {
          next();
          const args: Node[] = [];
          if (peek()?.t === ")") {
            next();
          } else {
            for (;;) {
              if (peek()?.t === "," || peek()?.t === ")") {
                throw new UnsupportedFormulaError(`Empty function argument in formula: ${formula}`);
              }
              args.push(parseExpr(0));
              const sep = next();
              if (!sep) throw new UnsupportedFormulaError(`Missing ')' in formula: ${formula}`);
              if (sep.t === ")") break;
              if (sep.t !== ",") throw new UnsupportedFormulaError(`Expected ',' in formula: ${formula}`);
            }
          }
          return { kind: "call", name: t.v.replace(/^_XLFN\./, ""), args };
        }
        if (t.v === "TRUE") return { kind: "bool", value: true };
        if (t.v === "FALSE") return { kind: "bool", value: false };
        throw new UnsupportedFormulaError(`Named ranges are not supported ('${t.v}') in formula: ${formula}`);
      }
      default:
        throw new UnsupportedFormulaError(`Unexpected token '${t.v}' in formula: ${formula}`);
    }
  }

  const ast = parseExpr(0);
  if (p !== toks.length) throw new UnsupportedFormulaError(`Unexpected trailing tokens in formula: ${formula}`);
  return ast;
}
