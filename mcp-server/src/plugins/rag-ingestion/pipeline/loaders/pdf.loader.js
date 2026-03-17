/**
 * PDF Document Loader
 *
 * Extracts text from PDFs. Text-based PDFs use pdf-parse (optional dep).
 * Image-based (scanned) PDFs require an OCR provider to be registered.
 */

import { getOcrProvider } from "../../ocr/index.js";

let pdfParse = null;
let pdfParseFailed = false;

async function loadPdfParse() {
  if (pdfParse) return pdfParse;
  if (pdfParseFailed) throw new Error("PDF support requires pdf-parse. Install with: npm install pdf-parse");
  try {
    const mod = await import("pdf-parse");
    pdfParse = mod.default;
    return pdfParse;
  } catch {
    pdfParseFailed = true;
    throw new Error("PDF support requires pdf-parse. Install with: npm install pdf-parse");
  }
}

/**
 * Load PDF from base64 content (from API) or Buffer
 * @param {string|Buffer} input - Base64 string or Buffer
 * @returns {Promise<{ content: string, metadata: Object }>}
 */
export async function loadPdf(input) {
  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === "string") {
    buffer = Buffer.from(input, "base64");
  } else {
    throw new Error("PDF input must be base64 string or Buffer");
  }

  const parse = await loadPdfParse();
  const data = await parse(buffer);
  const text = (data.text || "").trim();

  if (!text) {
    const provider = getOcrProvider();
    if (provider && provider.name !== "noop" && (await provider.checkHealth())) {
      const numPages = data.numpages || 1;
      const texts = [];
      for (let i = 0; i < numPages; i++) {
        const pageText = await provider.extractFromPdfPage(buffer, i);
        texts.push(pageText || "");
      }
      return {
        content: texts.join("\n\n").trim(),
        metadata: { sourceType: "pdf", extractedVia: "ocr", pages: numPages },
      };
    }
    const hint =
      provider && provider.name !== "noop"
        ? "OCR provider is configured but unavailable. Ensure tesseract.js, pdf2pic, and GraphicsMagick (or ImageMagick) are installed."
        : "Set RAG_OCR_PROVIDER=tesseract and install: npm install tesseract.js pdf2pic, plus GraphicsMagick (apt install graphicsmagick) or ImageMagick.";
    throw new Error(
      `PDF appears to be image-based (scanned). No text extracted. ${hint}`
    );
  }

  return {
    content: text,
    metadata: { sourceType: "pdf", extractedVia: "text", pages: data.numpages },
  };
}
