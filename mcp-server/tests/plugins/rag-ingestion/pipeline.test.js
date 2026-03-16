/**
 * RAG Ingestion Pipeline Tests
 */

import { describe, it, expect } from "vitest";
import { chunkFixed, chunkByHeading, chunkSliding, chunkSemantic } from "../../../src/plugins/rag-ingestion/pipeline/chunkers/index.js";
import { normalizeMarkdown, normalizeText } from "../../../src/plugins/rag-ingestion/pipeline/normalizers/index.js";
import { loadMarkdown, loadText } from "../../../src/plugins/rag-ingestion/pipeline/loaders/index.js";
import { enrichMetadata } from "../../../src/plugins/rag-ingestion/pipeline/enrichers/index.js";
import { embedChunks } from "../../../src/plugins/rag-ingestion/pipeline/embedding/index.js";
import { runPipeline } from "../../../src/plugins/rag-ingestion/pipeline/pipeline.js";

describe("Chunkers", () => {
  const sample = "Hello world. ".repeat(100);

  it("chunkFixed splits by fixed size", () => {
    const chunks = chunkFixed(sample, { chunkSize: 100, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata.chunkIndex).toBe(0);
    expect(chunks[0].metadata.totalChunks).toBe(chunks.length);
  });

  it("chunkSliding uses overlap", () => {
    const chunks = chunkSliding(sample, { chunkSize: 100, chunkOverlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.content.length).toBeLessThanOrEqual(100 + 20);
    });
  });

  it("chunkByHeading splits at markdown headings", () => {
    const md = `# Title
Content here.

## Section 1
More content.

## Section 2
Even more.`;
    const chunks = chunkByHeading(md, { maxChunkSize: 500 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const withHeadings = chunks.filter((c) => c.metadata.heading);
    expect(withHeadings.length).toBeGreaterThan(0);
  });

  it("chunkSemantic falls back to sliding when no structure", () => {
    const chunks = chunkSemantic("plain text without headings. ".repeat(50));
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("chunkSemantic uses heading when structure exists", () => {
    const md = "# A\nx\n\n## B\ny";
    const chunks = chunkSemantic(md);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe("Normalizers", () => {
  it("normalizeMarkdown collapses extra newlines", () => {
    const out = normalizeMarkdown("a\n\n\n\nb");
    expect(out).toBe("a\n\nb");
  });

  it("normalizeText trims", () => {
    expect(normalizeText("  x  ")).toBe("x");
  });
});

describe("Loaders", () => {
  it("loadMarkdown accepts valid markdown", async () => {
    const r = await loadMarkdown("# Hi\ncontent");
    expect(r.content).toContain("# Hi");
    expect(r.metadata.sourceType).toBe("markdown");
  });

  it("loadMarkdown rejects empty", async () => {
    await expect(loadMarkdown("")).rejects.toThrow();
  });

  it("loadText accepts valid text", async () => {
    const r = await loadText("hello");
    expect(r.content).toBe("hello");
  });
});

describe("Embedding", () => {
  it("embedChunks passes through chunks (placeholder)", async () => {
    const chunks = [{ id: "c1", content: "x", metadata: {} }];
    const out = await embedChunks(chunks);
    expect(out).toHaveLength(1);
    expect(out[0].metadata.embeddingStep).toBe("passthrough");
  });
});

describe("Enrichers", () => {
  it("enrichMetadata adds documentId and sourceType", () => {
    const chunks = [{ content: "x", metadata: { chunkIndex: 0, totalChunks: 1 } }];
    const out = enrichMetadata(chunks, { title: "Doc" }, "doc-1", "markdown");
    expect(out[0].metadata.documentId).toBe("doc-1");
    expect(out[0].metadata.sourceType).toBe("markdown");
    expect(out[0].metadata.custom?.title).toBe("Doc");
  });
});

describe("Pipeline", () => {
  it("runPipeline preview returns chunks without indexing", async () => {
    const result = await runPipeline(
      {
        content: "# Test\n\nSome content here.",
        format: "markdown",
        chunkStrategy: "sliding",
        previewOnly: true,
      },
      { workspaceId: "test-ws" }
    );
    expect(result.success).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.indexing).toBeNull();
  });

  it("runPipeline rejects invalid format", async () => {
    const result = await runPipeline(
      { content: "x", format: "invalid", previewOnly: true },
      {}
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("format");
  });

  it("runPipeline rejects invalid strategy", async () => {
    const result = await runPipeline(
      { content: "x", chunkStrategy: "invalid", previewOnly: true },
      {}
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("strategy");
  });

  it("runPipeline rejects oversized document", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    const result = await runPipeline(
      { content: big, previewOnly: true },
      {}
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("exceeds");
  });
});
