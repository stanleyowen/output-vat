import type { FastifyInstance } from "fastify";

/** Sign-in and sign-out are handled entirely by Cloudflare Access. */
export async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/me", async (req) => ({ user: { email: req.user!.email } }));
}
