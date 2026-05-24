import "dotenv/config";
import { buildServer } from "./server.js";
import { config } from "./config.js";
import { runLegacyMigration } from "./services/tradingProfiles.js";

const app = buildServer();

// Migrate any existing profiles from the legacy JSON flat-file to SQLite before
// accepting traffic. This is idempotent — safe to run on every boot.
runLegacyMigration((msg) => app.log.info(msg)).catch((err) => {
  app.log.warn({ err }, "Legacy profile migration failed — continuing without migration");
});

app.listen({ port: config.port, host: config.host })
  .then(() => {
    app.log.info(`API listening on ${config.host}:${config.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
