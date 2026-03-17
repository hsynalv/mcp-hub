/**
 * OCR Provider Registry
 * Register and resolve OCR providers by name.
 */

import { NoopOcrProvider } from "./noop.provider.js";

const providers = new Map();
let defaultProvider = null;

export function registerOcrProvider(name, providerInstance) {
  if (typeof name !== "string" || !name) {
    throw new Error("Provider name must be a non-empty string");
  }
  if (!providerInstance || typeof providerInstance.extractFromImage !== "function") {
    throw new Error("Provider must implement extractFromImage()");
  }
  providers.set(name, providerInstance);
  if (!defaultProvider) defaultProvider = providerInstance;
}

export function getOcrProvider(name = null) {
  const providerName = name ?? process.env.RAG_OCR_PROVIDER ?? null;
  if (providerName) {
    const p = providers.get(providerName);
    if (!p) throw new Error(`OCR provider "${providerName}" not registered`);
    return p;
  }
  return defaultProvider || new NoopOcrProvider();
}

export function setDefaultOcrProvider(name) {
  const p = providers.get(name);
  if (!p) throw new Error(`OCR provider "${name}" not registered`);
  defaultProvider = p;
}

export function listOcrProviders() {
  return Array.from(providers.keys());
}

/**
 * Reset registry (for testing only). Not for production use.
 */
export function _clearOcrProvidersForTesting() {
  providers.clear();
  defaultProvider = null;
}
