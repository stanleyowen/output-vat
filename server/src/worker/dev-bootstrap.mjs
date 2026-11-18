// Dev/test only: lets a worker thread load the TypeScript worker via tsx.
import { workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";
register();
await import(workerData.entry);
