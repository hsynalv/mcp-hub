/**
 * Tests Plugin
 *
 * Run tests, lint, and check coverage for projects.
 */

import { Router } from "express";
import { runTests, runLint, getCoverage } from "./tests.core.js";
import { ToolTags } from "../../core/tool-registry.js";

export const name = "tests";
export const version = "1.0.0";
export const description = "Test runner and lint integration";
export const capabilities = ["read"];
export const requires = [];

export const endpoints = [
  { method: "POST", path: "/tests/run", description: "Run tests", scope: "read" },
  { method: "POST", path: "/tests/lint", description: "Run linter", scope: "read" },
  { method: "GET", path: "/tests/coverage", description: "Get test coverage", scope: "read" },
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "tests_run",
    description: "Run project tests (vitest, jest, mocha)",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project path", default: "." },
        pattern: { type: "string", description: "Test file pattern" },
        watch: { type: "boolean", description: "Watch mode", default: false },
      },
    },
    handler: async (args) => runTests(args.path || ".", { pattern: args.pattern, watch: args.watch }),
  },
  {
    name: "tests_lint",
    description: "Run linter (eslint, prettier)",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project path", default: "." },
        linter: { type: "string", enum: ["eslint", "prettier"], default: "eslint" },
      },
    },
    handler: async (args) => runLint(args.path || ".", { linter: args.linter }),
  },
  {
    name: "tests_coverage",
    description: "Get test coverage report",
    tags: [ToolTags.READ, ToolTags.LOCAL_FS, ToolTags.BULK],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project path", default: "." },
      },
    },
    handler: async (args) => getCoverage(args.path || "."),
  },
];

// ── REST Routes ───────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // POST /tests/run { path, pattern, watch }
  router.post("/run", async (req, res) => {
    const { path, pattern, watch } = req.body;
    const result = await runTests(path || ".", { pattern, watch: watch === true });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // POST /tests/lint { path, linter }
  router.post("/lint", async (req, res) => {
    const { path, linter } = req.body;
    const result = await runLint(path || ".", { linter });
    res.status(result.ok ? 200 : 400).json(result);
  });

  // GET /tests/coverage?path=...
  router.get("/coverage", async (req, res) => {
    const result = await getCoverage(req.query.path || ".");
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.use("/tests", router);
}
