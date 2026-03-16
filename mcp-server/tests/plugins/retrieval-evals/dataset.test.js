/**
 * Dataset parsing tests
 */

import { describe, it, expect } from "vitest";
import { parseDataset } from "../../../src/plugins/retrieval-evals/dataset/parser.js";
import { EvalDatasetSchema } from "../../../src/plugins/retrieval-evals/dataset/schema.js";

describe("Dataset Parser", () => {
  const validDataset = {
    version: "1.0",
    name: "test",
    documents: [{ id: "d1", content: "Hello world" }],
    queries: [
      { id: "q1", query: "hello", expectedChunkIds: ["d1--chunk-0"] },
      { id: "q2", query: "world", expectedDocumentIds: ["d1"] },
    ],
  };

  it("parses valid dataset", () => {
    const result = parseDataset(validDataset);
    expect(result.valid).toBe(true);
    expect(result.dataset.documents).toHaveLength(1);
    expect(result.dataset.queries).toHaveLength(2);
  });

  it("parses JSON string", () => {
    const result = parseDataset(JSON.stringify(validDataset));
    expect(result.valid).toBe(true);
  });

  it("rejects invalid JSON string", () => {
    const result = parseDataset("not json");
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects missing documents", () => {
    const result = parseDataset({ queries: [{ id: "q1", query: "x", expectedChunkIds: ["a"] }] });
    expect(result.valid).toBe(false);
  });

  it("rejects query without expected results", () => {
    const result = parseDataset({
      documents: [{ id: "d1", content: "x" }],
      queries: [{ id: "q1", query: "x" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("expected"))).toBe(true);
  });

  it("accepts expectedReferences", () => {
    const result = parseDataset({
      documents: [{ id: "d1", content: "x" }],
      queries: [{ id: "q1", query: "x", expectedReferences: ["d1"] }],
    });
    expect(result.valid).toBe(true);
  });
});

describe("Dataset Schema", () => {
  it("validates document structure", () => {
    const doc = { id: "d1", content: "x" };
    const result = EvalDatasetSchema.safeParse({
      documents: [doc],
      queries: [{ id: "q1", query: "x", expectedChunkIds: ["d1"] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty document content", () => {
    const result = EvalDatasetSchema.safeParse({
      documents: [{ id: "d1", content: "" }],
      queries: [{ id: "q1", query: "x", expectedChunkIds: ["d1"] }],
    });
    expect(result.success).toBe(false);
  });
});
