import "dotenv/config";
import { buildServer } from "./server.js";
import { config } from "./config.js";
import { runLegacyMigration } from "./services/tradingProfiles.js";
import { checkRpcHealth } from "./services/payment.js";

const app = buildServer();

// Migrate any existing profiles from the legacy JSON flat-file to SQLite before
// accepting traffic. This is idempotent — safe to run on every boot.
runLegacyMigration((msg) => app.log.info(msg)).catch((err) => {
  app.log.warn({ err }, "Legacy profile migration failed — continuing without migration");
});

// Run BSC RPC health check in background — promotes fastest endpoint as preferred.
// Non-blocking: API still starts even if all RPCs are temporarily unreachable.
checkRpcHealth().catch((err) => {
  app.log.warn({ err }, "BSC RPC health check failed — will use fallback chain on demand");
});

app.listen({ port: config.port, host: config.host })
  .then(() => {
    app.log.info(`API listening on ${config.host}:${config.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
