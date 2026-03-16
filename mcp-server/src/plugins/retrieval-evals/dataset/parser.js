/**
 * Dataset Parser
 * Validates and parses evaluation datasets.
 */

import { EvalDatasetSchema } from "./schema.js";

/**
 * @param {unknown} data - Raw dataset (object or JSON string)
 * @returns {{ valid: boolean, dataset?: EvalDataset, errors?: string[] }}
 */
export function parseDataset(data) {
  let parsed = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      return { valid: false, errors: [`Invalid JSON: ${e.message}`] };
    }
  }

  const result = EvalDatasetSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
    return { valid: false, errors };
  }

  const dataset = result.data;
  const validationErrors = validateDataset(dataset);
  if (validationErrors.length > 0) {
    return { valid: false, errors: validationErrors };
  }

  return { valid: true, dataset };
}

function validateDataset(dataset) {
  const errors = [];

  for (const q of dataset.queries) {
    const refs = q.expectedChunkIds || q.expectedDocumentIds || q.expectedReferences || [];
    if (refs.length === 0) {
      errors.push(`Query "${q.id}" has no expected results (expectedChunkIds, expectedDocumentIds, or expectedReferences)`);
    }
  }

  return errors;
}
