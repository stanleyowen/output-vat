/**
 * Small fixed-size worker pool. Conversions parse untrusted .xlsx files, so each
 * runs in a worker with its own heap limit and a hard timeout; a stuck or
 * crashed worker is terminated and replaced without affecting the API.
 */
import { Worker } from "node:worker_threads";
import type { Job, JobResult } from "./convert-worker.js";

interface Pending {
  id: number;
  job: Job;
  resolve: (r: JobResult) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: Pending | null;
  timer: NodeJS.Timeout | null;
}

const isTs = import.meta.url.endsWith(".ts");
const WORKER_URL = new URL(`./convert-worker.${isTs ? "ts" : "js"}`, import.meta.url);
// Worker threads don't honour `--import tsx`; in dev/tests start them through a tiny bootstrap.
const DEV_BOOTSTRAP = new URL("./dev-bootstrap.mjs", import.meta.url);

export class QueueFullError extends Error {}

export class WorkerPool {
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private nextId = 1;
  private closed = false;

  constructor(
    private size: number,
    private timeoutMs: number,
    private maxQueue = 20,
  ) {
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    const worker = new Worker(isTs ? DEV_BOOTSTRAP : WORKER_URL, {
      workerData: isTs ? { entry: WORKER_URL.href } : undefined,
      // 2 workers x 1 GiB heap + capped zip buffers (zipguard) + main process stay well under mem_limit (3g).
      resourceLimits: { maxOldGenerationSizeMb: 1024, stackSizeMb: 32 },
    });
    const slot: Slot = { worker, busy: null, timer: null };
    worker.on("message", (msg: { id: number; result: JobResult }) => {
      const p = slot.busy;
      if (!p || p.id !== msg.id) return;
      this.finish(slot);
      p.resolve(msg.result);
      this.pump();
    });
    const onDeath = (err: Error) => {
      const p = slot.busy;
      this.finish(slot);
      if (p) p.reject(err);
      if (!this.closed) {
        const idx = this.slots.indexOf(slot);
        if (idx >= 0) this.slots[idx] = this.spawn();
        this.pump();
      }
    };
    worker.on("error", onDeath);
    worker.on("exit", (code) => {
      if (slot.busy || code !== 0) onDeath(new Error(`Worker exited with code ${code}`));
    });
    worker.unref();
    return slot;
  }

  private finish(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.busy = null;
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.busy) continue;
      const p = this.queue.shift();
      if (!p) return;
      slot.busy = p;
      slot.timer = setTimeout(() => {
        void slot.worker.terminate();
        // 'exit' handler rejects and respawns
        const pending = slot.busy;
        if (pending) {
          this.finish(slot);
          pending.reject(new Error("Conversion timed out"));
        }
      }, this.timeoutMs);
      slot.worker.postMessage({ id: p.id, job: p.job });
    }
  }

  run(job: Job): Promise<JobResult> {
    if (this.closed) return Promise.reject(new Error("Pool closed"));
    if (this.queue.length >= this.maxQueue) return Promise.reject(new QueueFullError("Server busy"));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, job, resolve, reject });
      this.pump();
    });
  }

  get stats() {
    return { size: this.size, busy: this.slots.filter((s) => s.busy).length, queued: this.queue.length };
  }

  async close() {
    this.closed = true;
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}
