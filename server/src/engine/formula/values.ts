/**
 * Excel value model used by the formula evaluator.
 *
 * Only the semantics needed by the VAT templates are modelled, but each one is
 * modelled the way Excel does it (blank coercion, case-insensitive text compare,
 * 15-significant-digit number display, error propagation).
 */

export type ErrorCode =
  | "#NULL!"
  | "#DIV/0!"
  | "#VALUE!"
  | "#REF!"
  | "#NAME?"
  | "#NUM!"
  | "#N/A";

export class XError {
  constructor(readonly code: ErrorCode) {}
  toString(): string {
    return this.code;
  }
}

export const BLANK: unique symbol = Symbol("BLANK");
export type Blank = typeof BLANK;

/** A scalar Excel value. */
export type Scalar = number | string | boolean | XError | Blank;

export const isError = (v: unknown): v is XError => v instanceof XError;

export const ERR = {
  VALUE: new XError("#VALUE!"),
  REF: new XError("#REF!"),
  DIV0: new XError("#DIV/0!"),
  NA: new XError("#N/A"),
  NAME: new XError("#NAME?"),
  NUM: new XError("#NUM!"),
} as const;

/**
 * Thrown when a template uses something the engine does not implement.
 * Conversion must stop rather than silently produce a different result than Excel.
 */
export class UnsupportedFormulaError extends Error {
  constructor(message: string, readonly location?: string) {
    super(location ? `${message} (at ${location})` : message);
    this.name = "UnsupportedFormulaError";
  }
}

/** Round to 15 significant digits, as Excel does for display / text conversion. */
export function to15(n: number): number {
  if (n === 0 || !Number.isFinite(n)) return n;
  return Number(n.toPrecision(15));
}

/**
 * Excel's number -> text conversion used by `&`, CONCATENATE, TRIM, etc.
 * ("General" format without a column-width limit).
 */
export function numberToText(n: number): string {
  if (n === 0) return "0";
  const r = to15(n);
  const abs = Math.abs(r);
  if (abs >= 1e15 || abs < 1e-9) {
    // Scientific: mantissa with up to 15 significant digits, exponent at least 2 digits.
    const [mant, exp] = r.toExponential(14).split("e");
    const m = mant.includes(".") ? mant.replace(/\.?0+$/, "") : mant;
    const e = Number(exp);
    const sign = e < 0 ? "-" : "+";
    return `${m}E${sign}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  // Fixed notation; toPrecision(15) then strip trailing zeros.
  let s = r.toPrecision(15);
  if (s.includes("e")) {
    // toPrecision can still use exponent form for small numbers (e.g. 1e-7)
    s = r.toFixed(Math.min(100, 15 - Math.floor(Math.log10(abs))));
  }
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return s;
}

export function toText(v: Scalar): string | XError {
  if (v === BLANK) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numberToText(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v;
}
