/**
 * OCR Provider Interface
 *
 * Abstraction for extracting text from images or image-based PDF pages.
 * Implementations: TesseractOcrProvider, AzureOcrProvider, etc.
 */

/**
 * @typedef {Object} OcrProviderConfig
 * @property {string} [language] - Language code (e.g. "eng")
 * @property {Object} [options] - Provider-specific options
 */

/**
 * OCR Provider interface.
 * Register implementations via registerOcrProvider().
 */
export class OcrProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = config.name || "unknown";
  }

  /**
   * Check if the provider is available and configured
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    throw new Error("checkHealth() must be implemented");
  }

  /**
   * Extract text from an image buffer
   * @param {Buffer} imageBuffer - Raw image bytes (PNG, JPEG, etc.)
   * @param {OcrProviderConfig} [options] - Extraction options
   * @returns {Promise<string>} Extracted text
   */
  async extractFromImage(imageBuffer, options = {}) {
    throw new Error("extractFromImage() must be implemented");
  }

  /**
   * Extract text from a PDF page (as image)
   * Some providers accept PDF directly; others require pre-rendered images.
   * @param {Buffer} pdfBuffer - Full PDF bytes
   * @param {number} [pageIndex] - Zero-based page index
   * @returns {Promise<string>} Extracted text for the page
   */
  async extractFromPdfPage(pdfBuffer, pageIndex = 0) {
    throw new Error("extractFromPdfPage() must be implemented or use default PDF text extraction");
  }
}
