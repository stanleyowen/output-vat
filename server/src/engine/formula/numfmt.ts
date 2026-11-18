/**
 * Excel number-format rendering for TEXT(). Supports digit placeholders (0 # ?),
 * decimal point, thousands grouping, percent, quoted/escaped literals, sections,
 * and date/time codes. Anything else throws UnsupportedFormulaError so results
 * never silently diverge from Excel.
 */
import { MAX_SERIAL, serialToYMD } from "./dates.js";
import { to15, UnsupportedFormulaError } from "./values.js";

type FTok =
  | { k: "lit"; v: string }
  | { k: "digit"; v: "0" | "#" | "?" }
  | { k: "dot" }
  | { k: "comma" }
  | { k: "pct" }
  | { k: "at" }
  | { k: "date"; v: string } // d dd ddd dddd m.. y.. h.. s.. AM/PM
  | { k: "min"; v: string };

const cache = new Map<string, FTok[][]>();

function splitSections(fmt: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      if (end < 0) throw new UnsupportedFormulaError(`Unterminated quote in format "${fmt}"`);
      cur += fmt.slice(i, end + 1);
      i = end;
    } else if (ch === "\\") {
      cur += fmt.slice(i, i + 2);
      i++;
    } else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function tokenizeSection(sec: string, fmt: string): FTok[] {
  const toks: FTok[] = [];
  let i = 0;
  const lower = sec.toLowerCase();
  while (i < sec.length) {
    const ch = sec[i];
    const lc = lower[i];
    if (ch === '"') {
      const end = sec.indexOf('"', i + 1);
      toks.push({ k: "lit", v: sec.slice(i + 1, end) });
      i = end + 1;
    } else if (ch === "\\") {
      toks.push({ k: "lit", v: sec[i + 1] ?? "" });
      i += 2;
    } else if (ch === "0" || ch === "#" || ch === "?") {
      toks.push({ k: "digit", v: ch });
      i++;
    } else if (ch === ".") {
      toks.push({ k: "dot" });
      i++;
    } else if (ch === ",") {
      toks.push({ k: "comma" });
      i++;
    } else if (ch === "%") {
      toks.push({ k: "pct" });
      i++;
    } else if (ch === "@") {
      toks.push({ k: "at" });
      i++;
    } else if (lc === "d" || lc === "y" || lc === "m" || lc === "h" || lc === "s") {
      let j = i;
      while (j < sec.length && lower[j] === lc) j++;
      const run = lower.slice(i, j);
      toks.push({ k: "date", v: run });
      i = j;
    } else if (lower.startsWith("am/pm", i)) {
      toks.push({ k: "date", v: "ampm" });
      i += 5;
    } else if (" -+/():$".includes(ch)) {
      toks.push({ k: "lit", v: ch });
      i++;
    } else if (ch === "_" || ch === "*") {
      throw new UnsupportedFormulaError(`Unsupported padding code '${ch}' in format "${fmt}"`);
    } else if (ch === "[" || lc === "e" || lc === "g") {
      throw new UnsupportedFormulaError(`Unsupported number format "${fmt}"`);
    } else {
      throw new UnsupportedFormulaError(`Unsupported character '${ch}' in format "${fmt}"`);
    }
  }
  // Disambiguate m / mm: minutes when right after an hour token or right before a seconds token.
  const dateIdx = toks.map((t, idx) => (t.k === "date" ? idx : -1)).filter((x) => x >= 0);
  for (let n = 0; n < dateIdx.length; n++) {
    const t = toks[dateIdx[n]] as { k: "date"; v: string };
    if (t.v[0] !== "m" || t.v.length > 2) continue;
    const prev = n > 0 ? (toks[dateIdx[n - 1]] as { v: string }).v : "";
    const nxt = n + 1 < dateIdx.length ? (toks[dateIdx[n + 1]] as { v: string }).v : "";
    if (prev[0] === "h" || nxt[0] === "s") toks[dateIdx[n]] = { k: "min", v: t.v };
  }
  return toks;
}

function compile(fmt: string): FTok[][] {
  let c = cache.get(fmt);
  if (!c) {
    if (/^general$/i.test(fmt.trim())) {
      throw new UnsupportedFormulaError(`TEXT format "General" is not supported`);
    }
    const secs = splitSections(fmt);
    if (secs.length > 4) throw new UnsupportedFormulaError(`Too many sections in format "${fmt}"`);
    c = secs.map((s) => tokenizeSection(s, fmt));
    cache.set(fmt, c);
  }
  return c;
}

