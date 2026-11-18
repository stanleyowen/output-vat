/**
 * Cloudflare Access verification — the app's only sign-in.
 *
 * Two signed JWTs are required on every request when ACCESS_MODE=enforce:
 *  1. `Cf-Access-Jwt-Assertion` — added by Cloudflare on the API hostname after the
 *     Netlify edge proxy authenticated with the service token. Proves the request
 *     really came through Cloudflare Access (not straight to the tunnel/origin).
 *  2. `X-User-Access-Jwt` — the end user's Access token from the web hostname,
 *     forwarded by the edge proxy. Proves a human passed the Access login; its
 *     email must be on ALLOWED_EMAILS and becomes the user's identity.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Config } from "../config.js";

export interface AccessIdentity {
  email: string;
}

export class AccessError extends Error {}

export function createAccessVerifier(cfg: Config["access"]) {
  if (cfg.mode === "off") {
    return async (): Promise<AccessIdentity> => ({ email: cfg.devUserEmail });
  }
  const jwks = createRemoteJWKSet(new URL(`${cfg.teamDomain}/cdn-cgi/access/certs`), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  });
  const verify = async (token: string, aud: string): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: cfg.teamDomain,
      audience: aud,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });
    return payload;
  };

  return async (headers: Record<string, string | string[] | undefined>): Promise<AccessIdentity> => {
    const h = (n: string) => {
      const v = headers[n];
      return Array.isArray(v) ? v[0] : v;
    };
    const edge = h("cf-access-jwt-assertion");
    const user = h("x-user-access-jwt");
    if (!edge) throw new AccessError("Missing Cloudflare Access assertion");
    if (!user) throw new AccessError("Missing user Access token");
    try {
      await verify(edge, cfg.apiAud);
    } catch {
      throw new AccessError("Invalid Cloudflare Access assertion");
    }
    let payload: JWTPayload;
    try {
      payload = await verify(user, cfg.webAud);
    } catch {
      throw new AccessError("Invalid user Access token");
    }
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email) throw new AccessError("User Access token has no email");
    if (!cfg.allowedEmails.includes(email)) {
      throw new AccessError("User is not allowed");
    }
    return { email };
  };
}
