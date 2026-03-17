/**
 * Tesseract OCR Provider
 *
 * Extracts text from images and scanned PDF pages using tesseract.js and pdf2pic.
 * Requires: tesseract.js, pdf2pic, GraphicsMagick or ImageMagick (for PDF→image).
 */

import { OcrProvider } from "./provider.interface.js";
import { tmpdir } from "os";
import { join } from "path";

const RAG_OCR_TESSERACT_LANG = "RAG_OCR_TESSERACT_LANG";
const RAG_OCR_PDF_DPI = "RAG_OCR_PDF_DPI";

let tesseractModule = null;
let pdf2picModule = null;
let loadError = null;

async function loadTesseract() {
  if (tesseractModule) return tesseractModule;
  if (loadError) throw loadError;
  try {
    const mod = await import("tesseract.js");
    tesseractModule = mod;
    return mod;
  } catch (err) {
    loadError = err;
    throw new Error(
      "Tesseract OCR requires tesseract.js. Install with: npm install tesseract.js"
    );
  }
}

async function loadPdf2Pic() {
  if (pdf2picModule) return pdf2picModule;
  if (loadError) throw loadError;
  try {
    const mod = await import("pdf2pic");
    pdf2picModule = mod;
    return mod;
  } catch (err) {
    loadError = err;
    throw new Error(
      "PDF-to-image conversion requires pdf2pic and GraphicsMagick or ImageMagick. " +
        "Install: npm install pdf2pic, then install GraphicsMagick (e.g. apt install graphicsmagick) or ImageMagick."
    );
  }
}

export class TesseractOcrProvider extends OcrProvider {
  constructor(config = {}) {
    super({ ...config, name: "tesseract" });
    this.language =
      config.language ??
      process.env[RAG_OCR_TESSERACT_LANG] ??
      "eng";
    this.pdfDpi =
      parseInt(
        config.pdfDpi ?? process.env[RAG_OCR_PDF_DPI] ?? "150",
        10
      ) || 150;
  }

  /**
   * Check if tesseract.js and pdf2pic are available
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    try {
      await loadTesseract();
      await loadPdf2Pic();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract text from an image buffer
   * @param {Buffer} imageBuffer - Raw image bytes (PNG, JPEG, etc.)
   * @param {Object} [options] - { language? }
   * @returns {Promise<string>}
   */
  async extractFromImage(imageBuffer, options = {}) {
    const { createWorker } = await loadTesseract();
    const lang = options.language ?? this.language;
    const worker = await createWorker(lang);
    try {
      const {
        data: { text },
      } = await worker.recognize(imageBuffer);
      return (text || "").trim();
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Extract text from a PDF page (render to image, then OCR)
   * @param {Buffer} pdfBuffer - Full PDF bytes
   * @param {number} [pageIndex=0] - Zero-based page index
   * @returns {Promise<string>}
   */
  async extractFromPdfPage(pdfBuffer, pageIndex = 0) {
    const { fromBuffer } = await loadPdf2Pic();
    const savePath = join(tmpdir(), `rag-ocr-${Date.now()}-${pageIndex}`);
    const convert = fromBuffer(pdfBuffer, {
      density: this.pdfDpi,
      saveFilename: "page",
      savePath,
      format: "png",
    });

    const pageNum = pageIndex + 1; // pdf2pic uses 1-based pages
    let result;
    try {
      result = await convert(pageNum, { responseType: "buffer" });
    } catch (err) {
      throw new Error(
        `PDF page conversion failed. Ensure GraphicsMagick or ImageMagick is installed (e.g. apt install graphicsmagick). ${err.message}`
      );
    }

    if (!result?.buffer) {
      return "";
    }

    return this.extractFromImage(Buffer.from(result.buffer), {
      language: this.language,
    });
  }
}
