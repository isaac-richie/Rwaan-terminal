import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getGasAssistStatus, sendGasAssist } from "../services/gasAssist.js";

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const statusQuerySchema = z.object({
  address: evmAddressSchema,
});

const requestSchema = z.object({
  address: evmAddressSchema,
  reason: z.string().max(80).optional(),
});

export async function gasAssistRoutes(app: FastifyInstance): Promise<void> {
  app.get("/gas-assist/status", async (req, reply) => {
    const parsed = statusQuerySchema.safeParse(req.query ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_gas_assist_status_query", issues: parsed.error.issues };
    }

    return getGasAssistStatus(parsed.data.address);
  });

  app.post("/gas-assist/request", async (req, reply) => {
    const parsed = requestSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_gas_assist_payload", issues: parsed.error.issues };
    }

    try {
      return await sendGasAssist(parsed.data.address, parsed.data.reason);
    } catch (err) {
      req.log.error({ err }, "Polygon gas assist failed");
      reply.status(502);
      return { ok: false, error: "gas_assist_failed" };
    }
  });
}
