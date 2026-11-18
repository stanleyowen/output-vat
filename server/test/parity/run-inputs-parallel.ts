/**
 * Parallel end-to-end accuracy check: every raw input in <data>/input is converted
 * by the production engine and compared byte-for-byte with the CSV Excel produced
 * (<data>/tmp/<same name>.csv). Spreads inputs over worker threads.
 *
 *   PARITY_DATA_DIR=../../output-vat-db [PARITY_WORKERS=4] npx tsx test/parity/run-inputs-parallel.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { InputJob, InputResult } from "./inputs-worker.js";

const DATA = path.resolve(process.env.PARITY_DATA_DIR ?? "../../output-vat-db");
const WORKERS = Number(process.env.PARITY_WORKERS ?? Math.max(1, os.availableParallelism() - 1));

// Most recent template first; older ones only matter for older months.
const ORDER = ["New", "Mom Modifed", "Mom", "Old", "Experimental"];
const templates = ORDER.map((n) => path.join(DATA, `Excel Template - ${n}.xlsx`)).filter((p) => fs.existsSync(p));

const jobs: InputJob[] = fs
  .readdirSync(path.join(DATA, "input"))
  .filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"))
  .sort()
  .map((f) => ({
    input: path.join(DATA, "input", f),
    expectedCsv: path.join(DATA, "tmp", f.replace(/\.xlsx$/, ".csv")),
    templates,
  }))
  .filter((j) => {
    if (fs.existsSync(j.expectedCsv)) return true;
    console.log(`SKIP  ${path.basename(j.input)} (no Excel CSV to compare with)`);
    return false;
  });

const bootstrap = new URL("../../src/worker/dev-bootstrap.mjs", import.meta.url);
const entry = new URL("./inputs-worker.ts", import.meta.url).href;

console.log(`${jobs.length} inputs · ${templates.length} templates · ${WORKERS} parallel workers · ${os.cpus()[0]?.model ?? ""} (${os.platform()}/${os.arch()}, node ${process.version})\n`);
const t0 = performance.now();
const results: InputResult[] = [];
let next = 0;

await Promise.all(
  Array.from({ length: Math.min(WORKERS, jobs.length) }, () =>
    new Promise<void>((resolve, reject) => {
      const w = new Worker(bootstrap, { workerData: { entry }, resourceLimits: { maxOldGenerationSizeMb: 1024, stackSizeMb: 32 } });
      const feed = () => {
        if (next >= jobs.length) {
          void w.terminate().then(() => resolve());
          return;
        }
        w.postMessage(jobs[next++]);
      };
      w.on("message", (r: InputResult) => {
        results.push(r);
        const name = path.basename(r.input);
        console.log(
          `${r.identical ? "PASS" : "FAIL"}  ${name.padEnd(42)} ${r.identical ? `IDENTICAL via ${r.matched}` : r.error ? `ERROR ${r.error}` : "no template reproduces it"}  (${(r.ms / 1000).toFixed(1)}s)`,
        );
        for (const d of r.closestDiff ?? []) console.log(`        ${d}`);
        feed();
      });
      w.on("error", reject);
      w.on("online", feed);
    }),
  ),
);

const pass = results.filter((r) => r.identical).length;
const byTemplate = new Map<string, number>();
for (const r of results) if (r.matched) byTemplate.set(r.matched, (byTemplate.get(r.matched) ?? 0) + 1);
console.log(`\n${pass}/${results.length} byte-identical to Excel · wall time ${((performance.now() - t0) / 1000).toFixed(1)}s`);
for (const [t, n] of byTemplate) console.log(`  ${n} × ${t}`);
process.exit(pass === results.length ? 0 : 1);
