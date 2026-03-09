/**
 * Tenant Validation
 *
 * Validation and sanitization for tenant/workspace/project identifiers.
 */

/**
 * Maximum identifier length
 */
const MAX_ID_LENGTH = 128;

/**
 * Valid identifier pattern
 * - Alphanumeric, underscore, hyphen
 * - No path traversal
 * - No special characters
 */
const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate tenant ID
 * @param {string} tenantId
 * @returns {import("./tenant.types.js").ValidationResult}
 */
export function validateTenantId(tenantId) {
  return validateIdentifier(tenantId, "tenantId");
}

/**
 * Validate workspace ID
 * @param {string} workspaceId
 * @returns {import("./tenant.types.js").ValidationResult}
 */
export function validateWorkspaceId(workspaceId) {
  return validateIdentifier(workspaceId, "workspaceId");
}

/**
 * Validate project ID
 * @param {string} projectId
 * @returns {import("./tenant.types.js").ValidationResult}
 */
export function validateProjectId(projectId) {
  return validateIdentifier(projectId, "projectId");
}

/**
 * Validate any identifier
 * @param {string} id
 * @param {string} fieldName
 * @returns {import("./tenant.types.js").ValidationResult}
 */
function validateIdentifier(id, fieldName) {
  const errors = [];
  const warnings = [];

  if (!id) {
    return { valid: false, errors: [`${fieldName} is required`], warnings: [] };
  }

  if (typeof id !== "string") {
    return { valid: false, errors: [`${fieldName} must be a string`], warnings: [] };
  }

  // Check empty
  if (id.trim().length === 0) {
    errors.push(`${fieldName} cannot be empty`);
  }

  // Check length
  if (id.length > MAX_ID_LENGTH) {
    errors.push(`${fieldName} exceeds maximum length (${MAX_ID_LENGTH})`);
  }

  // Check for path traversal attempts
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    errors.push(`${fieldName} contains path traversal characters`);
  }

  // Check for null bytes
  if (id.includes("\0")) {
    errors.push(`${fieldName} contains null bytes`);
  }

  // Check for control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(id)) {
    errors.push(`${fieldName} contains control characters`);
  }

  // Check pattern
  if (!VALID_ID_PATTERN.test(id)) {
    errors.push(`${fieldName} contains invalid characters (use only a-z, A-Z, 0-9, _, -)`);
  }

  // Warnings for common issues
  if (id.startsWith("-") || id.endsWith("-")) {
    warnings.push(`${fieldName} starts or ends with hyphen`);
  }

  if (id.startsWith("_") || id.endsWith("_")) {
    warnings.push(`${fieldName} starts or ends with underscore`);
  }

  if (id.length < 3) {
    warnings.push(`${fieldName} is very short`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Sanitize tenant identifier
 * Removes dangerous characters, normalizes
 * @param {string} id
 * @returns {string | null} - Sanitized ID or null if invalid
 */
export function sanitizeTenantIdentifier(id) {
  if (!id || typeof id !== "string") {
    return null;
  }

  // Trim whitespace
  let sanitized = id.trim();

  // Remove control characters
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "");

  // Remove path traversal attempts
  sanitized = sanitized.replace(/[.\/\\]/g, "");

  // Keep only valid characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, "");

  // Check if result is valid
  if (sanitized.length === 0 || sanitized.length > MAX_ID_LENGTH) {
    return null;
  }

  return sanitized;
}

/**
 * Check if identifier is valid (quick boolean check)
 * @param {string} id
 * @returns {boolean}
 */
export function isValidTenantIdentifier(id) {
  if (!id || typeof id !== "string") return false;

  return id.length > 0 &&
    id.length <= MAX_ID_LENGTH &&
    VALID_ID_PATTERN.test(id) &&
    !id.includes("..") &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1F\x7F]/.test(id);
}

/**
 * Assert identifier is valid (throws if not)
 * @param {string} id
 * @param {string} fieldName
 * @throws {Error}
 */
export function assertValidIdentifier(id, fieldName = "identifier") {
  const validation = validateIdentifier(id, fieldName);

  if (!validation.valid) {
    throw new Error(`Invalid ${fieldName}: ${validation.errors.join(", ")}`);
  }
}

/**
 * Assert tenant ID is valid
 * @param {string} tenantId
 * @throws {Error}
 */
export function assertValidTenantId(tenantId) {
  assertValidIdentifier(tenantId, "tenantId");
}

/**
 * Assert workspace ID is valid
 * @param {string} workspaceId
 * @throws {Error}
 */
export function assertValidWorkspaceId(workspaceId) {
  assertValidIdentifier(workspaceId, "workspaceId");
}

/**
 * Assert project ID is valid
 * @param {string} projectId
 * @throws {Error}
 */
export function assertValidProjectId(projectId) {
  assertValidIdentifier(projectId, "projectId");
}

/**
 * Validate tenant/workspace/project hierarchy
 * @param {Object} params
 * @param {string} [params.tenantId]
 * @param {string} [params.workspaceId]
 * @param {string} [params.projectId]
 * @returns {import("./tenant.types.js").ValidationResult}
 */
export function validateHierarchy(params) {
  const errors = [];
  const warnings = [];

  // If projectId provided, workspaceId and tenantId should be provided
  if (params.projectId) {
    if (!params.workspaceId) {
      errors.push("workspaceId is required when projectId is provided");
    }
    if (!params.tenantId) {
      errors.push("tenantId is required when projectId is provided");
    }
  }

  // If workspaceId provided, tenantId should be provided
  if (params.workspaceId && !params.tenantId) {
    errors.push("tenantId is required when workspaceId is provided");
  }

  // Validate each ID if provided
  if (params.tenantId) {
    const t = validateTenantId(params.tenantId);
    if (!t.valid) errors.push(...t.errors);
    if (t.warnings.length) warnings.push(...t.warnings);
  }

  if (params.workspaceId) {
    const w = validateWorkspaceId(params.workspaceId);
    if (!w.valid) errors.push(...w.errors);
    if (w.warnings.length) warnings.push(...w.warnings);
  }

  if (params.projectId) {
    const p = validateProjectId(params.projectId);
    if (!p.valid) errors.push(...p.errors);
    if (p.warnings.length) warnings.push(...p.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Generate a valid identifier from input
 * @param {string} input
 * @param {string} [prefix]
 * @returns {string | null}
 */
export function generateValidIdentifier(input, prefix = "") {
  if (!input || typeof input !== "string") {
    return null;
  }

  // Sanitize
  let id = sanitizeTenantIdentifier(input);
  if (!id) return null;

  // Add prefix
  if (prefix) {
    id = `${prefix}_${id}`;
  }

  // Ensure length
  if (id.length > MAX_ID_LENGTH) {
    id = id.substring(0, MAX_ID_LENGTH);
  }

  return id;
}
