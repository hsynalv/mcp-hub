/**
 * Evaluation Output
 * Saves results as JSON and optional markdown summary.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_OUTPUT_DIR = process.env.RETRIEVAL_EVAL_OUTPUT_DIR || "./cache/retrieval-evals";

/**
 * @param {Object} result - Full evaluation or strategy comparison result
 * @param {string} [filename] - Base filename (without extension)
 * @param {Object} [options]
 * @param {boolean} [options.includeMarkdown=true]
 * @returns {{ jsonPath: string, mdPath?: string }}
 */
export function saveEvaluationResult(result, filename, options = {}) {
  const { includeMarkdown = true } = options;
  const base = filename || `eval-${Date.now()}`;
  const dir = join(process.cwd(), DEFAULT_OUTPUT_DIR);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const jsonPath = join(dir, `${base}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  let mdPath;
  if (includeMarkdown) {
    mdPath = join(dir, `${base}.md`);
    writeFileSync(mdPath, formatMarkdownSummary(result), "utf-8");
  }

  return { jsonPath, mdPath };
}

function formatMarkdownSummary(result) {
  const lines = ["# Retrieval Evaluation Report", "", `Generated: ${new Date().toISOString()}`, ""];

  if (Array.isArray(result) && result.length > 0) {
    lines.push("## Strategy Comparison", "");
    lines.push("| Strategy | Hit@K | Recall@K | MRR | Chunk Coverage | Latency (ms) |");
    lines.push("|----------|-------|----------|-----|----------------|--------------|");

    for (const r of result) {
      if (r.error) {
        lines.push(`| ${r.strategy} | ERROR: ${r.error} |`);
        continue;
      }
      const m = r.result?.metrics || {};
      lines.push(
        `| ${r.strategy} | ${m.hitAtK ?? "-"} | ${m.recallAtK ?? "-"} | ${m.mrr ?? "-"} | ${m.chunkCoverage ?? "-"} | ${m.latencyMsMean ?? "-"} |`
      );
    }
  } else if (result.metrics) {
    lines.push("## Metrics", "");
    lines.push(`- **Hit@K**: ${result.metrics.hitAtK}`);
    lines.push(`- **Recall@K**: ${result.metrics.recallAtK}`);
    lines.push(`- **MRR**: ${result.metrics.mrr}`);
    lines.push(`- **Chunk Coverage**: ${result.metrics.chunkCoverage}`);
    lines.push(`- **Latency (mean ms)**: ${result.metrics.latencyMsMean}`);
    lines.push("");
    lines.push(`Dataset: ${result.datasetName || "unnamed"}, Queries: ${result.queryCount}`);
  }

  return lines.join("\n");
}
