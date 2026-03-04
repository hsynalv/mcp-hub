/**
 * Storage adapter interface.
 * All adapters must implement: list, read, write, delete, copy, move.
 */

const BACKENDS = ["s3", "gdrive", "local"];

export function getAdapter(backend) {
  if (!BACKENDS.includes(backend)) return null;
  switch (backend) {
    case "s3":     return import("./adapters/s3.js").then((m) => m.default);
    case "gdrive": return import("./adapters/gdrive.js").then((m) => m.default);
    case "local":  return import("./adapters/local.js").then((m) => m.default);
    default:       return null;
  }
}

export function isValidBackend(backend) {
  return BACKENDS.includes(backend);
}

/**
 * Sanitize path — prevent traversal and absolute paths.
 */
export function sanitizePath(path) {
  if (!path || typeof path !== "string") return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (normalized.includes("..") || normalized.startsWith("/")) return null;
  return normalized || ".";
}
