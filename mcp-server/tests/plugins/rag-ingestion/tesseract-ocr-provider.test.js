/**
 * Tesseract OCR Provider Tests
 *
 * Tests TesseractOcrProvider contract, health check, config, and error handling.
 * Mocks tesseract.js and pdf2pic to avoid runtime dependencies in CI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TesseractOcrProvider } from "../../../src/plugins/rag-ingestion/ocr/tesseract.provider.js";

// Mock tesseract.js
const mockRecognize = vi.fn();
const mockTerminate = vi.fn();
const mockCreateWorker = vi.fn(() =>
  Promise.resolve({
    recognize: mockRecognize,
    terminate: mockTerminate,
  })
);

vi.mock("tesseract.js", () => ({
  createWorker: (...args) => mockCreateWorker(...args),
}));

// Mock pdf2pic
const mockConvert = vi.fn();
vi.mock("pdf2pic", () => ({
  fromBuffer: () => mockConvert,
}));

describe("TesseractOcrProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RAG_OCR_TESSERACT_LANG;
    delete process.env.RAG_OCR_PDF_DPI;
    mockRecognize.mockResolvedValue({ data: { text: "extracted text" } });
    mockTerminate.mockResolvedValue(undefined);
    mockConvert.mockResolvedValue({ buffer: Buffer.from("fake-png") });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("implements OcrProvider contract", () => {
    const provider = new TesseractOcrProvider();
    expect(provider.name).toBe("tesseract");
    expect(typeof provider.checkHealth).toBe("function");
    expect(typeof provider.extractFromImage).toBe("function");
    expect(typeof provider.extractFromPdfPage).toBe("function");
  });

  it("checkHealth returns true when deps load", async () => {
    const provider = new TesseractOcrProvider();
    const healthy = await provider.checkHealth();
    expect(healthy).toBe(true);
  });


  it("extractFromImage uses tesseract and returns text", async () => {
    const provider = new TesseractOcrProvider();
    const result = await provider.extractFromImage(Buffer.from("fake-image"));
    expect(mockCreateWorker).toHaveBeenCalledWith("eng");
    expect(mockRecognize).toHaveBeenCalledWith(Buffer.from("fake-image"));
    expect(mockTerminate).toHaveBeenCalled();
    expect(result).toBe("extracted text");
  });

  it("extractFromImage respects language config", async () => {
    const provider = new TesseractOcrProvider({ language: "fra" });
    await provider.extractFromImage(Buffer.from("x"));
    expect(mockCreateWorker).toHaveBeenCalledWith("fra");
  });

  it("extractFromImage respects RAG_OCR_TESSERACT_LANG env", async () => {
    process.env.RAG_OCR_TESSERACT_LANG = "deu";
    const provider = new TesseractOcrProvider();
    await provider.extractFromImage(Buffer.from("x"));
    expect(mockCreateWorker).toHaveBeenCalledWith("deu");
  });

  it("extractFromPdfPage converts page and runs OCR", async () => {
    const provider = new TesseractOcrProvider();
    const pdfBuffer = Buffer.from("%PDF-1.4 fake");
    const result = await provider.extractFromPdfPage(pdfBuffer, 0);
    expect(mockConvert).toHaveBeenCalledWith(1, { responseType: "buffer" });
    expect(mockRecognize).toHaveBeenCalled();
    expect(result).toBe("extracted text");
  });

  it("extractFromPdfPage uses 1-based page for pdf2pic", async () => {
    const provider = new TesseractOcrProvider();
    await provider.extractFromPdfPage(Buffer.from("pdf"), 2);
    expect(mockConvert).toHaveBeenCalledWith(3, { responseType: "buffer" });
  });

  it("uses pdfDpi from config", () => {
    const provider = new TesseractOcrProvider({ pdfDpi: 200 });
    expect(provider.pdfDpi).toBe(200);
  });

  it("extractFromPdfPage throws clear error when pdf2pic fails", async () => {
    mockConvert.mockRejectedValue(new Error("gm not found"));
    const provider = new TesseractOcrProvider();
    await expect(
      provider.extractFromPdfPage(Buffer.from("pdf"), 0)
    ).rejects.toThrow(/GraphicsMagick|ImageMagick|PDF page conversion failed/);
  });

  it("extractFromImage propagates tesseract errors", async () => {
    mockCreateWorker.mockRejectedValue(new Error("tesseract.js not installed"));
    const provider = new TesseractOcrProvider();
    await expect(provider.extractFromImage(Buffer.from("x"))).rejects.toThrow(
      "tesseract.js not installed"
    );
  });
});