/** Round a non-negative number to `dp` decimals, half away from zero, on its 15-digit decimal form. */
function roundDecimal(x: number, dp: number): string {
  const s = to15(x).toPrecision(15); // may be exponential for tiny/huge values
  let [intDigits, frac] = ["", ""];
  let exp = 0;
  const em = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  let digits: string;
  if (em) {
    digits = em[1] + (em[2] ?? "");
    exp = Number(em[3]) + 1; // position of decimal point relative to digits start
  } else {
    const [a, b = ""] = s.split(".");
    digits = a + b;
    exp = a.length;
  }
  // Normalise into int/frac strings
  if (exp <= 0) {
    intDigits = "0";
    frac = "0".repeat(-exp) + digits;
  } else if (exp >= digits.length) {
    intDigits = digits + "0".repeat(exp - digits.length);
    frac = "";
  } else {
    intDigits = digits.slice(0, exp);
    frac = digits.slice(exp);
  }
  frac = frac.padEnd(dp + 1, "0");
  const keep = intDigits + frac.slice(0, dp);
  const roundUp = Number(frac[dp]) >= 5;
  let out = keep;
  if (roundUp) {
    const arr = keep.split("").map(Number);
    let k = arr.length - 1;
    while (k >= 0) {
      if (arr[k] === 9) {
        arr[k] = 0;
        k--;
      } else {
        arr[k]++;
        break;
      }
    }
    out = (k < 0 ? "1" : "") + arr.join("");
  }
  const ip = out.slice(0, out.length - dp).replace(/^0+(?=\d)/, "") || "0";
  const fp = dp > 0 ? out.slice(out.length - dp) : "";
  return dp > 0 ? `${ip}.${fp}` : ip;
}

