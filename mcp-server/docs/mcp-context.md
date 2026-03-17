# MCP Workspace Context Propagation

This document describes how workspace context is propagated from HTTP requests to MCP tool handlers, enabling workspace isolation for RAG, ingestion, and other tools.

## Overview

MCP tool calls respect workspace isolation by propagating `workspaceId` and `projectId` from HTTP headers into the request context. Tools that use `context.workspaceId` (e.g. `rag_index`, `rag_search`, `ingest_document`) will automatically use the correct workspace when clients send the appropriate headers.

## HTTP Headers

Clients can pass workspace context via the following headers:

| Header | Description |
|--------|-------------|
| `x-workspace-id` | Workspace identifier for isolation (e.g. `ws-123`) |
| `x-project-id` | Project identifier (e.g. `proj-456`) |

**Fallback:** If `x-workspace-id` is not provided, the middleware also checks `req.workspaceId` (set by `workspaceContextMiddleware` when `x-project-id` is used). If neither is present, tools use `"global"` as the default workspace.

## Request Flow

1. **HTTP Transport** (`src/mcp/http-transport.js`)
   - Extracts `x-workspace-id` and `x-project-id` from `req.headers`
   - Falls back to `req.workspaceId` and `req.projectId` from upstream middleware
   - Passes them in `authInfo` when sending the message to the MCP server

2. **Gateway** (`src/mcp/gateway.js`)
   - The `CallToolRequestSchema` handler receives `extra.authInfo` from the transport
   - Builds `context` with `workspaceId`, `projectId`, and `user`
   - Passes `context` to `callTool(name, args, context)`

3. **Tool Registry** (`src/core/tool-registry.js`)
   - Passes `context` to each tool handler: `tool.handler(args, context)`

4. **Tool Handlers**
   - RAG tools: `rag_index`, `rag_search`, `rag_delete`, `rag_index_batch`, `rag_get`, `rag_stats`
   - Ingestion tools: `ingest_document`, `reindex_document`, `ingest_markdown`
   - All use `context.workspaceId || "global"` for workspace isolation

## Example

```bash
# Index a document in workspace ws-123
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: ws-123" \
  -H "x-project-id: proj-456" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "rag_index",
      "arguments": {
        "content": "Hello world",
        "documentId": "doc-1"
      }
    }
  }'
```

The document will be indexed in workspace `ws-123`, not in `global`.

## Context Fields

The context passed to tool handlers includes:

| Field | Type | Description |
|-------|------|-------------|
| `workspaceId` | `string \| null` | From `x-workspace-id` or `req.workspaceId` |
| `projectId` | `string \| null` | From `x-project-id` or `req.projectId` |
| `user` | `string \| null` | From auth token |
| `method` | `string` | `"MCP"` |
| `requestId` | `string \| number` | JSON-RPC request id |

## STDIO Transport

The STDIO transport does not receive HTTP headers. For CLI usage (e.g. `mcp-hub-stdio`), workspace context is set via environment variables or CLI flags. The gateway falls back to these when `authInfo` is not provided by the transport:

| Variable / Flag | Description |
|----------------|-------------|
| `HUB_WORKSPACE_ID` / `--workspace-id` | Workspace for tool execution |
| `HUB_PROJECT_ID` / `--project-id` | Project identifier |
| `HUB_ENV` / `--env` | Environment (e.g. `development`, `staging`) |

**CLI example:**

```bash
npx mcp-hub-stdio --workspace-id ws-123 --project-id proj-456
```

**Environment example:**

```bash
HUB_WORKSPACE_ID=ws-1 HUB_PROJECT_ID=proj-1 npx mcp-hub-stdio
```

Tool handlers receive `context.workspaceId`, `context.projectId`, and `context.env` in the same shape as HTTP. When neither env nor authInfo provides a value, `workspaceId` and `projectId` are `null`; tools typically use `context.workspaceId || "global"` for workspace isolation.

## Async Jobs

Jobs run outside the HTTP request lifecycle. When a plugin submits a job (e.g. `submitJob("rag.ingestion", payload, context)`), it must pass workspace context explicitly. The job system stores `{ workspaceId, projectId, userId }` and passes it to the runner when the job executes. See **docs/workspace-security-model.md** (Workspace-Aware Jobs) for details.

## Testing

- **HTTP:** `tests/mcp/workspace-context.test.js` — verifies `x-workspace-id` and `x-project-id` header propagation
- **STDIO:** `tests/mcp/stdio-workspace-context.test.js` — verifies `HUB_WORKSPACE_ID`, `HUB_PROJECT_ID`, `HUB_ENV` fallback when authInfo is empty
