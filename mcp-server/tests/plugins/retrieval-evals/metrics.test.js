/**
 * Evaluation metrics tests
 */

import { describe, it, expect } from "vitest";
import {
  hitAtK,
  recallAtK,
  reciprocalRank,
  chunkCoverage,
} from "../../../src/plugins/retrieval-evals/metrics/index.js";

describe("hitAtK", () => {
  it("returns 1 when expected in top-k", () => {
    expect(hitAtK(["a", "b", "c"], ["a"], 3)).toBe(1);
    expect(hitAtK(["a", "b", "c"], ["b"], 3)).toBe(1);
  });

  it("returns 0 when expected not in top-k", () => {
    expect(hitAtK(["a", "b", "c"], ["d"], 3)).toBe(0);
    expect(hitAtK(["a", "b", "c"], ["d"], 5)).toBe(0);
  });

  it("respects k parameter", () => {
    expect(hitAtK(["a", "b", "c", "d"], ["d"], 3)).toBe(0);
    expect(hitAtK(["a", "b", "c", "d"], ["d"], 4)).toBe(1);
  });

  it("matches chunk IDs", () => {
    expect(hitAtK(["doc-1--chunk-0", "doc-2--chunk-0"], ["doc-1--chunk-0"], 5)).toBe(1);
    expect(hitAtK(["doc-1--chunk-0"], ["doc-1"], 5)).toBe(1);
  });
});

describe("recallAtK", () => {
  it("returns 1 when all expected found", () => {
    expect(recallAtK(["a", "b", "c"], ["a", "b"], 3)).toBe(1);
  });

  it("returns partial when some expected found", () => {
    expect(recallAtK(["a", "b", "c"], ["a", "b", "d"], 3)).toBe(2 / 3);
  });

  it("returns 0 when no expected found", () => {
    expect(recallAtK(["a", "b"], ["c", "d"], 5)).toBe(0);
  });

  it("returns 0 for empty expected", () => {
    expect(recallAtK(["a", "b"], [], 5)).toBe(0);
  });
});

describe("reciprocalRank", () => {
  it("returns 1 for first position", () => {
    expect(reciprocalRank(["a", "b", "c"], ["a"])).toBe(1);
  });

  it("returns 0.5 for second position", () => {
    expect(reciprocalRank(["a", "b", "c"], ["b"])).toBe(0.5);
  });

  it("returns 0 when not found", () => {
    expect(reciprocalRank(["a", "b", "c"], ["d"])).toBe(0);
  });
});

describe("chunkCoverage", () => {
  it("returns 1 when all expected in retrieved", () => {
    expect(chunkCoverage(["a", "b", "c"], ["a", "b"])).toBe(1);
  });

  it("returns partial when some expected in retrieved", () => {
    expect(chunkCoverage(["a", "b"], ["a", "b", "c"])).toBe(2 / 3);
  });

  it("returns 0 for empty expected", () => {
    expect(chunkCoverage(["a", "b"], [])).toBe(0);
  });
});
