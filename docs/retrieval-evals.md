# Retrieval Evaluation

Measure and compare RAG retrieval quality across different indexing and chunking strategies.

## Dataset Format

Evaluation datasets are JSON files with this structure:

```json
{
  "version": "1.0",
  "name": "my-eval",
  "documents": [
    {
      "id": "doc-1",
      "content": "Full document content...",
      "metadata": { "title": "Optional" }
    }
  ],
  "queries": [
    {
      "id": "q1",
      "query": "Search query text",
      "expectedChunkIds": ["doc-1--chunk-0", "doc-1--chunk-2"],
      "expectedDocumentIds": ["doc-1"],
      "expectedReferences": ["doc-1"]
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `documents` | Yes | Documents to index before evaluation |
| `queries` | Yes | Queries to run with expected results |
| `expectedChunkIds` | One of | Chunk IDs (e.g. `doc-1--chunk-0`) that should be retrieved |
| `expectedDocumentIds` | One of | Document IDs; any chunk from that doc counts |
| `expectedReferences` | One of | Flexible references (doc or chunk IDs) |

## Metrics

| Metric | Description |
|--------|-------------|
| **Hit@K** | 1 if any expected result in top-k, else 0 |
| **Recall@K** | Proportion of expected results found in top-k |
| **MRR** | Mean Reciprocal Rank: 1/rank of first relevant result |
| **Chunk Coverage** | Proportion of expected chunks in retrieved set |
| **Latency** | Mean query latency (ms) |

## Example Evaluation

### Via API

```bash
# Run single evaluation (documents must already be indexed)
curl -X POST http://localhost:8787/retrieval-evals/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "dataset": {
      "documents": [{"id": "d1", "content": "# Doc\nContent..."}],
      "queries": [{"id": "q1", "query": "search", "expectedDocumentIds": ["d1"]}]
    },
    "k": 5,
    "saveOutput": true
  }'

# Compare strategies (indexes with each strategy, then evaluates)
curl -X POST http://localhost:8787/retrieval-evals/compare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "dataset": "file:data/retrieval-eval-sample.json",
    "strategies": ["rag_direct", "rag_ingestion_heading", "rag_ingestion_sliding"],
    "k": 5,
    "saveOutput": true
  }'
```

### Via CLI

```bash
# Run evaluation (requires documents pre-indexed in retrieval-eval workspace)
node bin/run-retrieval-evals.js run data/retrieval-eval-sample.json

# Compare chunking strategies
node bin/run-retrieval-evals.js compare data/retrieval-eval-sample.json

# With options
node bin/run-retrieval-evals.js compare data/retrieval-eval-sample.json --strategies=rag_ingestion_fixed,rag_ingestion_heading --k=10
```

Or via npm scripts:

```bash
npm run eval:compare -- data/retrieval-eval-sample.json
npm run eval:run -- data/retrieval-eval-sample.json
```

## Comparing Chunking Strategies

Strategy comparison:

1. Indexes documents with each strategy in a dedicated workspace
2. Runs the same queries against each index
3. Computes metrics per strategy
4. Saves JSON + markdown summary

| Strategy | Description |
|----------|-------------|
| `rag_direct` | RAG plugin direct index (built-in chunking) |
| `rag_ingestion_fixed` | rag-ingestion with fixed-size chunks |
| `rag_ingestion_heading` | rag-ingestion with heading-aware chunks |
| `rag_ingestion_sliding` | rag-ingestion with sliding-window chunks |

## Output

Results are saved to `./cache/retrieval-evals/` (or `RETRIEVAL_EVAL_OUTPUT_DIR`):

- `*.json` — Full structured result
- `*.md` — Markdown summary table

## Observability

Evaluation runs are recorded. Metrics appear in `/observability/metrics` when retrieval-evals has run (e.g. `mcp_hub_retrieval_eval_runs_total`). Recent runs: `GET /retrieval-evals/recent`.
