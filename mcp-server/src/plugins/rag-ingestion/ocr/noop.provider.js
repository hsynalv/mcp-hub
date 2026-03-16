/**
 * No-op OCR Provider
 * Used when no OCR provider is configured. Throws on use.
 */

import { OcrProvider } from "./provider.interface.js";

export class NoopOcrProvider extends OcrProvider {
  constructor(config = {}) {
    super({ ...config, name: "noop" });
  }

  async checkHealth() {
    return false;
  }

  async extractFromImage() {
    throw new Error("OCR not configured. Register an OCR provider for image-based PDF support.");
  }

  async extractFromPdfPage() {
    throw new Error("OCR not configured. Register an OCR provider for scanned PDF support.");
  }
}
