import { FastifyInstance } from "fastify";
import { readBackendErrorLogTail, recentBackendErrors } from "../services/errorLog.js";

function hasOpsAccess(authHeader: string | undefined) {
  const token = process.env.OPS_TOKEN?.trim();
  if (!token) return false;
  return authHeader === `Bearer ${token}`;
}

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ops/errors/recent", async (req, reply) => {
    if (!hasOpsAccess(req.headers.authorization)) {
      reply.status(404);
      return { ok: false, error: "not_found" };
    }

    const query = req.query as { limit?: string; includeDisk?: string };
    const limit = Math.max(1, Math.min(100, Number(query.limit ?? 50) || 50));
    const memory = recentBackendErrors(limit);
    const errors = query.includeDisk === "true" && memory.length < limit
      ? [...memory, ...(await readBackendErrorLogTail(limit - memory.length))]
      : memory;

    return {
      ok: true,
      count: errors.length,
      errors: errors.slice(0, limit),
    };
  });
}
