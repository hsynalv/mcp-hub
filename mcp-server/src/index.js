import { config } from "./core/config.js";
import { createServer } from "./core/server.js";

process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] unhandledRejection:", reason);
});

const app = await createServer();

app.listen(config.port, () => {
  console.log(`mcp-server listening on http://localhost:${config.port}`);
});
