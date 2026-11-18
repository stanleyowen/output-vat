/**
 * Worker for run-inputs-parallel.ts: converts one raw input with each candidate
 * template/setting until the CSV is byte-identical to the one Excel produced.
 */
import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { convert } from "../../src/engine/convert.js";
import { assertSafeZip } from "../../src/engine/zipguard.js";

export interface InputJob {
  input: string;
  expectedCsv: string;
  templates: string[];
}

export interface InputResult {
  input: string;
  identical: boolean;
  matched: string | null;
  tried: number;
  ms: number;
  invoices?: number;
  closestDiff?: string[];
  error?: string;
}

const templateCache = new Map<string, Buffer>();

function firstDiffs(ours: string, excel: string, max = 3): string[] {
  const a = ours.split("\n");
  const b = excel.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
    if (a[i] !== b[i]) out.push(`line ${i + 1}: ours=${JSON.stringify((a[i] ?? "").slice(0, 120))} excel=${JSON.stringify((b[i] ?? "").slice(0, 120))}`);
  }
  if (a.length !== b.length) out.push(`line count ours=${a.length} excel=${b.length}`);
  return out;
}

parentPort!.on("message", async (job: InputJob) => {
  const t0 = performance.now();
  const res: InputResult = { input: job.input, identical: false, matched: null, tried: 0, ms: 0 };
  try {
    const inputBuf = fs.readFileSync(job.input);
    assertSafeZip(inputBuf); // same upload guard as production
    const expected = fs.readFileSync(job.expectedCsv, "utf8");
    let best: { label: string; diff: string[] } | null = null;
    outer: for (const t of job.templates) {
      let tbuf = templateCache.get(t);
      if (!tbuf) templateCache.set(t, (tbuf = fs.readFileSync(t)));
      for (const useReferenceNumber of [false, true]) {
        res.tried++;
        const label = `${t.split("/").pop()} | useReferenceNumber=${useReferenceNumber}`;
        const out = await convert(inputBuf, tbuf, { useReferenceNumber });
        if (out.csv === expected) {
          res.identical = true;
          res.matched = label;
          res.invoices = out.csv.split("\n").filter((l) => l.startsWith("FK;")).length - 1;
          break outer;
        }
        const diff = firstDiffs(out.csv, expected);
        if (!best || diff.length < best.diff.length) best = { label, diff };
      }
    }
    if (!res.identical && best) res.closestDiff = [`closest: ${best.label}`, ...best.diff];
  } catch (e) {
    res.error = (e as Error).message;
  }
  res.ms = Math.round(performance.now() - t0);
  parentPort!.postMessage(res);
});
