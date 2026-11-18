/**
 * Zip-bomb guard for uploaded .xlsx files.
 *
 * exceljs (via JSZip) inflates entries into Node Buffers, which live outside the
 * V8 heap, so worker `resourceLimits` don't bound them: a 1 MB upload can inflate
 * to many GB and OOM-kill the container. Before exceljs sees a file we walk the
 * zip central directory and actually inflate every entry with a hard output cap,
 * so declared sizes can't lie. Real templates inflate to ~25 MB.
 */
import { inflateRawSync } from "node:zlib";

export class UnsafeZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeZipError";
  }
}

export interface ZipLimits {
  maxTotalBytes: number;
  maxEntries: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxTotalBytes: 250 * 1024 * 1024, maxEntries: 5000 };

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function assertSafeZip(buf: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): { entries: number; inflated: number } {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: last 22..(22+65535) bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new UnsafeZipError("The file is not a valid .xlsx workbook.");
  const count = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOffset = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new UnsafeZipError("ZIP64 workbooks are not supported.");
  if (count > limits.maxEntries) throw new UnsafeZipError("The workbook contains too many parts.");
  if (cdOffset + cdSize > b.length) throw new UnsafeZipError("The file is not a valid .xlsx workbook.");

  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== CEN_SIG) throw new UnsafeZipError("The file is not a valid .xlsx workbook.");
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const compSize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const localOff = b.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new UnsafeZipError("Encrypted workbooks are not supported.");
    if (localOff + 30 > b.length || b.readUInt32LE(localOff) !== LOC_SIG) {
      throw new UnsafeZipError("The file is not a valid .xlsx workbook.");
    }
    const dataStart = localOff + 30 + b.readUInt16LE(localOff + 26) + b.readUInt16LE(localOff + 28);
    if (dataStart + compSize > b.length) throw new UnsafeZipError("The file is not a valid .xlsx workbook.");
    const data = b.subarray(dataStart, dataStart + compSize);

    const budget = limits.maxTotalBytes - total;
    let size: number;
    if (method === 0) {
      size = compSize;
    } else if (method === 8) {
      try {
        // maxOutputLength makes zlib stop (RangeError) instead of allocating past the budget.
        size = inflateRawSync(data, { maxOutputLength: Math.max(1, budget + 1) }).length;
      } catch (e) {
        if (e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw new UnsafeZipError("The workbook is too large when uncompressed.");
        }
        throw new UnsafeZipError("The file is not a valid .xlsx workbook.");
      }
    } else {
      throw new UnsafeZipError("The workbook uses an unsupported compression method.");
    }
    total += size;
    if (total > limits.maxTotalBytes) throw new UnsafeZipError("The workbook is too large when uncompressed.");
  }
  return { entries: count, inflated: total };
}
