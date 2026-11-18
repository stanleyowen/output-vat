/**
 * Same-origin API proxy: browser -> https://<app>/api/* -> this edge function
 * -> https://<api-host>/api/* (Cloudflare Tunnel to the Ubuntu server).
 *
 * The service token is only attached after proving the request came through
 * Cloudflare Access on the web hostname:
 *  1. EDGE_SHARED_SECRET (optional, enforced once set) — a header that only a
 *     Cloudflare Transform Rule on the web hostname injects. Requests sent straight
 *     to Netlify (netlify.app URL, forged Host header, pinned DNS) don't have it.
 *  2. The user's Access JWT (Cf-Access-Jwt-Assertion) is signature-verified here
 *     (issuer, audience, RS256) — the API verifies it again.
 * No cookies are forwarded in either direction: identity is the verified Access JWT.
 */
import type { Config, Context } from "@netlify/edge-functions";
import { createRemoteJWKSet, jwtVerify } from "jose";

const REQUEST_HEADERS = ["accept", "content-type", "content-length", "origin"];
const RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "x-content-type-options",
  "content-security-policy",
  "x-frame-options",
  "cross-origin-resource-policy",
  "referrer-policy",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const env = (k: string) => Netlify.env.get(k);
  const apiOrigin = env("API_ORIGIN");
  const allowedHost = env("ALLOWED_HOST");
  const clientId = env("CF_ACCESS_CLIENT_ID");
  const clientSecret = env("CF_ACCESS_CLIENT_SECRET");
  const edgeSecret = env("EDGE_SHARED_SECRET");
  const teamDomain = env("CF_ACCESS_TEAM_DOMAIN");
  const webAud = env("CF_ACCESS_WEB_AUD");
  if (!apiOrigin || !allowedHost || !clientId || !clientSecret || !teamDomain || !webAud) {
    return json(500, "Proxy is not configured.");
  }

  // 1. Must have come through Cloudflare (header injected by a Transform Rule), once configured.
  const url = new URL(req.url);
  const presented = req.headers.get("x-ovat-edge") ?? "";
  if (url.host !== allowedHost || (edgeSecret && !safeEqual(presented, edgeSecret))) {
    return new Response("Not found", { status: 404 });
  }

  // 2. Must carry a valid Cloudflare Access user token for the web app.
  const userJwt = req.headers.get("cf-access-jwt-assertion");
  if (!userJwt) return json(403, "Access denied. Reload the page to sign in with Cloudflare Access.");
  try {
    jwks ??= createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    await jwtVerify(userJwt, jwks, { issuer: teamDomain, audience: webAud, algorithms: ["RS256"], clockTolerance: 30 });
  } catch {
    return json(403, "Access denied. Reload the page to sign in with Cloudflare Access.");
  }

  const headers = new Headers();
  for (const h of REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v !== null) headers.set(h, v);
  }
  headers.set("x-user-access-jwt", userJwt);
  // Trustworthy now: the request provably came through Cloudflare.
  headers.set("x-client-ip", req.headers.get("cf-connecting-ip") ?? context.ip);
  headers.set("cf-access-client-id", clientId);
  headers.set("cf-access-client-secret", clientSecret);

  const target = new URL(url.pathname + url.search, apiOrigin);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      // @ts-expect-error -- required by fetch for streaming request bodies
      duplex: hasBody ? "half" : undefined,
    });
  } catch {
    return json(502, "The server is unreachable right now. Please try again shortly.");
  }

  // A redirect here means Cloudflare Access on the API host rejected the service token.
  if (upstream.status >= 300 && upstream.status < 400) return json(502, "API gateway authentication failed.");

  const out = new Headers();
  for (const h of RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v !== null) out.set(h, v);
  }
  out.set("cache-control", upstream.headers.get("cache-control") ?? "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
};

export const config: Config = { path: "/api/*" };
