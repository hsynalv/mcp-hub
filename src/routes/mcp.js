/**
 * HTTP MCP endpoints - Tools & Resources
 * NO LLM - knowledge + optional apply
 */

import { Router } from "express";
import {
  getAllTools,
  getAllResources,
  callTool,
  readResource,
} from "../plugins/registry.js";

const router = Router();

// --- Tools ---
// GET /tools - List all tools
router.get("/tools", (req, res) => {
  const tools = getAllTools().map(({ plugin, ...t }) => t);
  res.json({ tools });
});

// POST /tools/call - Call a tool
router.post("/tools/call", async (req, res) => {
  try {
    const { name, arguments: args = {} } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Missing tool name" });
    }
    const result = await callTool(name, args);
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Resources ---
// GET /resources - List all resources
router.get("/resources", (req, res) => {
  const resources = getAllResources().map(({ plugin, ...r }) => r);
  res.json({ resources });
});

// GET /resources/read?uri=... - Read a resource
router.get("/resources/read", async (req, res) => {
  try {
    const { uri } = req.query;
    if (!uri) {
      return res.status(400).json({ error: "Missing uri query parameter" });
    }
    const { content, mimeType } = await readResource(uri);
    res.set("Content-Type", mimeType || "application/json");
    res.send(content);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// POST /resources/read - Read resource (body)
router.post("/resources/read", async (req, res) => {
  try {
    const { uri } = req.body || {};
    if (!uri) {
      return res.status(400).json({ error: "Missing uri in body" });
    }
    const { content, mimeType } = await readResource(uri);
    res.set("Content-Type", mimeType || "application/json");
    res.send(content);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// --- Health ---
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "n8n-mcp",
    writeEnabled: process.env.ALLOW_N8N_WRITE === "true",
  });
});

export default router;
