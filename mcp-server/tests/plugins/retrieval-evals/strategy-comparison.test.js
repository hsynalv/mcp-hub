/**
 * Strategy comparison tests
 *
 * These tests require the full app (rag, rag-ingestion) to be loaded.
 * Run with: npx vitest run tests/plugins/retrieval-evals/strategy-comparison.test.js
 */

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { loadPlugins } from "../../../src/core/plugins.js";
import { initializeToolHooks } from "../../../src/core/tool-registry.js";
import { parseDataset } from "../../../src/plugins/retrieval-evals/dataset/parser.js";
import { STRATEGIES } from "../../../src/plugins/retrieval-evals/strategy-comparison.js";

describe("Strategy Comparison", () => {
  beforeAll(async () => {
    const app = express();
    initializeToolHooks();
    await loadPlugins(app);
  });

  it("STRATEGIES includes expected strategies", () => {
    expect(STRATEGIES.rag_direct).toBeDefined();
    expect(STRATEGIES.rag_ingestion_fixed).toBeDefined();
    expect(STRATEGIES.rag_ingestion_heading).toBeDefined();
    expect(STRATEGIES.rag_ingestion_sliding).toBeDefined();
  });

  it("compareStrategies runs without error on minimal dataset", async () => {
    const { compareStrategies } = await import("../../../src/plugins/retrieval-evals/strategy-comparison.js");

    const dataset = {
      documents: [
        { id: "d1", content: "# Test\n\nShort content for eval." },
      ],
      queries: [
        { id: "q1", query: "test content", expectedDocumentIds: ["d1"] },
      ],
    };

    const parsed = parseDataset(dataset);
    expect(parsed.valid).toBe(true);

    const results = await compareStrategies({
      dataset: parsed.dataset,
      strategies: ["rag_ingestion_sliding"],
      k: 5,
      authContext: {
        actor: { type: "test", scopes: ["read", "write", "admin"] },
        scopes: ["read", "write", "admin"],
        authScopes: ["read", "write", "admin"],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].strategy).toBe("rag_ingestion_sliding");
    expect(results[0].result).toBeDefined();
    expect(results[0].result.metrics).toBeDefined();
    expect(typeof results[0].result.metrics.hitAtK).toBe("number");
    expect(typeof results[0].result.metrics.recallAtK).toBe("number");
    expect(typeof results[0].result.metrics.mrr).toBe("number");
  }, 30_000);
});
