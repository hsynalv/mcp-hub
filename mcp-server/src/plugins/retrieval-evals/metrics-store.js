/**
 * Evaluation Metrics Store
 * Holds recent evaluation results for observability integration.
 */

const recentRuns = [];
const MAX_RECENT = 50;

/**
 * @param {Object} run - Evaluation run result
 */
export function recordEvalRun(run) {
  recentRuns.unshift({
    ...run,
    recordedAt: new Date().toISOString(),
  });
  if (recentRuns.length > MAX_RECENT) recentRuns.pop();
}

/**
 * @returns {Object[]} Recent evaluation runs
 */
export function getRecentEvalRuns() {
  return [...recentRuns];
}

/**
 * @returns {Object} Summary for observability
 */
export function getEvalMetricsSummary() {
  if (recentRuns.length === 0) {
    return { runs: 0, lastRun: null };
  }
  const last = recentRuns[0];
  const strategies = [...new Set(recentRuns.flatMap((r) => (Array.isArray(r) ? r.map((s) => s.strategy) : [r.strategy || "single"])))];
  return {
    runs: recentRuns.length,
    lastRun: last.recordedAt || last.timestamp,
    strategies: strategies.slice(0, 10),
  };
}
