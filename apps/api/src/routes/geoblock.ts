import { FastifyInstance } from "fastify";
import { getGeoblockStatus } from "../services/polymarket.js";

export async function geoblockRoutes(app: FastifyInstance): Promise<void> {
  app.get("/geoblock", async (req) => {
    // Note: This checks the server's IP, not the end user's IP.
    // For strict compliance, call Polymarket geoblock from the client or edge.
    try {
      return await getGeoblockStatus();
    } catch (err) {
      req.log.warn({ err }, "Polymarket geoblock check unavailable; failing open");
      return {
        blocked: false,
        isRestricted: false,
        error: "geoblock_unavailable"
      };
    }
  });
}
