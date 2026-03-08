/**
 * Tool Hooks
 *
 * Extension points for plugins to intercept and modify tool execution.
 * This allows policy systems and other plugins to hook into the tool
 * lifecycle without core depending on plugin-specific logic.
 *
 * Architecture:
 *   - Core provides hook registration
 *   - Plugins register handlers at startup
 *   - Tool registry calls hooks during execution lifecycle
 */

const beforeExecutionHooks = [];
const afterExecutionHooks = [];

/**
 * Register a hook to run before tool execution.
 * Hook can return a result to short-circuit execution.
 *
 * @param {Function} hook - Async function(toolName, args, context)
 *   @returns {Object|null} - Return { ok: false, ... } to block execution,
 *                            or null/undefined to continue
 */
export function registerBeforeExecutionHook(hook) {
  if (typeof hook !== "function") {
    throw new Error("Hook must be a function");
  }
  beforeExecutionHooks.push(hook);
}

/**
 * Register a hook to run after tool execution.
 *
 * @param {Function} hook - Async function(toolName, args, context, result)
 */
export function registerAfterExecutionHook(hook) {
  if (typeof hook !== "function") {
    throw new Error("Hook must be a function");
  }
  afterExecutionHooks.push(hook);
}

/**
 * Execute all before-execution hooks.
 * Returns first blocking result, or null if all pass.
 *
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} context
 * @returns {Object|null} Blocking result or null
 */
export async function executeBeforeHooks(toolName, args, context) {
  for (const hook of beforeExecutionHooks) {
    try {
      const result = await hook(toolName, args, context);
      if (result && result.ok === false) {
        return result; // Hook blocked execution
      }
    } catch (err) {
      console.error(`[tool-hooks] Before-hook error for ${toolName}:`, err.message);
      // Continue to next hook, don't block on hook error
    }
  }
  return null;
}

/**
 * Execute all after-execution hooks.
 *
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} context
 * @param {Object} result
 */
export async function executeAfterHooks(toolName, args, context, result) {
  for (const hook of afterExecutionHooks) {
    try {
      await hook(toolName, args, context, result);
    } catch (err) {
      console.error(`[tool-hooks] After-hook error for ${toolName}:`, err.message);
      // Don't fail tool execution due to hook error
    }
  }
}

/**
 * Clear all registered hooks (useful for testing).
 */
export function clearHooks() {
  beforeExecutionHooks.length = 0;
  afterExecutionHooks.length = 0;
}

/**
 * Get count of registered hooks (for diagnostics).
 */
export function getHookCounts() {
  return {
    beforeExecution: beforeExecutionHooks.length,
    afterExecution: afterExecutionHooks.length,
  };
}
