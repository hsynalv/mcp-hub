import { config } from "./core/config.js";
import { createServer } from "./core/server.js";

const app = await createServer();

app.listen(config.port, () => {
  console.log(`mcp-server listening on http://localhost:${config.port}`);
});
