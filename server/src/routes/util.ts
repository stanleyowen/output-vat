import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply, FastifyRequest } from "fastify";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface Upload {
  fileName: string;
  data: Buffer;
  fields: Record<string, string>;
}

/** Read a single-.xlsx multipart upload with size and type checks. */
export async function readXlsxUpload(req: FastifyRequest, maxMb: number): Promise<Upload> {
  if (!req.isMultipart()) throw new HttpError(415, "Expected multipart/form-data.");
  const fields: Record<string, string> = {};
  let file: MultipartFile | undefined;
  let data: Buffer | undefined;
  for await (const part of req.parts({ limits: { fileSize: maxMb * 1024 * 1024 } })) {
    if (part.type === "file") {
      if (file) throw new HttpError(400, "Only one file may be uploaded.");
      file = part;
      data = await part.toBuffer();
      if (part.file.truncated) throw new HttpError(413, `File is larger than ${maxMb} MB.`);
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  if (!file || !data) throw new HttpError(400, "No file uploaded.");
  const fileName = sanitizeFileName(file.filename);
  if (!/\.xlsx$/i.test(fileName)) throw new HttpError(415, "Only .xlsx files are accepted.");
  if (data.length < 4 || !data.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new HttpError(415, "The file is not a valid .xlsx workbook.");
  }
  return { fileName, data, fields };
}

export function sanitizeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim().slice(0, 180);
  return clean || "file.xlsx";
}

export function sendDownload(reply: FastifyReply, fileName: string, contentType: string, body: Buffer | string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  reply
    .header("content-type", contentType)
    .header("content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    .header("x-content-type-options", "nosniff");
  return reply.send(body);
}

export const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
export const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: UUID_RE } },
} as const;
