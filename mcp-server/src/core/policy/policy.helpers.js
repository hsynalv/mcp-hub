/**
 * Policy Helpers
 *
 * Common policy helper functions for plugins.
 * Provides convenient shortcuts for common authorization checks.
 */

import {
  authorize,
  isAllowed,
  isDenied,
  requireAuth,
  getPolicyManager,
} from "./policy.manager.js";
import { PolicyCodes, allow, deny } from "./policy.result.js";

/**
 * @typedef {import("./policy.interface.js").PolicyContext} PolicyContext
 * @typedef {import("./policy.result.js").PolicyResult} PolicyResult
 */

/**
 * Check if actor can read from a resource
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} [params.resourceType] - Resource type
 * @param {string} [params.resourceId] - Resource ID
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canRead(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: params.plugin || "unknown",
    action: params.action || "read",
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    scope: "read",
    readonly: true,
    metadata: params.metadata,
  });
}

/**
 * Check if actor can write to a resource
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} [params.resourceType] - Resource type
 * @param {string} [params.resourceId] - Resource ID
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canWrite(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: params.plugin || "unknown",
    action: params.action || "write",
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    scope: "write",
    metadata: params.metadata,
  });
}

/**
 * Check if actor can delete a resource
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} [params.resourceType] - Resource type
 * @param {string} [params.resourceId] - Resource ID
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canDelete(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: params.plugin || "unknown",
    action: params.action || "delete",
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    scope: "admin",
    destructive: true,
    metadata: params.metadata,
  });
}

/**
 * Check if actor can execute shell commands
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} [params.command] - Command to execute
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canExecute(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "shell",
    action: "execute",
    scope: "admin",
    destructive: true,
    metadata: {
      command: params.command,
      ...params.metadata,
    },
  });
}

/**
 * Check if actor can resolve secrets
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} [params.secretName] - Secret name
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canResolveSecret(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "secrets",
    action: "resolve",
    scope: "admin",
    metadata: {
      secretName: params.secretName,
      ...params.metadata,
    },
  });
}

/**
 * Check if actor can query LLM
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} [params.model] - Model name
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canQueryLLM(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "llm-router",
    action: "query",
    scope: "write",
    metadata: {
      model: params.model,
      ...params.metadata,
    },
  });
}

/**
 * Check if actor can query RAG
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canQueryRag(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "rag",
    action: "search",
    scope: "read",
    readonly: true,
    metadata: params.metadata,
  });
}

/**
 * Check if actor can ingest into RAG
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canIngestRag(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "rag",
    action: "ingest",
    scope: "write",
    metadata: params.metadata,
  });
}

/**
 * Check if actor can modify workspace
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} [params.action] - Specific action
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canModifyWorkspace(params) {
  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "workspace",
    action: params.action || "modify",
    scope: "admin",
    destructive: ["delete", "archive", "clear"].includes(params.action),
    metadata: params.metadata,
  });
}

/**
 * Check if actor can access database
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} params.action - Database action (query, insert, update, delete)
 * @param {string} [params.table] - Table name
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canAccessDatabase(params) {
  const isWrite = /insert|update|delete|drop|create|truncate/i.test(params.action);
  const isDestructive = /delete|drop|truncate/i.test(params.action);

  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "database",
    action: params.action,
    scope: isWrite ? "write" : "read",
    destructive: isDestructive,
    metadata: {
      table: params.table,
      ...params.metadata,
    },
  });
}

/**
 * Check if actor can access file storage
 * @param {Object} params
 * @param {string} params.actor - Actor identifier
 * @param {string} params.workspaceId - Workspace ID
 * @param {string} params.action - File action (read, write, delete)
 * @param {string} [params.path] - File path
 * @param {Object} [params.metadata] - Additional metadata
 * @returns {Promise<PolicyResult>}
 */
export async function canAccessFileStorage(params) {
  const isDestructive = /delete|remove|unlink|rmdir/i.test(params.action);

  return await authorize({
    actor: params.actor,
    workspaceId: params.workspaceId,
    plugin: "file-storage",
    action: params.action,
    path: params.path,
    scope: isDestructive ? "admin" : params.action === "read" ? "read" : "write",
    destructive: isDestructive,
    metadata: params.metadata,
  });
}

/**
 * Require read permission or throw
 * @param {Object} params
 * @throws {Error} If not authorized
 */
export async function requireRead(params) {
  const result = await canRead(params);
  if (!result.allowed) {
    const error = new Error(result.reason || "Read permission required");
    error.code = result.code || PolicyCodes.DENIED_DEFAULT;
    error.status = 403;
    throw error;
  }
  return result;
}

/**
 * Require write permission or throw
 * @param {Object} params
 * @throws {Error} If not authorized
 */
export async function requireWrite(params) {
  const result = await canWrite(params);
  if (!result.allowed) {
    const error = new Error(result.reason || "Write permission required");
    error.code = result.code || PolicyCodes.DENIED_DEFAULT;
    error.status = 403;
    throw error;
  }
  return result;
}

/**
 * Require delete permission or throw
 * @param {Object} params
 * @throws {Error} If not authorized
 */
export async function requireDelete(params) {
  const result = await canDelete(params);
  if (!result.allowed) {
    const error = new Error(result.reason || "Delete permission required");
    error.code = result.code || PolicyCodes.DENIED_DESTRUCTIVE_ACTION;
    error.status = 403;
    throw error;
  }
  return result;
}

/**
 * Require execute permission or throw
 * @param {Object} params
 * @throws {Error} If not authorized
 */
export async function requireExecute(params) {
  const result = await canExecute(params);
  if (!result.allowed) {
    const error = new Error(result.reason || "Execute permission required");
    error.code = result.code || PolicyCodes.DENIED_SHELL_EXECUTION;
    error.status = 403;
    throw error;
  }
  return result;
}

/**
 * Check permission and return boolean
 * @param {Function} checkFn - Permission check function
 * @param {Object} params - Check parameters
 * @returns {Promise<boolean>}
 */
async function checkPermission(checkFn, params) {
  const result = await checkFn(params);
  return result.allowed;
}

// Export boolean versions
export const canReadBool = (params) => checkPermission(canRead, params);
export const canWriteBool = (params) => checkPermission(canWrite, params);
export const canDeleteBool = (params) => checkPermission(canDelete, params);
export const canExecuteBool = (params) => checkPermission(canExecute, params);
export const canResolveSecretBool = (params) => checkPermission(canResolveSecret, params);
export const canQueryLLMBool = (params) => checkPermission(canQueryLLM, params);
export const canQueryRagBool = (params) => checkPermission(canQueryRag, params);
export const canIngestRagBool = (params) => checkPermission(canIngestRag, params);
export const canModifyWorkspaceBool = (params) => checkPermission(canModifyWorkspace, params);
export const canAccessDatabaseBool = (params) => checkPermission(canAccessDatabase, params);
export const canAccessFileStorageBool = (params) => checkPermission(canAccessFileStorage, params);
