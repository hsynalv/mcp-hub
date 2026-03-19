/**
 * Bound async execution time for tool handlers.
 */

/**
 * @param {Promise<*>} promise
 * @param {number} ms - Max wait in ms; 0 or negative disables the timeout.
 * @param {{ code?: string, message?: string }} [opts]
 * @returns {Promise<*>}
 */
export function withTimeout(promise, ms, opts = {}) {
  const code = opts.code || "tool_timeout";
  const message = opts.message || `Tool execution exceeded ${ms}ms`;

  if (!ms || ms <= 0) {
    return promise;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(message);
      err.code = code;
      reject(err);
    }, ms);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
}
