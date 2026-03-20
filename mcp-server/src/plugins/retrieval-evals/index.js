/**
 * Retrieval Evaluation Plugin
 *
 * Measures and compares RAG retrieval quality across strategies.
 */

import { Router } from "express";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";
import { requireScope } from "../../core/auth.js";
import { parseDataset } from "./dataset/parser.js";
import { runEvaluation } from "./runner.js";
import { compareStrategies } from "./strategy-comparison.js";
import { saveEvaluationResult } from "./output.js";
import { recordEvalRun, getRecentEvalRuns } from "./metrics-store.js";
import { toolContextFromRequest } from "../../core/authorization/http-tool-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const metadata = createMetadata({
  name: "retrieval-evals",
  version: "1.0.0",
  description: "Retrieval evaluation and benchmarking for RAG systems.",
  status: PluginStatus.BETA,
  riskLevel: RiskLevel.LOW,
  capabilities: ["read", "write"],
  requiresAuth: true,
  tags: ["rag", "evaluation", "benchmarking"],
  owner: "platform-team",
});

export const name = "retrieval-evals";
export const version = "1.0.0";
export const description = "Retrieval evaluation and strategy comparison.";

export const endpoints = [
  { method: "POST", path: "/retrieval-evals/run", description: "Run evaluation on dataset", scope: "write" },
  { method: "POST", path: "/retrieval-evals/compare", description: "Compare chunking strategies", scope: "write" },
  { method: "GET", path: "/retrieval-evals/recent", description: "Recent evaluation runs", scope: "read" },
  { method: "GET", path: "/retrieval-evals/health", description: "Plugin health", scope: "read" },
];

export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, plugin: name, version, status: "healthy" });
  });

  router.post("/run", requireScope("write"), async (req, res) => {
    const datasetInput = req.body?.dataset ?? req.body;
    const k = req.body?.k ?? 5;
    const workspaceId = req.body?.workspaceId ?? req.workspaceId ?? "retrieval-eval";
    const saveOutput = req.body?.saveOutput !== false;

    if (!datasetInput) {
      return res.status(400).json({ ok: false, error: { code: "missing_dataset", message: "Provide dataset in body" } });
    }

    let dataset = datasetInput;
    if (typeof datasetInput === "string" && datasetInput.startsWith("file:")) {
      const path = datasetInput.slice(5).trim();
      const fullPath = join(process.cwd(), path);
      if (!existsSync(fullPath)) {
        return res.status(400).json({ ok: false, error: { code: "file_not_found", message: `Dataset file not found: ${path}` } });
      }
      dataset = JSON.parse(readFileSync(fullPath, "utf-8"));
    }

    const parsed = parseDataset(dataset);
    if (!parsed.valid) {
      return res.status(400).json({ ok: false, error: { code: "invalid_dataset", message: "Invalid dataset", details: parsed.errors } });
    }

    try {
      const result = await runEvaluation({
        dataset: parsed.dataset,
        k,
        workspaceId,
        authContext: toolContextFromRequest(req),
      });
      recordEvalRun(result);

      if (saveOutput) {
        const { jsonPath, mdPath } = saveEvaluationResult(result, `run-${Date.now()}`);
        result.outputPaths = { json: jsonPath, markdown: mdPath };
      }

      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "eval_failed", message: err.message } });
    }
  });

  router.post("/compare", requireScope("write"), async (req, res) => {
    const datasetInput = req.body?.dataset ?? req.body;
    const strategies = req.body?.strategies ?? ["rag_direct", "rag_ingestion_fixed", "rag_ingestion_heading", "rag_ingestion_sliding"];
    const k = req.body?.k ?? 5;
    const saveOutput = req.body?.saveOutput !== false;

    if (!datasetInput) {
      return res.status(400).json({ ok: false, error: { code: "missing_dataset", message: "Provide dataset in body" } });
    }

    let dataset = datasetInput;
    if (typeof datasetInput === "string" && datasetInput.startsWith("file:")) {
      const path = datasetInput.slice(5).trim();
      const fullPath = join(process.cwd(), path);
      if (!existsSync(fullPath)) {
        return res.status(400).json({ ok: false, error: { code: "file_not_found", message: `Dataset file not found: ${path}` } });
      }
      dataset = JSON.parse(readFileSync(fullPath, "utf-8"));
    }

    const parsed = parseDataset(dataset);
    if (!parsed.valid) {
      return res.status(400).json({ ok: false, error: { code: "invalid_dataset", message: "Invalid dataset", details: parsed.errors } });
    }

    try {
      const results = await compareStrategies({
        dataset: parsed.dataset,
        strategies,
        k,
        authContext: toolContextFromRequest(req),
      });
      recordEvalRun(results);

      if (saveOutput) {
        const { jsonPath, mdPath } = saveEvaluationResult(results, `compare-${Date.now()}`);
        results.outputPaths = { json: jsonPath, markdown: mdPath };
      }

      res.json({ ok: true, data: results });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "compare_failed", message: err.message } });
    }
  });

  router.get("/recent", requireScope("read"), (_req, res) => {
    res.json({ ok: true, data: getRecentEvalRuns() });
  });

  app.use("/retrieval-evals", router);
}
