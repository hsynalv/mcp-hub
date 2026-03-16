/**
 * Evaluation Dataset Schema
 *
 * Format for retrieval evaluation datasets.
 */

import { z } from "zod";

export const DocumentSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional(),
});

export const QuerySchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  expectedChunkIds: z.array(z.string()).optional(),
  expectedDocumentIds: z.array(z.string()).optional(),
  expectedReferences: z.array(z.string()).optional(),
});

export const EvalDatasetSchema = z.object({
  version: z.string().default("1.0"),
  name: z.string().optional(),
  documents: z.array(DocumentSchema).min(1),
  queries: z.array(QuerySchema).min(1),
});

/**
 * @typedef {z.infer<typeof EvalDatasetSchema>} EvalDataset
 * @typedef {z.infer<typeof DocumentSchema>} EvalDocument
 * @typedef {z.infer<typeof QuerySchema>} EvalQuery
 */
