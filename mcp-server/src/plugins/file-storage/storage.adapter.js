/**
 * Storage adapter interface with production-hardened security.
 * All adapters must implement: list, read, write, delete, copy, move.
 */

const BACKENDS = ["s3", "gdrive", "local"];

// Sensitive file patterns - blocked for read/write/delete operations
const SENSITIVE_PATTERNS = [
  // Environment files
  /^\.env$/i,
  /^\.env\./i,
  // SSH keys
  /\.ssh\//i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_ecdsa/i,
  /id_dsa/i,
  /authorized_keys/i,
  /known_hosts/i,
  // Private keys and certificates
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.crt$/i,
  /\.cer$/i,
  // AWS/GCP/Azure credentials
  /aws\/credentials/i,
  /aws\/config/i,
  /\.aws\//i,
  /\.gcp\//i,
  /google.*credentials/i,
  /azure.*credentials/i,
  /service.*account.*key/i,
  // Database credentials
  /database\.yml$/i,
  /secrets\.yml$/i,
  /secrets\.json$/i,
  /credentials\.json$/i,
  /passwd$/i,
  /shadow$/i,
  // System files
  /\/etc\//i,
  /\.htpasswd$/i,
  /\.htaccess$/i,
  /\.bash_history/i,
  /\.zsh_history/i,
  /\.ssh_history/i,
  /history$/i,
  // Config files with secrets
  /config\.json$/i,
  /config\.yml$/i,
  /config\.yaml$/i,
  /application\.yml$/i,
  /application\.properties$/i,
  /\.docker\/config\.json$/i,
  /\.kube\/config$/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
  /\.gitconfig$/i,
  /\.git-credentials$/i,
  /token$/i,
  /api.*key/i,
  /secret/i,
];

// Maximum file size (configurable via env)
const MAX_FILE_SIZE_BYTES = parseInt(process.env.FILE_STORAGE_MAX_SIZE_BYTES || "52428800", 10); // 50MB default
const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

// Audit log (in-memory sink, can be extended to persistent storage)
const auditLog = [];
const MAX_AUDIT_LOG_SIZE = 10000;

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
 * URL decode path to catch encoded traversal attempts
 */
function urlDecodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Sanitize path — prevent traversal, absolute paths, and encoded attacks.
 * Returns null for unsafe paths.
 */
export function sanitizePath(path) {
  if (!path || typeof path !== "string") return ".";

  // URL decode to catch %2e%2e%2f style attacks
  let normalized = urlDecodePath(path);

  // Convert backslashes and normalize multiple slashes
  normalized = normalized.replace(/\\/g, "/").replace(/\/+/g, "/").trim();

  // Re-check after decoding for double-encoded attacks
  let decoded = urlDecodePath(normalized);
  while (decoded !== normalized) {
    normalized = decoded;
    decoded = urlDecodePath(normalized);
  }

  // Block path traversal attempts
  if (normalized.includes("..")) return null;

  // Block absolute paths
  if (normalized.startsWith("/")) return null;

  // Block Windows absolute paths (C:\, D:\, etc.)
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) return null;

  // Block null bytes and control characters
  const controlChars = "\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\u000a\u000b\u000c\u000d\u000e\u000f" +
    "\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f";
  for (const char of normalized) {
    if (controlChars.includes(char)) return null;
  }

  // Block paths that try to use // to escape (after normalization should be caught, but double-check)
  if (normalized.startsWith("//")) return null;

  return normalized || ".";
}

/**
 * Check if a file path is sensitive and should be blocked
 */
export function isSensitiveFile(path) {
  if (!path || typeof path !== "string") return false;
  const normalizedPath = path.toLowerCase().replace(/\\/g, "/");
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(normalizedPath));
}

/**
 * Validate file size (content is base64 string)
 */
export function validateFileSize(contentBase64, maxBytes = MAX_FILE_SIZE_BYTES) {
  if (!contentBase64) return { valid: true, size: 0 };

  // Estimate decoded size: base64 is ~4/3 of binary size
  const estimatedBytes = Math.ceil((contentBase64.length * 3) / 4);

  if (estimatedBytes > maxBytes) {
    return {
      valid: false,
      size: estimatedBytes,
      maxBytes,
      maxMb: maxBytes / (1024 * 1024),
      reason: `File size ${(estimatedBytes / (1024 * 1024)).toFixed(2)}MB exceeds limit of ${maxBytes / (1024 * 1024)}MB`,
    };
  }

  return { valid: true, size: estimatedBytes };
}

/**
 * Check policy for file operations
 * Returns { allowed: boolean, reason?: string }
 */
export function checkFilePolicy(operation, path, _context = {}) {
  // Check if path is valid FIRST (before sensitive file check)
  const sanitized = sanitizePath(path);
  if (sanitized === null) {
    return {
      allowed: false,
      reason: "path_traversal",
      message: "Invalid path - path traversal detected",
    };
  }

  // Then check if sensitive file
  if (isSensitiveFile(path)) {
    return {
      allowed: false,
      reason: "sensitive_file",
      message: `Access to sensitive file '${path}' is not allowed`,
    };
  }

  // Check destructive operations if in readonly mode (configurable)
  const readonlyMode = process.env.FILE_STORAGE_READONLY === "true";
  const destructiveOps = ["write", "delete", "move", "copy"];
  if (readonlyMode && destructiveOps.includes(operation)) {
    return {
      allowed: false,
      reason: "readonly_mode",
      message: `File storage is in read-only mode. ${operation} operations are not allowed`,
    };
  }

  return { allowed: true };
}

/**
 * Add audit log entry
 */
export function auditEntry(entry) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation: entry.operation,
    path: entry.path,
    backend: entry.backend,
    allowed: entry.allowed,
    actor: entry.actor || null,
    workspaceId: entry.workspaceId || null,
    projectId: entry.projectId || null,
    correlationId: entry.correlationId || null,
    durationMs: entry.durationMs || null,
    sizeBytes: entry.sizeBytes || null,
    reason: entry.reason || null,
    error: entry.error || null,
  };

  auditLog.unshift(logEntry);
  if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
    auditLog.pop();
  }

  // Also log to console for visibility
  const status = entry.allowed ? "ALLOWED" : "DENIED";
  console.log(`[file-storage-audit] ${status} | ${entry.operation} | ${entry.path} | ${entry.reason || "ok"}`);

  return logEntry;
}

/**
 * Get recent audit log entries
 */
export function getAuditLogEntries(limit = 100) {
  return auditLog.slice(0, Math.min(limit, MAX_AUDIT_LOG_SIZE));
}

/**
 * Generate correlation ID
 */
export function generateCorrelationId() {
  return `fs-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Export constants for use in adapters/index.js
export { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB, SENSITIVE_PATTERNS };
