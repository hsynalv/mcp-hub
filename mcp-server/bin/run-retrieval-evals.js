#!/usr/bin/env node
/**
 * CLI for running retrieval evaluations
 *
 * Loads MCP-Hub plugins (rag, rag-ingestion) then runs evaluation.
 *
 * Usage:
 *   node bin/run-retrieval-evals.js run <dataset-path>
 *   node bin/run-retrieval-evals.js compare <dataset-path> [--strategies a,b,c]
 *
 * Examples:
 *   node bin/run-retrieval-evals.js run ./data/eval-dataset.json
 *   node bin/run-retrieval-evals.js compare ./data/eval-dataset.json --strategies rag_ingestion_fixed,rag_ingestion_heading
 */

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadApp() {
  const { loadPlugins } = await import("../src/core/plugins.js");
  const { initializeToolHooks } = await import("../src/core/tool-registry.js");
  const app = express();
  initializeToolHooks();
  await loadPlugins(app);
  return app;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const datasetPath = args[1];

  if (!command || !["run", "compare"].includes(command)) {
    console.error("Usage: node bin/run-retrieval-evals.js <run|compare> <dataset-path> [--strategies a,b,c] [--k 5]");
    process.exit(1);
  }

  if (!datasetPath) {
    console.error("Error: dataset path required");
    process.exit(1);
  }

  const fullPath = join(process.cwd(), datasetPath);
  if (!existsSync(fullPath)) {
    console.error(`Error: dataset file not found: ${fullPath}`);
    process.exit(1);
  }

  const strategiesArg = args.find((a) => a.startsWith("--strategies="));
  const strategies = strategiesArg ? strategiesArg.split("=")[1].split(",") : undefined;

  const kArg = args.find((a) => a.startsWith("--k="));
  const k = kArg ? parseInt(kArg.split("=")[1], 10) : 5;

  console.log("Loading MCP-Hub plugins...");
  await loadApp();

  const dataset = JSON.parse(readFileSync(fullPath, "utf-8"));

  const { parseDataset } = await import("../src/plugins/retrieval-evals/dataset/parser.js");
  const { runEvaluation } = await import("../src/plugins/retrieval-evals/runner.js");
  const { compareStrategies } = await import("../src/plugins/retrieval-evals/strategy-comparison.js");
  const { saveEvaluationResult } = await import("../src/plugins/retrieval-evals/output.js");

  const parsed = parseDataset(dataset);
  if (!parsed.valid) {
    console.error("Invalid dataset:", parsed.errors);
    process.exit(1);
  }

  console.log(`Running ${command} on dataset: ${parsed.dataset.name || "unnamed"}`);
  console.log(`Documents: ${parsed.dataset.documents.length}, Queries: ${parsed.dataset.queries.length}`);

  if (command === "run") {
    const result = await runEvaluation({ dataset: parsed.dataset, k });
    const { jsonPath, mdPath } = saveEvaluationResult(result, `cli-run-${Date.now()}`);
    console.log("\nResults:");
    console.log(JSON.stringify(result.metrics, null, 2));
    console.log(`\nSaved to: ${jsonPath}`);
    if (mdPath) console.log(`Summary: ${mdPath}`);
  } else {
    const results = await compareStrategies({
      dataset: parsed.dataset,
      strategies,
      k,
    });
    const { jsonPath, mdPath } = saveEvaluationResult(results, `cli-compare-${Date.now()}`);
    console.log("\nStrategy Comparison:");
    for (const r of results) {
      if (r.error) console.log(`  ${r.strategy}: ERROR - ${r.error}`);
      else console.log(`  ${r.strategy}: Hit@K=${r.result.metrics.hitAtK}, Recall@K=${r.result.metrics.recallAtK}, MRR=${r.result.metrics.mrr}`);
    }
    console.log(`\nSaved to: ${jsonPath}`);
    if (mdPath) console.log(`Summary: ${mdPath}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
