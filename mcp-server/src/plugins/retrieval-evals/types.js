/**
 * Retrieval Evaluation Types
 */

/**
 * @typedef {Object} EvalRunResult
 * @property {string} datasetName
 * @property {number} queryCount
 * @property {number} k
 * @property {Object} metrics
 * @property {number} metrics.hitAtK
 * @property {number} metrics.recallAtK
 * @property {number} metrics.mrr
 * @property {number} metrics.chunkCoverage
 * @property {number} metrics.latencyMsMean
 * @property {Object[]} queryResults
 * @property {string} timestamp
 */

/**
 * @typedef {Object} StrategyComparisonResult
 * @property {string} strategy
 * @property {EvalRunResult} result
 * @property {Object} [latencyByStage]
 */
