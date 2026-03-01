/**
 * Express server - HTTP MCP for n8n
 * NO LLM - knowledge + optional apply
 */

import express from "express";
import mcpRoutes from "./routes/mcp.js";

const app = express();
app.use(express.json());
app.use("/", mcpRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

export default app;