function formatNumberSection(x: number, toks: FTok[], fmt: string): string {
  if (toks.some((t) => t.k === "at")) throw new UnsupportedFormulaError(`'@' in numeric section of "${fmt}"`);
  const firstDigit = toks.findIndex((t) => t.k === "digit");
  if (firstDigit < 0) {
    // No placeholders: format is pure literal text.
    return toks.map((t) => (t.k === "lit" ? t.v : t.k === "pct" ? "%" : "")).join("");
  }
  let lastDigit = -1;
  toks.forEach((t, idx) => {
    if (t.k === "digit") lastDigit = idx;
  });
  const prefix = toks.slice(0, firstDigit);
  const body = toks.slice(firstDigit, lastDigit + 1);
  const suffix = toks.slice(lastDigit + 1);
  for (const t of [...prefix, ...suffix]) {
    if (t.k === "comma" || t.k === "dot" || t.k === "date" || t.k === "min") {
      throw new UnsupportedFormulaError(`Unsupported number format "${fmt}"`);
    }
  }
  let intPh = "";
  let fracPh = "";
  let seenDot = false;
  let grouping = false;
  for (const t of body) {
    if (t.k === "digit") {
      if (seenDot) fracPh += t.v;
      else intPh += t.v;
    } else if (t.k === "dot") {
      if (seenDot) throw new UnsupportedFormulaError(`Unsupported number format "${fmt}"`);
      seenDot = true;
    } else if (t.k === "comma" && !seenDot) {
      grouping = true;
    } else {
      throw new UnsupportedFormulaError(`Literals inside digit placeholders unsupported: "${fmt}"`);
    }
  }
  const pct = [...prefix, ...suffix].filter((t) => t.k === "pct").length;
  let v = Math.abs(x) * Math.pow(100, pct);
  const rounded = roundDecimal(v, fracPh.length);
  let [ip, fp = ""] = rounded.split(".");
  // Integer part
  const minInt = (intPh.match(/0/g) ?? []).length;
  if (ip === "0" && minInt === 0) ip = "";
  ip = ip.padStart(minInt, "0");
  if (grouping && ip) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Fraction part: trailing '#' drop zeros, trailing '?' become spaces
  let fpOut = "";
  if (fracPh) {
    const chars = fp.split("");
    for (let k = chars.length - 1; k >= 0; k--) {
      if (chars[k] !== "0") break;
      if (fracPh[k] === "#") chars[k] = "";
      else if (fracPh[k] === "?") chars[k] = " ";
      else break;
    }
    fpOut = chars.join("");
  }
  const lit = (ts: FTok[]) => ts.map((t) => (t.k === "lit" ? t.v : t.k === "pct" ? "%" : "")).join("");
  void v;
  return lit(prefix) + ip + (seenDot ? "." + fpOut : "") + lit(suffix);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDateSection(serial: number, toks: FTok[], fmt: string): string {
  if (serial < 0 || serial > MAX_SERIAL) return "#VALUE!"; // caller maps to error
  // Round to the nearest second like Excel's display.
  let totalSec = Math.round(serial * 86400);
  const dayN = Math.floor(totalSec / 86400);
  let secOfDay = totalSec - dayN * 86400;
  const { y, m, d } = serialToYMD(dayN);
  const hasAmPm = toks.some((t) => t.k === "date" && t.v === "ampm");
  const H = Math.floor(secOfDay / 3600);
  const Mi = Math.floor((secOfDay % 3600) / 60);
  const S = secOfDay % 60;
  const weekday = (dayN + 6) % 7; // serial 1 (1900-01-01) is a Sunday in Excel
  let out = "";
  for (const t of toks) {
    if (t.k === "lit") out += t.v;
    else if (t.k === "min") out += t.v.length === 1 ? String(Mi) : String(Mi).padStart(2, "0");
    else if (t.k === "date") {
      const v = t.v;
      if (v === "ampm") out += H < 12 ? "AM" : "PM";
      else if (v[0] === "d") {
        if (v.length === 1) out += String(d);
        else if (v.length === 2) out += String(d).padStart(2, "0");
        else if (v.length === 3) out += DAY_NAMES[weekday].slice(0, 3);
        else out += DAY_NAMES[weekday];
      } else if (v[0] === "m") {
        if (v.length === 1) out += String(m);
        else if (v.length === 2) out += String(m).padStart(2, "0");
        else if (v.length === 3) out += MONTH_NAMES[m - 1].slice(0, 3);
        else if (v.length === 5) out += MONTH_NAMES[m - 1][0];
        else out += MONTH_NAMES[m - 1];
      } else if (v[0] === "y") {
        if (v.length <= 2) out += String(y % 100).padStart(2, "0");
        else out += String(y);
      } else if (v[0] === "h") {
        const hh = hasAmPm ? ((H + 11) % 12) + 1 : H;
        out += v.length === 1 ? String(hh) : String(hh).padStart(2, "0");
      } else if (v[0] === "s") {
        out += v.length === 1 ? String(S) : String(S).padStart(2, "0");
      }
    } else {
      throw new UnsupportedFormulaError(`Unsupported date format "${fmt}"`);
    }
  }
  void secOfDay;
  return out;
}

/**
 * Format a number with an Excel format string. Returns null when Excel would
 * return #VALUE! (e.g. negative date).
 */
export function formatNumber(x: number, fmt: string): string | null {
  const secs = compile(fmt);
  let toks: FTok[];
  let autoMinus = false;
  if (secs.length === 1) {
    toks = secs[0];
    autoMinus = x < 0;
  } else if (x > 0 || (x === 0 && secs.length === 2)) {
    toks = secs[0];
  } else if (x < 0) {
    toks = secs[1];
  } else {
    toks = secs[2];
  }
  const isDate = toks.some((t) => t.k === "date" || t.k === "min");
  if (isDate) {
    if (toks.some((t) => t.k === "digit" || t.k === "pct" || t.k === "comma")) {
      throw new UnsupportedFormulaError(`Mixed date/number format "${fmt}"`);
    }
    if (x < 0) return null;
    const s = formatDateSection(x, toks, fmt);
    return s === "#VALUE!" ? null : s;
  }
  const s = formatNumberSection(x, toks, fmt);
  return autoMinus ? "-" + s : s;
}

/** Text section handling for TEXT("abc", fmt). */
export function formatText(s: string, fmt: string): string {
  const secs = compile(fmt);
  if (secs.length < 4) return s;
  return secs[3].map((t) => (t.k === "lit" ? t.v : t.k === "at" ? s : "")).join("");
}
