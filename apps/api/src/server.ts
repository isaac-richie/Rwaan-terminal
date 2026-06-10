import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
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
import { referralRoutes } from "./routes/referral.js";
import { opsRoutes } from "./routes/ops.js";
import { edgeScannerRoutes } from "./routes/edgeScanner.js";
import { rwaRoutes } from "./routes/rwa.js";
import { recordBackendError } from "./services/errorLog.js";

type ApiError = Error & {
  code?: string;
  statusCode?: number;
  error?: string;
  message?: string;
  retryAfter?: string;
};

export function buildServer() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
  });
  const loggedErrorRequests = new Set<string>();

  // Global rate limiting — production baseline, mainly to stop hammering.
  // `trustProxy` is required behind Caddy so different users do not share
  // the same 127.0.0.1 rate-limit bucket.
  app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    // Premium / analysis routes get tighter limits set per-route
    errorResponseBuilder: (_req, context) => ({
      statusCode: context.statusCode ?? 429,
      ok: false,
      error: "rate_limited",
      message: `Too many requests. Please wait ${context.after} and try again.`,
      retryAfter: context.after,
    }),
  });

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
  app.register(referralRoutes);
  app.register(opsRoutes);
  app.register(edgeScannerRoutes);
  app.register(rwaRoutes);

  app.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode < 500) return;
    if (loggedErrorRequests.delete(String(req.id))) return;
    recordBackendError({
      level: "error",
      message: `HTTP ${reply.statusCode}`,
      statusCode: reply.statusCode,
      method: req.method,
      url: req.url,
      ip: req.ip,
      requestId: req.id,
    });
  });

  app.setErrorHandler((err: ApiError, req, reply) => {
    const isRateLimited =
      err.statusCode === 429 ||
      err.code === "FST_ERR_RATE_LIMIT" ||
      err.error === "rate_limited";
    const statusCode = isRateLimited ? 429 : err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    const isServerError = statusCode >= 500;
    const publicError = isRateLimited
      ? "rate_limited"
      : isServerError
        ? "internal_error"
        : (err.code ?? err.error ?? "request_error");
    const publicMessage = isServerError
      ? undefined
      : err.message || (isRateLimited ? "Too many requests. Please wait a few seconds and try again." : undefined);
    const event = recordBackendError({
      level: isServerError ? "error" : "warn",
      message: err.message || publicError,
      code: err.code,
      statusCode,
      method: req.method,
      url: req.url,
      ip: req.ip,
      requestId: req.id,
      stack: isServerError ? err.stack : undefined,
    });
    loggedErrorRequests.add(String(req.id));

    app.log[isServerError ? "error" : "warn"]({ err, errorEventId: event.id }, "Request failed");
    reply.status(statusCode).send({
      ok: false,
      error: publicError,
      message: publicMessage,
      retryAfter: err.retryAfter,
      errorId: event.id,
    });
  });

  return app;
}
