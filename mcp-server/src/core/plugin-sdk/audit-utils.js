/**
 * Plugin SDK - Audit Logging Utilities
 *
 * Consistent audit logging for plugin operations.
 */

import { auditLog, getAuditManager, generateCorrelationId } from "../audit/index.js";

/**
 * Create an audit helper for a plugin.
 * @param {string} pluginName - Plugin identifier
 * @returns {Object} Audit helper
 */
export function createAuditHelper(pluginName) {
  return {
    /**
     * Log an operation (success or failure).
     * @param {Object} params
     * @param {string} params.operation - Operation name
     * @param {string} [params.actor] - Actor identifier
     * @param {string} [params.workspaceId] - Workspace ID
     * @param {boolean} [params.success] - Whether operation succeeded
     * @param {boolean} [params.allowed] - Whether operation was allowed
     * @param {number} [params.durationMs] - Duration in ms
     * @param {string} [params.error] - Error message if failed
     * @param {string} [params.reason] - Denial reason if not allowed
     * @param {Object} [params.metadata] - Additional metadata
     */
    async log(params) {
      try {
        await auditLog({
          plugin: pluginName,
          operation: params.operation,
          actor: params.actor || "anonymous",
          workspaceId: params.workspaceId || "global",
          projectId: params.projectId || null,
          correlationId: params.correlationId || generateCorrelationId(),
          allowed: params.allowed ?? params.success ?? true,
          success: params.success ?? true,
          durationMs: params.durationMs || 0,
          error: params.error,
          reason: params.reason,
          metadata: params.metadata,
        });
      } catch {
        /* never crash on audit failure */
      }
    },

    /**
     * Get recent audit entries for this plugin.
     * @param {Object} [options]
     * @param {number} [options.limit=100]
     * @param {string} [options.operation]
     * @param {string} [options.workspaceId]
     */
    async getRecent(options = {}) {
      const manager = getAuditManager();
      if (!manager?.getRecentEntries) return [];
      return manager.getRecentEntries({ plugin: pluginName, ...options });
    },

    generateCorrelationId,
  };
}
