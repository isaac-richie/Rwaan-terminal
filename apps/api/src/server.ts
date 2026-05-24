import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { analysisRoutes } from "./routes/analysis.js";
import { bridgeRoutes } from "./routes/bridge.js";
import { clobRoutes } from "./routes/clob.js";
import { gammaRoutes } from "./routes/gamma.js";
import { geoblockRoutes } from "./routes/geoblock.js";
import { fundingRoutes } from "./routes/funding.js";
import { gasAssistRoutes } from "./routes/gasAssist.js";
import { depositWalletRoutes } from "./routes/depositWallet.js";
import { healthRoutes } from "./routes/health.js";
import { kalshiRoutes } from "./routes/kalshi.js";
import { orderRoutes } from "./routes/orders.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { pointsRoutes } from "./routes/points.js";
import { tradePreviewRoutes } from "./routes/tradePreview.js";
import { tradeReadinessRoutes } from "./routes/tradeReadiness.js";
import { tradingProfileRoutes } from "./routes/tradingProfiles.js";
import { wsRoutes } from "./routes/ws.js";
import { catalystRoutes } from "./routes/catalyst.js";
import { cryptoRoutes } from "./routes/crypto.js";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "PAYMENT-SIGNATURE",
      "X-PAYMENT",
      "payment-signature",
      "x-payment",
      "Access-Control-Expose-Headers",
      "access-control-expose-headers",
      "POLY_ADDRESS",
      "POLY_SIGNATURE",
      "POLY_TIMESTAMP",
      "POLY_API_KEY",
      "POLY_PASSPHRASE",
      "poly_address",
      "poly_signature",
      "poly_timestamp",
      "poly_api_key",
      "poly_passphrase"
    ],
    exposedHeaders: [
      "PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "X-PAYMENT-REQUIRED",
      "X-PAYMENT-RESPONSE",
      "payment-required",
      "payment-response",
      "x-payment-required",
      "x-payment-response"
    ]
  });
  app.register(websocket);

  app.register(healthRoutes);
  app.register(kalshiRoutes);
  app.register(analysisRoutes);
  app.register(geoblockRoutes);
  app.register(bridgeRoutes);
  app.register(fundingRoutes);
  app.register(gasAssistRoutes);
  app.register(depositWalletRoutes);
  app.register(gammaRoutes);
  app.register(clobRoutes);
  app.register(orderRoutes);
  app.register(portfolioRoutes);
  app.register(pointsRoutes);
  app.register(tradePreviewRoutes);
  app.register(tradeReadinessRoutes);
  app.register(tradingProfileRoutes);
  app.register(wsRoutes);
  app.register(catalystRoutes);
  app.register(cryptoRoutes);

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    reply.status(500).send({ error: "internal_error" });
  });

  return app;
}
