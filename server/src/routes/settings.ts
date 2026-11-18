import type { FastifyInstance } from "fastify";
import { audit, getSetting, setSetting } from "../db.js";

export interface AppSettings {
  useReferenceNumber: boolean;
}

export function readSettings(app: FastifyInstance): AppSettings {
  return { useReferenceNumber: getSetting(app.db, "useReferenceNumber", false) };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", async () => readSettings(app));

  app.put(
    "/api/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { useReferenceNumber: { type: "boolean" } },
        },
      },
    },
    async (req) => {
      const body = req.body as Partial<AppSettings>;
      if (typeof body.useReferenceNumber === "boolean") setSetting(app.db, "useReferenceNumber", body.useReferenceNumber);
      audit(app.db, { userId: req.user!.id, action: "settings.updated", detail: body, ip: req.clientIp, actor: req.access.email });
      return readSettings(app);
    },
  );
}
