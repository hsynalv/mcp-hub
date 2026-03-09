/**
 * Audit Event Standard
 *
 * Defines the common audit event structure for all plugins.
 * All plugin operations should use this format for consistent audit logging.
 */

/**
 * @typedef {Object} AuditEvent
 *
 * Zorunlu alanlar:
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {string} plugin - Plugin name (e.g., 'shell', 'database', 'rag')
 * @property {string} operation - Operation type (e.g., 'execute', 'query', 'index', 'search')
 * @property {string} actor - Who performed the action (user ID, email, or 'anonymous')
 * @property {string} workspaceId - Workspace identifier
 * @property {string|null} projectId - Project identifier (optional)
 * @property {string} correlationId - Unique trace ID for request correlation
 * @property {boolean} allowed - Whether the operation was allowed by policy
 * @property {number} durationMs - Operation duration in milliseconds
 * @property {boolean} success - Whether the operation succeeded
 *
 * Opsiyonel alanlar:
 * @property {string} [reason] - Denial reason if not allowed
 * @property {string} [error] - Error message if failed
 * @property {Object} [metadata] - Sanitized metadata (no sensitive data)
 * @property {string} [resource] - Resource being accessed (e.g., file path, table name)
 * @property {string} [backend] - Backend type (e.g., 'postgresql', 'sqlite', 'qdrant')
 * @property {string} [provider] - Service provider (e.g., 'openai', 'anthropic')
 * @property {string} [model] - Model name (e.g., 'gpt-4', 'claude-3')
 * @property {number} [statusCode] - HTTP status code if applicable
 * @property {number} [sizeBytes] - Size of data processed
 * @property {number} [count] - Count of items processed
 */

/**
 * Sensitive field patterns that should NEVER be logged
 * These patterns are matched against keys in any object
 */
export const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /credential/i,
  /api.?key/i,
  /apikey/i,
  /auth/i,
  /private.?key/i,
  /passwd/i,
  /pwd/i,
  /content/i,        // Document/query full content
  /prompt/i,          // LLM prompts
  /embedding/i,       // Vector embeddings
  /vector/i,
  /raw.?data/i,
  /_id$/i,            // Internal IDs
  /internal.?id/i,
];

/**
 * Metadata fields allowlist - only these should be logged
 * Additional fields can be added per-plugin, but sensitive patterns always win
 */
export const METADATA_ALLOWLIST = [
  "sourceName",
  "sourceType",
  "title",
  "language",
  "tags",
  "createdAt",
  "updatedAt",
  "documentId",
  "chunkIndex",
  "totalChunks",
  "fileType",
  "fileName",      // Without path
  "tableName",
  "database",
  "operation",
  "commandType",
  "provider",
  "model",
  "temperature",
  "maxTokens",
];

/**
 * Check if a key matches any sensitive pattern
 * @param {string} key - The key to check
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  if (typeof key !== "string") return false;
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Sanitize an audit event to remove sensitive data
 * @param {AuditEvent} event - The event to sanitize
 * @param {Object} options - Sanitization options
 * @param {boolean} options.strict - If true, only allowlisted metadata passes
 * @returns {AuditEvent} - Sanitized event
 */
export function sanitizeAuditEvent(event, options = {}) {
  const { strict = true } = options;

  if (!event || typeof event !== "object") {
    return {};
  }

  const sanitized = {};

  // Copy required fields
  const requiredFields = [
    "timestamp", "plugin", "operation", "actor", "workspaceId",
    "correlationId", "allowed", "durationMs", "success",
  ];
  for (const field of requiredFields) {
    if (event[field] !== undefined) {
      sanitized[field] = event[field];
    }
  }

  // Copy optional safe fields
  const safeScalarFields = [
    "projectId", "reason", "error", "resource", "backend",
    "provider", "model", "statusCode", "sizeBytes", "count",
  ];
  for (const field of safeScalarFields) {
    if (event[field] !== undefined) {
      sanitized[field] = event[field];
    }
  }

  // Sanitize metadata if present
  if (event.metadata && typeof event.metadata === "object") {
    sanitized.metadata = {};
    for (const [key, value] of Object.entries(event.metadata)) {
      // Always skip sensitive keys
      if (isSensitiveKey(key)) {
        continue;
      }

      // In strict mode, only allowlisted keys
      if (strict && !METADATA_ALLOWLIST.includes(key)) {
        continue;
      }

      // Only include primitive values or safe arrays
      if (typeof value !== "object" || value === null) {
        sanitized.metadata[key] = value;
      } else if (Array.isArray(value)) {
        // Arrays of primitives only
        const safeArray = value.filter(item =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        );
        if (safeArray.length > 0) {
          sanitized.metadata[key] = safeArray;
        }
      }
      // Skip nested objects
    }
  }

  return sanitized;
}

/**
 * Validate an audit event has all required fields
 * @param {AuditEvent} event
 * @returns {string|null} - Error message if invalid, null if valid
 */
export function validateAuditEvent(event) {
  if (!event || typeof event !== "object") {
    return "Audit event must be an object";
  }

  const required = [
    "timestamp", "plugin", "operation", "actor", "workspaceId",
    "correlationId", "allowed", "durationMs", "success",
  ];

  for (const field of required) {
    if (event[field] === undefined) {
      return `Missing required field: ${field}`;
    }
  }

  // Type validations
  if (typeof event.timestamp !== "string") return "timestamp must be a string";
  if (typeof event.plugin !== "string") return "plugin must be a string";
  if (typeof event.operation !== "string") return "operation must be a string";
  if (typeof event.actor !== "string") return "actor must be a string";
  if (typeof event.workspaceId !== "string") return "workspaceId must be a string";
  if (typeof event.correlationId !== "string") return "correlationId must be a string";
  if (typeof event.allowed !== "boolean") return "allowed must be a boolean";
  if (typeof event.durationMs !== "number") return "durationMs must be a number";
  if (typeof event.success !== "boolean") return "success must be a boolean";

  return null;
}

/**
 * Generate a correlation ID for audit tracing
 * @returns {string}
 */
export function generateCorrelationId() {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
