/**
 * API smoke test with a synthetic template (no real tax data in the repo).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import ExcelJS from "exceljs";
import { buildApp } from "../src/app.js";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Config } from "../src/config.js";

const ORIGIN = "https://vat.example.test";

async function syntheticTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const server = wb.addWorksheet("Server");
  const db = wb.addWorksheet("DB");
  wb.addWorksheet("Data");
  server.getCell("A1").value = "x";
  db.getCell("A1").value = "FK";
  db.getCell("B1").value = "NAMA";
  db.getCell("A2").value = "LT";
  db.getCell("A3").value = "OF";
  db.getCell("A4").value = "FK";
  db.getCell("B4").value = { formula: 'IF(A4="FK",TRIM(Data!C3),"")' } as ExcelJS.CellFormulaValue;
  db.getCell("C4").value = { formula: "Data!S3" } as ExcelJS.CellFormulaValue;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function syntheticInput(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Combine");
  ws.getCell("A3").value = 1;
  ws.getCell("G3").value = "  ACME   CORP ";
  ws.getCell("K3").value = "INV-1";
  ws.getCell("W3").value = 1000;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer }) {
  const boundary = "----ovat" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("API (Cloudflare Access identity, real JWT verification)", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let jwksServer: Server;
  let team = "";
  let key: CryptoKey;
  let otherKey: CryptoKey;
  const WEB_AUD = "web-aud-test";
  const API_AUD = "api-aud-test";
  const ALLOWED = "me@example.test";

  const sign = (claims: Record<string, unknown>, aud: string, opts: { k?: CryptoKey; exp?: string; iss?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? team)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "10m")
      .sign(opts.k ?? key);

  /** Headers the Netlify edge + Cloudflare would add for this user. */
  async function as(email: string, extra: Record<string, string> = {}) {
    return {
      "cf-access-jwt-assertion": await sign({ common_name: "svc" }, API_AUD),
      "x-user-access-jwt": await sign({ email }, WEB_AUD),
      ...extra,
    };
  }

  before(async () => {
    const kp = await generateKeyPair("RS256", { extractable: true });
    key = kp.privateKey;
    otherKey = (await generateKeyPair("RS256")).privateKey;
    const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    jwksServer = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/cdn-cgi/access/certs" ? { keys: [jwk] } : {}));
    });
    await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", r));
    team = `http://127.0.0.1:${(jwksServer.address() as { port: number }).port}`;

    dir = mkdtempSync(path.join(tmpdir(), "ovat-test-"));
    const cfg: Config = {
      isProd: false,
      host: "127.0.0.1",
      port: 0,
      dataDir: dir,
      appOrigin: ORIGIN,
      encryptionKey: Buffer.alloc(32, 1),
      access: { mode: "enforce", teamDomain: team, apiAud: API_AUD, webAud: WEB_AUD, allowedEmails: [ALLOWED], devUserEmail: "" },
      limits: { inputMb: 5, templateMb: 5, convertTimeoutMs: 60_000, workers: 1 },
    };
    app = await buildApp(cfg, { logger: process.env.OVAT_TEST_LOG === "1" });
  });

  after(async () => {
    await app.close();
    jwksServer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects requests without Cloudflare tokens", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/me" });
    assert.equal(r.statusCode, 403);
  });

  it("identifies an allowed user by their Access email", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/me", headers: await as("ME@example.test") });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().user.email, ALLOWED);
  });

  it("refuses a valid Access user who is not on ALLOWED_EMAILS", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/me", headers: await as("stranger@example.test") });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, "NOT_ALLOWED");
  });

  it("refuses forged, expired, wrong-audience and wrong-issuer tokens", async () => {
    const svc = await sign({}, API_AUD);
    const cases: Record<string, string> = {
      "wrong key": await sign({ email: ALLOWED }, WEB_AUD, { k: otherKey }),
      expired: await sign({ email: ALLOWED }, WEB_AUD, { exp: "-1m" }),
      "service-token audience used as user token": await sign({ email: ALLOWED }, API_AUD),
      "other issuer": await sign({ email: ALLOWED }, WEB_AUD, { iss: "https://evil.cloudflareaccess.com" }),
      "unsigned (alg none)": "eyJhbGciOiJub25lIn0." + Buffer.from(JSON.stringify({ email: ALLOWED, aud: WEB_AUD, iss: team })).toString("base64url") + ".",
    };
    for (const [name, user] of Object.entries(cases)) {
      const r = await app.inject({ method: "GET", url: "/api/auth/me", headers: { "cf-access-jwt-assertion": svc, "x-user-access-jwt": user } });
      assert.equal(r.statusCode, 403, name);
    }
    // A user token can't stand in for the edge (service) token either.
    const swapped = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { "cf-access-jwt-assertion": await sign({ email: ALLOWED }, WEB_AUD), "x-user-access-jwt": await sign({ email: ALLOWED }, WEB_AUD) },
    });
    assert.equal(swapped.statusCode, 403);
  });

  it("rejects cross-origin state changes", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/settings", headers: await as(ALLOWED, { origin: "https://evil.example" }), payload: { useReferenceNumber: true } });
    assert.equal(r.statusCode, 403);
    const ok = await app.inject({ method: "PUT", url: "/api/settings", headers: await as(ALLOWED, { origin: ORIGIN }), payload: { useReferenceNumber: false } });
    assert.equal(ok.statusCode, 200);
  });

  it("has no password login any more", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: await as(ALLOWED, { origin: ORIGIN }), payload: { username: "x", password: "y" } });
    assert.equal(r.statusCode, 404);
  });

  it("uploads a template, converts, and downloads the CSV", async () => {
    const h = await as(ALLOWED, { origin: ORIGIN });
    const t = multipart({ name: "Synthetic" }, { name: "t.xlsx", data: await syntheticTemplate() });
    const up = await app.inject({ method: "POST", url: "/api/templates", headers: { ...t.headers, ...h }, payload: t.payload });
    assert.equal(up.statusCode, 201, up.body);
    assert.equal(up.json().template.isDefault, true);

    const c = multipart({}, { name: "KK PPN 9901(CT).xlsx", data: await syntheticInput() });
    const conv = await app.inject({ method: "POST", url: "/api/conversions", headers: { ...c.headers, ...h }, payload: c.payload });
    assert.equal(conv.statusCode, 201, conv.body);
    const { conversion } = conv.json();
    assert.equal(conversion.outputName, "KK PPN 9901(CT).csv");
    assert.equal(conversion.invoices, 1);

    const dl = await app.inject({ method: "GET", url: `/api/conversions/${conversion.id}/csv`, headers: await as(ALLOWED) });
    assert.equal(dl.statusCode, 200);
    assert.match(String(dl.headers["content-disposition"]), /filename\*=UTF-8''KK%20PPN%209901\(CT\)\.csv/);
    assert.equal(dl.body.split("\n")[3], "FK;ACME CORP;1000;;;;;;;;;;;;;;;;;;");
  });

  it("refuses a template that uses an unsupported function", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Server");
    const db = wb.addWorksheet("DB");
    wb.addWorksheet("Data");
    db.getCell("A4").value = { formula: "VLOOKUP(1,Data!A:B,2,FALSE)" } as ExcelJS.CellFormulaValue;
    const t = multipart({}, { name: "bad.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
    const r = await app.inject({ method: "POST", url: "/api/templates", headers: { ...t.headers, ...(await as(ALLOWED, { origin: ORIGIN })) }, payload: t.payload });
    assert.equal(r.statusCode, 422);
    assert.match(r.json().error, /VLOOKUP/);
  });

  it("rejects non-xlsx uploads", async () => {
    const t = multipart({}, { name: "evil.xlsx", data: Buffer.from("not a zip") });
    const r = await app.inject({ method: "POST", url: "/api/conversions", headers: { ...t.headers, ...(await as(ALLOWED, { origin: ORIGIN })) }, payload: t.payload });
    assert.equal(r.statusCode, 415);
  });

  it("stores files encrypted at rest", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const files = readdirSync(path.join(dir, "files", "conversions"));
    assert.ok(files.length >= 3);
    for (const f of files) {
      const buf = readFileSync(path.join(dir, "files", "conversions", f));
      assert.equal(buf.subarray(0, 4).toString(), "OVE1");
      assert.ok(!buf.includes(Buffer.from("ACME")));
    }
  });
});
