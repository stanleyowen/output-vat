/**
 * Excel serial date helpers (1900 date system, including the 1900 leap-year bug)
 * and locale-aware text -> number coercion.
 *
 * The desktop app ran on a machine whose Excel parses text dates as
 * DAY/MONTH/YEAR (verified: MONTH("1/06/2026") returned 6 in historical output).
 * DATE_ORDER encodes that; changing it changes results.
 */
export const DATE_ORDER: "DMY" | "MDY" = "DMY";

const MS_PER_DAY = 86_400_000;
// Serial 0 == 1899-12-30 for serials >= 61 (Excel's fake 1900-02-29 is serial 60).
const EPOCH_UTC = Date.UTC(1899, 11, 30);

export const MAX_SERIAL = 2_958_465; // 9999-12-31

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export function serialToYMD(serial: number): YMD {
  const n = Math.floor(serial);
  if (n === 60) return { y: 1900, m: 2, d: 29 };
  if (n === 0) return { y: 1900, m: 1, d: 0 }; // Excel shows 0-Jan-1900
  const days = n < 60 ? n + 1 : n;
  const dt = new Date(EPOCH_UTC + days * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function ymdToSerial(y: number, m: number, d: number): number | null {
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  if (y === 1900 && m === 2 && d === 29) return 60;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  const days = Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / MS_PER_DAY);
  return days <= 60 ? days - 1 : days;
}

/** JS Date (as produced by exceljs, i.e. UTC wall-clock) -> Excel serial. */
export function jsDateToSerial(date: Date, date1904 = false): number {
  const serial = (date.getTime() - EPOCH_UTC) / MS_PER_DAY;
  // exceljs writes Dates with this exact formula (no 1900 leap-bug correction),
  // so we mirror it to get the same number Excel sees in the saved file.
  return date1904 ? serial - 1462 : serial;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthFromName(s: string): number | null {
  const t = s.toLowerCase();
  if (t.length < 3) return null;
  const idx = MONTHS.findIndex((m) => m.startsWith(t) || (t.length >= 3 && m.slice(0, 3) === t));
  return idx >= 0 ? idx + 1 : null;
}

function expandYear(ys: string): number {
  const y = Number(ys);
  if (ys.length <= 2) return y < 30 ? 2000 + y : 1900 + y;
  return y;
}

function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?\s*(am|pm)?$/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const se = m[3] ? Number(m[3]) : 0;
  if (m[4]) {
    if (h < 1 || h > 12) return null;
    if (m[4].toLowerCase() === "pm" && h !== 12) h += 12;
    if (m[4].toLowerCase() === "am" && h === 12) h = 0;
  }
  if (h > 23 || mi > 59 || se >= 60) return null;
  return (h * 3600 + mi * 60 + se) / 86400;
}

/** Parse a date (optionally with time) string the way Excel's DATEVALUE does in a DMY locale. */
export function parseDateText(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // Split optional trailing time
  let datePart = s;
  let frac = 0;
  const tm = /^(.*?)[\sT]+(\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?(?:\s*[ap]m)?)$/i.exec(s);
  if (tm) {
    const t = parseTime(tm[2]);
    if (t === null) return null;
    datePart = tm[1];
    frac = t;
  } else {
    const t = parseTime(s);
    if (t !== null) return t;
  }
  let y: number, m: number, d: number;
  let mm: RegExpExecArray | null;
  if ((mm = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(datePart))) {
    y = Number(mm[1]);
    m = Number(mm[2]);
    d = Number(mm[3]);
  } else if ((mm = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(datePart))) {
    const a = Number(mm[1]);
    const b = Number(mm[2]);
    [d, m] = DATE_ORDER === "DMY" ? [a, b] : [b, a];
    y = expandYear(mm[3]);
  } else if ((mm = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]+(\d{2}|\d{4})$/.exec(datePart))) {
    const mo = monthFromName(mm[2]);
    if (!mo) return null;
    d = Number(mm[1]);
    m = mo;
    y = expandYear(mm[3]);
  } else if ((mm = /^([A-Za-z]{3,9})[-\s/]+(\d{1,2}),?[-\s/]+(\d{4})$/.exec(datePart))) {
    const mo = monthFromName(mm[1]);
    if (!mo) return null;
    m = mo;
    d = Number(mm[2]);
    y = Number(mm[3]);
  } else {
    // Forms that depend on "today" (e.g. "1/6", "Jun 1") are not reproducible.
    return null;
  }
  const serial = ymdToSerial(y, m, d);
  if (serial === null) return null;
  return serial + frac;
}

const NUM_RE = /^([+-])?(?:(\d{1,3}(?:,\d{3})+|\d+)(\.\d*)?|(\.\d+))(?:[eE]([+-]?\d+))?(%)?$/;

/** Excel text -> number coercion (VALUE semantics). Returns null when not numeric. */
export function textToNumber(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const m = NUM_RE.exec(s);
  if (m) {
    const intPart = (m[2] ?? "").replace(/,/g, "");
    const num = Number(`${intPart}${m[3] ?? ""}${m[4] ?? ""}${m[5] !== undefined ? "e" + m[5] : ""}`);
    if (!Number.isFinite(num)) return null;
    let v = m[1] === "-" ? -num : num;
    if (m[6]) v /= 100;
    return v;
  }
  // Parenthesised negatives: (123)
  const pm = /^\((\d+(?:\.\d+)?)\)$/.exec(s);
  if (pm) return -Number(pm[1]);
  return parseDateText(s);
}
