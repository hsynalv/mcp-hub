/**
 * Resilience Utilities
 *
 * Retry logic with exponential backoff and circuit breaker pattern
 * for external service calls (GitHub, Notion, OpenAI)
 */

// Circuit breaker states
const CircuitState = {
  CLOSED: "CLOSED",     // Normal operation
  OPEN: "OPEN",       // Failing fast
  HALF_OPEN: "HALF_OPEN", // Testing if recovered
};

// Circuit breaker registry
const circuits = new Map();

/**
 * Get or create circuit breaker
 * @param {string} name - Circuit name (e.g., 'github', 'notion')
 * @param {Object} options - Circuit options
 */
export function getCircuitBreaker(name, options = {}) {
  if (circuits.has(name)) {
    return circuits.get(name);
  }

  const circuit = createCircuitBreaker(name, options);
  circuits.set(name, circuit);
  return circuit;
}

/**
 * Create a new circuit breaker
 */
function createCircuitBreaker(name, options = {}) {
  const {
    failureThreshold = 5,
    resetTimeoutMs = 30000,
    halfOpenMaxCalls = 3,
  } = options;

  let state = CircuitState.CLOSED;
  let failureCount = 0;
  let successCount = 0;
  let lastFailureTime = null;
  let nextAttempt = Date.now();

  return {
    name,

    async execute(fn) {
      if (state === CircuitState.OPEN) {
        if (Date.now() < nextAttempt) {
          throw new CircuitBreakerError(
            `Circuit '${name}' is OPEN. Try again after ${new Date(nextAttempt).toISOString()}`,
            { circuit: name, state, nextAttempt }
          );
        }
        // Transition to half-open
        state = CircuitState.HALF_OPEN;
        successCount = 0;
        console.error(`[CircuitBreaker] '${name}' transitioned to HALF_OPEN`);
      }

      try {
        const result = await fn();
        onSuccess();
        return result;
      } catch (error) {
        onFailure();
        throw error;
      }
    },

    getState() {
      return {
        name,
        state,
        failureCount,
        successCount,
        lastFailureTime,
        nextAttempt: state === CircuitState.OPEN ? nextAttempt : null,
      };
    },
  };

  function onSuccess() {
    if (state === CircuitState.HALF_OPEN) {
      successCount++;
      if (successCount >= halfOpenMaxCalls) {
        // Transition to closed
        state = CircuitState.CLOSED;
        failureCount = 0;
        console.error(`[CircuitBreaker] '${name}' transitioned to CLOSED`);
      }
    } else {
      failureCount = 0;
    }
  }

  function onFailure() {
    failureCount++;
    lastFailureTime = Date.now();

    if (state === CircuitState.HALF_OPEN || failureCount >= failureThreshold) {
      // Transition to open
      state = CircuitState.OPEN;
      nextAttempt = Date.now() + resetTimeoutMs;
      console.error(
        `[CircuitBreaker] '${name}' transitioned to OPEN. Next attempt at ${new Date(nextAttempt).toISOString()}`
      );
    }
  }
}

/**
 * Circuit breaker error class
 */
export class CircuitBreakerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CircuitBreakerError";
    this.code = "CIRCUIT_OPEN";
    this.details = details;
  }
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 */
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    backoffMs = 1000,
    maxBackoffMs = 30000,
    retryableError = () => true,
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!retryableError(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate backoff with jitter
      const delay = Math.min(
        backoffMs * Math.pow(2, attempt - 1) + Math.random() * 1000,
        maxBackoffMs
      );

      console.error(
        `[Retry] Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${Math.round(delay)}ms...`
      );

      if (onRetry) {
        onRetry({ attempt, error, delay });
      }

      await sleep(delay);
    }
  }

  // All attempts failed
  const retryError = new Error(
    `All ${maxAttempts} attempts failed. Last error: ${lastError.message}`
  );
  retryError.name = "RetryExhaustedError";
  retryError.code = "RETRY_EXHAUSTED";
  retryError.cause = lastError;
  retryError.attempts = maxAttempts;
  throw retryError;
}

/**
 * Combined resilience wrapper (circuit breaker + retry)
 * @param {string} circuitName - Circuit breaker name
 * @param {Function} fn - Function to execute
 * @param {Object} options - Options for both circuit and retry
 */
export async function withResilience(circuitName, fn, options = {}) {
  const circuit = getCircuitBreaker(circuitName, options.circuit);

  return circuit.execute(async () => {
    return withRetry(fn, options.retry);
  });
}

/**
 * Get all circuit states (for health check)
 */
export function getAllCircuitStates() {
  const states = {};
  for (const [name, circuit] of circuits) {
    states[name] = circuit.getState();
  }
  return states;
}

/**
 * Reset a specific circuit (for manual recovery)
 */
export function resetCircuit(name) {
  circuits.delete(name);
  console.error(`[CircuitBreaker] '${name}' has been reset`);
}

/**
 * Reset all circuits
 */
export function resetAllCircuits() {
  circuits.clear();
  console.error("[CircuitBreaker] All circuits have been reset");
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
