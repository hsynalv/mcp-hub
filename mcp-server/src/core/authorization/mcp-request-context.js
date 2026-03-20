/**
 * Per-request context for MCP JSON-RPC when the server instance is shared (HTTP transport).
 * listTools / handlers read the store to apply the same authorization model as the outer request.
 */

import { AsyncLocalStorage } from "async_hooks";

const storage = new AsyncLocalStorage();

/**
 * @typedef {Object} McpRequestStore
 * @property {object} authInfo
 * @property {string} [correlationId]
 */

/**
 * @param {McpRequestStore} store
 * @param {function(): Promise<T> | T} fn
 * @returns {Promise<T> | T}
 */
export function runWithMcpRequestContext(store, fn) {
  return storage.run(store, fn);
}

/** @returns {McpRequestStore | undefined} */
export function getMcpRequestContext() {
  return storage.getStore();
}
