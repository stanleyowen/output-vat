import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { AccessError, createAccessVerifier, type AccessIdentity } from "./auth/access.js";
import { ensureUser, type AppUser } from "./auth/identity.js";
import type { Config } from "./config.js";
import { openDb, type DB } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { conversionRoutes } from "./routes/conversions.js";
import { settingsRoutes } from "./routes/settings.js";
import { templateRoutes } from "./routes/templates.js";
import { EncryptedStore } from "./storage.js";
import { WorkerPool } from "./worker/pool.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AppUser | null;
    access: AccessIdentity;
    clientIp: string;
  }
  interface FastifyInstance {
    cfg: Config;
    db: DB;
    store: EncryptedStore;
    pool: WorkerPool;
  }
}

export async function buildApp(cfg: Config, opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: cfg.isProd ? "info" : "debug",
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                'req.headers["cf-access-jwt-assertion"]',
                'req.headers["x-user-access-jwt"]',
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },
          },
    bodyLimit: 64 * 1024,
    trustProxy: false,
    // Request IDs are random, never derived from client headers.
    genReqId: () => crypto.randomUUID(),
  });

  const db = openDb(cfg.dataDir);
  const store = new EncryptedStore(cfg.dataDir, cfg.encryptionKey);
  const pool = new WorkerPool(cfg.limits.workers, cfg.limits.convertTimeoutMs);
  app.decorate("cfg", cfg);
  app.decorate("db", db);
  app.decorate("store", store);
  app.decorate("pool", pool);
  app.decorateRequest("user", null);
  app.decorateRequest("access", null as unknown as AccessIdentity);
  app.decorateRequest("clientIp", "");

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.clientIp || req.ip,
  });
  await app.register(multipart, {
    limits: {
      fileSize: Math.max(cfg.limits.inputMb, cfg.limits.templateMb) * 1024 * 1024,
      files: 1,
      fields: 8,
      parts: 10,
      fieldSize: 1024,
    },
  });

  const verifyAccess = createAccessVerifier(cfg.access);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Real client IP: forwarded by the Netlify edge proxy (which got it from Cloudflare).
    const fwd = req.headers["x-client-ip"] ?? req.headers["cf-connecting-ip"];
    req.clientIp = (Array.isArray(fwd) ? fwd[0] : fwd)?.slice(0, 64) || req.ip;
    reply.header("cache-control", "no-store");

    if (!req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });

    // Liveness for the container healthcheck (no data, local only).
    if (req.url === "/api/health" && req.method === "GET") return;

    try {
      req.access = await verifyAccess(req.headers);
    } catch (e) {
      if (e instanceof AccessError) {
        req.log.warn({ reason: e.message }, "access denied");
        if (e.message === "User is not allowed") {
          return reply.code(403).send({ error: "This account isn't allowed to use VAT.", code: "NOT_ALLOWED" });
        }
        return reply.code(403).send({ error: "Forbidden" });
      }
      throw e;
    }

    // CSRF: state-changing requests must come from the app's own origin.
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin !== cfg.appOrigin) {
        req.log.warn({ origin }, "origin rejected");
        return reply.code(403).send({ error: "Bad origin" });
      }
    }

    // Identity = the verified, allow-listed Cloudflare Access email. No app passwords or sessions.
    req.user = ensureUser(db, req.access.email);
  });

  app.setErrorHandler((err: Error, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    const code = (err as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: "File is too large." });
    reply.code(status).send({ error: status >= 500 ? "Internal error" : err.message });
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(settingsRoutes);
  await app.register(templateRoutes);
  await app.register(conversionRoutes);

  app.addHook("onClose", async () => {
    await pool.close();
    db.close();
  });

  return app;
}
