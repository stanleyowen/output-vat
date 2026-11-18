import { readFileSync } from "node:fs";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/** Read a secret from NAME or from the file named by NAME_FILE (Docker secrets). */
function secret(name: string, fallback?: string): string {
  const file = process.env[`${name}_FILE`];
  if (file) return readFileSync(file, "utf8").trim();
  return env(name, fallback);
}

const isProd = process.env.NODE_ENV === "production";

/** A finite number within [min, max]; anything else is a startup error (NaN would silently disable limits). */
function num(name: string, fallback: string, min: number, max: number): number {
  const v = Number(env(name, fallback));
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return v;
}

export type AccessMode = "enforce" | "off";

export interface Config {
  isProd: boolean;
  host: string;
  port: number;
  dataDir: string;
  /** Exact origin the browser app is served from (used for Origin/CSRF checks). */
  appOrigin: string;
  /** 32-byte key for encrypting stored files (AES-256-GCM). */
  encryptionKey: Buffer;
  access: {
    mode: AccessMode;
    teamDomain: string; // e.g. https://<team>.cloudflareaccess.com
    /** AUD tag of the Access app protecting the API hostname (service-token policy). */
    apiAud: string;
    /** AUD tag of the Access app protecting the web hostname (user login). */
    webAud: string;
    /** Server-side allow-list of user emails (lower-case). Required when enforcing. */
    allowedEmails: string[];
    /** Identity used when ACCESS_MODE=off (local development only). */
    devUserEmail: string;
  };
  limits: { inputMb: number; templateMb: number; convertTimeoutMs: number; workers: number };
}

export function loadConfig(): Config {
  const keyB64 = secret("DATA_ENCRYPTION_KEY", isProd ? undefined : Buffer.alloc(32, 7).toString("base64"));
  const encryptionKey = Buffer.from(keyB64, "base64");
  if (encryptionKey.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");

  const mode = (process.env.ACCESS_MODE ?? (isProd ? "enforce" : "off")) as AccessMode;
  if (mode !== "enforce" && mode !== "off") throw new Error("ACCESS_MODE must be 'enforce' or 'off'");
  if (isProd && mode !== "enforce" && process.env.ALLOW_INSECURE_ACCESS_OFF !== "1") {
    throw new Error("Refusing to start in production with ACCESS_MODE=off");
  }

  const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (mode === "enforce" && allowedEmails.length === 0) {
    throw new Error("ALLOWED_EMAILS must list at least one email when ACCESS_MODE=enforce");
  }

  return {
    isProd,
    host: env("HOST", "0.0.0.0"),
    port: num("PORT", "8080", 1, 65535),
    dataDir: env("DATA_DIR", "./data"),
    appOrigin: env("APP_ORIGIN", "http://localhost:5173"),
    encryptionKey,
    access: {
      mode,
      teamDomain: mode === "enforce" ? env("CF_ACCESS_TEAM_DOMAIN").replace(/\/$/, "") : "",
      apiAud: mode === "enforce" ? env("CF_ACCESS_API_AUD") : "",
      webAud: mode === "enforce" ? env("CF_ACCESS_WEB_AUD") : "",
      allowedEmails,
      devUserEmail: env("DEV_USER_EMAIL", "dev@localhost").toLowerCase(),
    },
    limits: {
      inputMb: num("MAX_INPUT_MB", "25", 1, 100),
      templateMb: num("MAX_TEMPLATE_MB", "25", 1, 100),
      convertTimeoutMs: num("CONVERT_TIMEOUT_MS", "90000", 5000, 600000),
      workers: Math.trunc(num("CONVERT_WORKERS", "2", 1, 8)),
    },
  };
}
