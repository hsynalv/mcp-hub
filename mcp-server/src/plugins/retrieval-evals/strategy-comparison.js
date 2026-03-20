/**
 * Strategy Comparison
 *
 * Evaluates retrieval quality across RAG pipeline, rag-ingestion, and chunking strategies.
 */

import { callTool } from "../../core/tool-registry.js";
import { runPipeline } from "../rag-ingestion/pipeline/pipeline.js";
import { runEvaluation } from "./runner.js";
import { parseDataset } from "./dataset/parser.js";

const EVAL_WORKSPACE = "retrieval-eval";

const STRATEGIES = {
  rag_direct: {
    name: "rag_direct",
    description: "Index via RAG plugin directly (single doc per content)",
    index: indexRagDirect,
  },
  rag_ingestion_fixed: {
    name: "rag_ingestion_fixed",
    description: "rag-ingestion with fixed chunking",
    index: (docs, ctx) => indexViaIngestion(docs, ctx, "fixed"),
  },
  rag_ingestion_heading: {
    name: "rag_ingestion_heading",
    description: "rag-ingestion with heading-aware chunking",
    index: (docs, ctx) => indexViaIngestion(docs, ctx, "heading"),
  },
  rag_ingestion_sliding: {
    name: "rag_ingestion_sliding",
    description: "rag-ingestion with sliding-window chunking",
    index: (docs, ctx) => indexViaIngestion(docs, ctx, "sliding"),
  },
};

async function indexRagDirect(documents, context) {
  const ctx = { ...context, workspaceId: context.workspaceId || EVAL_WORKSPACE };
  const latencies = [];

  for (const doc of documents) {
    const start = Date.now();
    const r = await callTool("rag_index", { content: doc.content, metadata: doc.metadata, id: doc.id }, ctx);
    latencies.push(Date.now() - start);
    if (!r.ok) throw new Error(r.error?.message || "Index failed");
  }

  return {
    latencyByStage: { index: latencies.reduce((a, b) => a + b, 0) / latencies.length },
  };
}

async function indexViaIngestion(documents, context, chunkStrategy) {
  const ctx = { ...context, workspaceId: context.workspaceId || EVAL_WORKSPACE };
  const latencies = [];

  for (const doc of documents) {
    const start = Date.now();
    const result = await runPipeline(
      {
        content: doc.content,
        format: "markdown",
        documentId: doc.id,
        chunkStrategy,
      },
      ctx
    );
    latencies.push(Date.now() - start);
    if (!result.success) throw new Error(result.error || "Ingestion failed");
  }

  return {
    latencyByStage: { index: latencies.reduce((a, b) => a + b, 0) / latencies.length },
  };
}

/**
 * Compare strategies on a dataset
 * Each strategy uses a dedicated workspace to avoid cross-contamination.
 * @param {Object} params
 * @param {import("./dataset/schema.js").EvalDataset} params.dataset
 * @param {string[]} [params.strategies] - Strategy names to compare
 * @param {number} [params.k=5]
 * @returns {Promise<import("./types.js").StrategyComparisonResult[]>}
 */
export async function compareStrategies({
  dataset,
  strategies = Object.keys(STRATEGIES),
  k = 5,
  workspaceId = EVAL_WORKSPACE,
  authContext = {},
}) {
  const results = [];

  for (const name of strategies) {
    const strategy = STRATEGIES[name];
    if (!strategy) continue;

    const strategyWorkspace = `${workspaceId}-${name}`;
    const ctx = { workspaceId: strategyWorkspace, ...authContext };

    const indexStart = Date.now();
    let latencyByStage = {};
    try {
      const indexResult = await strategy.index(dataset.documents, ctx);
      latencyByStage = indexResult.latencyByStage || {};
    } catch (err) {
      results.push({
        strategy: name,
        result: null,
        error: err.message,
        latencyByStage: { index: Date.now() - indexStart },
      });
      continue;
    }

    const evalResult = await runEvaluation({
      dataset,
      k,
      workspaceId: strategyWorkspace,
      authContext,
    });
    evalResult.latencyByStage = latencyByStage;

    results.push({
      strategy: name,
      result: evalResult,
      latencyByStage,
    });
  }

  return results;
}

export { STRATEGIES };
