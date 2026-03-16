/**
 * Retrieval Evaluation Metrics
 */

/**
 * Hit@k: 1 if any expected result in top-k, else 0
 * @param {string[]} retrievedIds - Retrieved chunk/document IDs (ordered)
 * @param {string[]} expectedIds - Expected relevant IDs
 * @param {number} k
 * @returns {number} 0 or 1
 */
export function hitAtK(retrievedIds, expectedIds, k = 5) {
  const topK = retrievedIds.slice(0, k);
  const expectedSet = new Set(normalizeIds(expectedIds));
  return topK.some((id) => expectedSet.has(id) || matchesChunkId(id, expectedSet)) ? 1 : 0;
}

/**
 * Recall@k: proportion of expected results found in top-k
 * @param {string[]} retrievedIds
 * @param {string[]} expectedIds
 * @param {number} k
 * @returns {number} 0-1
 */
export function recallAtK(retrievedIds, expectedIds, k = 5) {
  const topK = retrievedIds.slice(0, k);
  const expectedSet = new Set(normalizeIds(expectedIds));
  let hits = 0;
  for (const exp of expectedSet) {
    if (topK.some((id) => id === exp || chunkIdMatches(id, exp))) hits++;
  }
  return expectedSet.size === 0 ? 0 : hits / expectedSet.size;
}

/**
 * Mean Reciprocal Rank: 1/rank of first relevant result
 * @param {string[]} retrievedIds
 * @param {string[]} expectedIds
 * @returns {number} 0-1, or 0 if no hit
 */
export function reciprocalRank(retrievedIds, expectedIds) {
  const expectedSet = new Set(normalizeIds(expectedIds));
  for (let i = 0; i < retrievedIds.length; i++) {
    const id = retrievedIds[i];
    if (expectedSet.has(id) || [...expectedSet].some((e) => chunkIdMatches(id, e))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Chunk coverage: proportion of expected chunks that appear in retrieved set
 * @param {string[]} retrievedIds
 * @param {string[]} expectedIds
 * @returns {number} 0-1
 */
export function chunkCoverage(retrievedIds, expectedIds) {
  if (expectedIds.length === 0) return 0;
  const retrievedSet = new Set(retrievedIds);
  const expectedSet = new Set(normalizeIds(expectedIds));
  let covered = 0;
  for (const exp of expectedSet) {
    if (retrievedSet.has(exp) || retrievedIds.some((id) => chunkIdMatches(id, exp))) covered++;
  }
  return covered / expectedSet.size;
}

function normalizeIds(ids) {
  return (ids || []).filter(Boolean);
}

function chunkIdMatches(retrievedId, expectedId) {
  if (retrievedId === expectedId) return true;
  if (expectedId.includes("--chunk-")) return retrievedId === expectedId;
  if (retrievedId.startsWith(expectedId + "--chunk-")) return true;
  return false;
}

function matchesChunkId(id, expectedSet) {
  for (const exp of expectedSet) {
    if (chunkIdMatches(id, exp)) return true;
  }
  return false;
}
