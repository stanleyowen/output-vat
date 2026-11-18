/**
 * Encrypted file storage. Every stored file (templates, inputs, outputs) is
 * AES-256-GCM encrypted with a per-file random IV; the file id is bound as AAD
 * so ciphertexts can't be swapped between records.
 *
 * Layout: <dataDir>/files/<kind>/<id>.<part>.bin  =  "OVE1" | iv(12) | tag(16) | ciphertext
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";

const MAGIC = Buffer.from("OVE1");

export type FileKind = "templates" | "conversions";

export class EncryptedStore {
  constructor(
    private root: string,
    private key: Buffer,
  ) {}

  private file(kind: FileKind, id: string, part: string): string {
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(id) || !/^[a-z]{1,16}$/.test(part)) throw new Error("Bad storage id");
    return path.join(this.root, "files", kind, `${id}.${part}.bin`);
  }

  async put(kind: FileKind, id: string, part: string, data: Buffer): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${kind}/${id}/${part}`));
    const ct = Buffer.concat([cipher.update(data), cipher.final()]);
    const out = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
    const dest = this.file(kind, id, part);
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    const tmp = `${dest}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, out, { mode: 0o600 });
    await rename(tmp, dest);
  }

  async get(kind: FileKind, id: string, part: string): Promise<Buffer> {
    const buf = await readFile(this.file(kind, id, part));
    if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("Corrupt stored file");
    const iv = buf.subarray(4, 16);
    const tag = buf.subarray(16, 32);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(`${kind}/${id}/${part}`));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]);
  }

  async remove(kind: FileKind, id: string, parts: string[]): Promise<void> {
    await Promise.all(parts.map((p) => rm(this.file(kind, id, p), { force: true })));
  }
}
