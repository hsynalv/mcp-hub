/**
 * OCR Integration Tests
 *
 * Tests OCR registry, RAG_OCR_PROVIDER env, and PDF loader fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOcrProvider,
  registerOcrProvider,
  listOcrProviders,
  setDefaultOcrProvider,
  _clearOcrProvidersForTesting,
} from "../../../src/plugins/rag-ingestion/ocr/index.js";
import { OcrProvider } from "../../../src/plugins/rag-ingestion/ocr/provider.interface.js";
import { loadPdf } from "../../../src/plugins/rag-ingestion/pipeline/loaders/pdf.loader.js";

// Minimal valid PDF buffer (PDF magic bytes + minimal structure)
const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF",
  "utf8"
);

// Mock pdf-parse
const mockPdfParse = vi.fn();
vi.mock("pdf-parse", () => ({ default: (...args) => mockPdfParse(...args) }));

class MockOcrProvider extends OcrProvider {
  constructor(config = {}) {
    super({ ...config, name: config.name || "mock" });
  }

  async checkHealth() {
    return true;
  }

  async extractFromImage() {
    return "extracted from image";
  }

  async extractFromPdfPage(buffer, pageIndex = 0) {
    return `page ${pageIndex} ocr text`;
  }
}

describe("OCR Registry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.RAG_OCR_PROVIDER;
    // Clear providers by re-importing (registry is module-level state)
    // We test against a fresh registry by using a test-only provider name
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("getOcrProvider returns NoopOcrProvider when no provider registered", () => {
    const provider = getOcrProvider();
    expect(provider.name).toBe("noop");
    expect(provider.checkHealth()).resolves.toBe(false);
  });

  it("registerOcrProvider and getOcrProvider by name", () => {
    const mock = new MockOcrProvider({ name: "test-ocr" });
    registerOcrProvider("test-ocr", mock);
    const p = getOcrProvider("test-ocr");
    expect(p).toBe(mock);
    expect(p.name).toBe("test-ocr");
  });

  it("listOcrProviders returns registered names", () => {
    const mock = new MockOcrProvider({ name: "list-test" });
    registerOcrProvider("list-test", mock);
    const names = listOcrProviders();
    expect(names).toContain("list-test");
  });

  it("getOcrProvider uses RAG_OCR_PROVIDER when name is null", async () => {
    const mock = new MockOcrProvider({ name: "env-provider" });
    registerOcrProvider("env-provider", mock);
    process.env.RAG_OCR_PROVIDER = "env-provider";

    const provider = getOcrProvider();
    expect(provider).toBe(mock);
    expect(await provider.checkHealth()).toBe(true);
  });

  it("getOcrProvider throws when RAG_OCR_PROVIDER set but provider not registered", () => {
    process.env.RAG_OCR_PROVIDER = "nonexistent";
    expect(() => getOcrProvider()).toThrow('OCR provider "nonexistent" not registered');
  });

  it("setDefaultOcrProvider sets default", () => {
    const mock = new MockOcrProvider({ name: "default-test" });
    registerOcrProvider("default-test", mock);
    setDefaultOcrProvider("default-test");
    const p = getOcrProvider();
    expect(p).toBe(mock);
  });
});

describe("PDF Loader - OCR Fallback", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockPdfParse.mockReset();
    _clearOcrProvidersForTesting();
    process.env = { ...originalEnv };
    delete process.env.RAG_OCR_PROVIDER;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("text-based PDF uses normal extraction (extractedVia: text)", async () => {
    mockPdfParse.mockResolvedValue({ text: "Hello from PDF", numpages: 1 });

    const result = await loadPdf(MINIMAL_PDF);
    expect(result.content).toBe("Hello from PDF");
    expect(result.metadata.extractedVia).toBe("text");
    expect(result.metadata.sourceType).toBe("pdf");
    expect(result.metadata.pages).toBe(1);
  });

  it("scanned PDF throws when no OCR provider configured", async () => {
    mockPdfParse.mockResolvedValue({ text: "", numpages: 1 });

    await expect(loadPdf(MINIMAL_PDF)).rejects.toThrow(
      /PDF appears to be image-based|RAG_OCR_PROVIDER|Register an OCR provider/
    );
  });

  it("scanned PDF uses OCR when provider configured", async () => {
    mockPdfParse.mockResolvedValue({ text: "", numpages: 2 });

    const mockProvider = new MockOcrProvider({ name: "pdf-ocr" });
    registerOcrProvider("pdf-ocr", mockProvider);
    process.env.RAG_OCR_PROVIDER = "pdf-ocr";

    const result = await loadPdf(MINIMAL_PDF);
    expect(result.content).toContain("page 0 ocr text");
    expect(result.content).toContain("page 1 ocr text");
    expect(result.metadata.extractedVia).toBe("ocr");
    expect(result.metadata.pages).toBe(2);
  });

  it("loadPdf accepts base64 string", async () => {
    mockPdfParse.mockResolvedValue({ text: "Base64 content", numpages: 1 });
    const base64 = MINIMAL_PDF.toString("base64");

    const result = await loadPdf(base64);
    expect(result.content).toBe("Base64 content");
  });

  it("loadPdf rejects invalid input", async () => {
    await expect(loadPdf(123)).rejects.toThrow("PDF input must be base64 string or Buffer");
  });
});
