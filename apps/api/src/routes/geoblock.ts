import { FastifyInstance } from "fastify";
import { config } from "../config.js";

/**
 * Geoblock proxy. This forwards the best client IP headers we receive, but
 * upstream geolocation providers may still use this server's network location.
 * Keep any frontend hard gate disabled unless this route is verified in prod.
 *
 * Header priority:
 *   1. x-forwarded-for  (set by CDN / load balancer)
 *   2. x-real-ip        (set by nginx / Vercel edge)
 *   3. req.ip           (Fastify's own extraction, last resort)
 */
export async function geoblockRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/geoblock",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      // Extract real client IP
      const xForwardedFor = req.headers["x-forwarded-for"];
      const clientIp =
        (Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor)
          ?.split(",")[0]
          ?.trim() ??
        req.headers["x-real-ip"]?.toString() ??
        req.ip;

      try {
        const response = await fetch(config.polymarket.geoblockUrl, {
          headers: {
            // Forward the user's IP so Polymarket checks their location
            "X-Forwarded-For": clientIp,
            "X-Real-IP": clientIp,
            "User-Agent": "RawliAnalytic-GeoProxy/1.0",
          },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          req.log.warn({ status: response.status, clientIp }, "Polymarket geoblock returned non-OK");
          // Fail open — don't punish users when upstream is down
          return reply.send({ blocked: false, isRestricted: false, error: "geoblock_upstream_error" });
        }

        const data = await response.json() as Record<string, unknown>;
        return reply.send(data);
      } catch (err) {
        req.log.warn({ err, clientIp }, "Polymarket geoblock check unavailable; failing open");
        return reply.send({ blocked: false, isRestricted: false, error: "geoblock_unavailable" });
      }
    },
  );
}
