/**
 * Retrieval Evaluation Runner
 *
 * Runs queries, retrieves chunks, compares with expected results.
 */

import { callTool } from "../../core/tool-registry.js";
import { hitAtK, recallAtK, reciprocalRank, chunkCoverage } from "./metrics/index.js";

const EVAL_WORKSPACE = "retrieval-eval";
const DEFAULT_K = 5;

/**
 * @param {Object} options
 * @param {string} options.query - Query text
 * @param {string[]} options.expectedChunkIds - Expected chunk IDs
 * @param {string[]} [options.expectedDocumentIds] - Expected document IDs (alternative)
 * @param {number} [options.k=5]
 * @param {Object} [options.context] - Execution context
 * @returns {Promise<{ retrievedIds: string[], hitAtK: number, recallAtK: number, mrr: number, chunkCoverage: number, latencyMs: number }>}
 */
export async function runQueryEvaluation(options) {
  const {
    query,
    expectedChunkIds = [],
    expectedDocumentIds = [],
    expectedReferences = [],
    k = DEFAULT_K,
    context = {},
  } = options;

  const expectedIds = expectedChunkIds.length
    ? expectedChunkIds
    : expectedDocumentIds.length
      ? expectedDocumentIds
      : expectedReferences;

  const start = Date.now();
  const result = await callTool(
    "rag_search",
    { query, limit: k, minScore: 0.05 },
    { ...context, workspaceId: context.workspaceId || EVAL_WORKSPACE }
  );

  const latencyMs = Date.now() - start;

  if (!result.ok) {
    return {
      retrievedIds: [],
      hitAtK: 0,
      recallAtK: 0,
      mrr: 0,
      chunkCoverage: 0,
      latencyMs,
      error: result.error?.message,
    };
  }

  const retrievedIds = (result.data?.results || []).map((r) => r.id).filter(Boolean);

  return {
    retrievedIds,
    hitAtK: hitAtK(retrievedIds, expectedIds, k),
    recallAtK: recallAtK(retrievedIds, expectedIds, k),
    mrr: reciprocalRank(retrievedIds, expectedIds),
    chunkCoverage: chunkCoverage(retrievedIds, expectedIds),
    latencyMs,
  };
}

/**
 * Run full evaluation over a dataset
 * @param {Object} params
 * @param {import("./dataset/schema.js").EvalDataset} params.dataset
 * @param {number} [params.k=5]
 * @param {string} [params.workspaceId]
 * @returns {Promise<import("./types.js").EvalRunResult>}
 */
export async function runEvaluation({ dataset, k = DEFAULT_K, workspaceId = EVAL_WORKSPACE }) {
  const context = { workspaceId };
  const queryResults = [];
  const latencies = [];

  for (const q of dataset.queries) {
    const expectedIds =
      q.expectedChunkIds || q.expectedDocumentIds || q.expectedReferences || [];
    const r = await runQueryEvaluation({
      query: q.query,
      expectedChunkIds: expectedIds,
      k,
      context,
    });
    queryResults.push({
      queryId: q.id,
      query: q.query,
      ...r,
    });
    latencies.push(r.latencyMs);
  }

  const n = queryResults.length;
  const hitAtKMean = n > 0 ? queryResults.reduce((s, r) => s + r.hitAtK, 0) / n : 0;
  const recallAtKMean = n > 0 ? queryResults.reduce((s, r) => s + r.recallAtK, 0) / n : 0;
  const mrrMean = n > 0 ? queryResults.reduce((s, r) => s + r.mrr, 0) / n : 0;
  const chunkCoverageMean = n > 0 ? queryResults.reduce((s, r) => s + r.chunkCoverage, 0) / n : 0;
  const latencyMean = n > 0 ? latencies.reduce((a, b) => a + b, 0) / n : 0;

  return {
    datasetName: dataset.name || "unnamed",
    queryCount: n,
    k,
    metrics: {
      hitAtK: Math.round(hitAtKMean * 1000) / 1000,
      recallAtK: Math.round(recallAtKMean * 1000) / 1000,
      mrr: Math.round(mrrMean * 1000) / 1000,
      chunkCoverage: Math.round(chunkCoverageMean * 1000) / 1000,
      latencyMsMean: Math.round(latencyMean),
    },
    queryResults,
    timestamp: new Date().toISOString(),
  };
}
