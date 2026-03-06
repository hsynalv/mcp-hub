# MCP Tool Contract Documentation

## Overview

AI-Hub provides a standardized tool system for MCP (Model Context Protocol) compatible agents. All tools follow a consistent contract that enables policy enforcement, approval workflows, and audit logging.

## Tool Structure

Every tool must conform to the following structure:

```javascript
{
  name: string,           // Unique tool identifier (e.g., "github_list_repos")
  description: string,    // Human-readable description
  inputSchema: {          // JSON Schema for input validation
    type: "object",
    properties: {
      param1: { type: "string", description: "Parameter description" },
      param2: { type: "number", description: "Another parameter" },
      explanation: {      // REQUIRED for write/destructive tools
        type: "string",
        description: "Explain why this tool is being run"
      }
    },
    required: ["param1", "explanation"]
  },
  handler: async (args, context) => result,
  tags: string[],         // Policy tags (see below)
  plugin: string          // Plugin name that owns this tool
}
```

## Tool Tags

Tags control policy enforcement and UX:

### Primary Policy Tags
- `read_only` - Tool only reads data, no side effects
- `write` - Tool modifies data
- `destructive` - Tool can delete or damage data
- `needs_approval` - Tool requires explicit human approval before execution

### Capability Tags
- `BULK` - Tool performs bulk operations
- `NETWORK` - Tool makes network requests
- `LOCAL_FS` - Tool accesses local filesystem
- `GIT` - Tool performs git operations
- `EXTERNAL_API` - Tool calls external APIs

## Policy System

### Automatic Approval Requirements

Tools are checked for approval requirements based on:

1. **Explicit tag**: `needs_approval` tag always requires approval
2. **Destructive operations**: If `policy.json` has `destructive_requires_approval: true`, tools with `destructive` tag require approval
3. **Write operations**: If `policy.json` has `write_requires_approval: true`, tools with `write` tag require approval

### Approval Flow

When a tool requires approval:

```javascript
// Tool call returns:
{
  ok: false,
  status: "approval_required",
  tool: "shell_execute",
  explanation: "User explanation for running this tool",
  parameters: { command: "rm -rf /", explanation: "..." },
  approval: {
    id: "approval-abc123",
    status: "pending",
    createdAt: "2024-01-15T10:30:00Z"
  },
  message: "Tool 'shell_execute' requires approval. Use POST /approve with id 'approval-abc123' to confirm."
}
```

### Confirming Approval

```bash
POST /approve
{
  "id": "approval-abc123"
}
```

The tool will then execute and return the actual result.

## Configuration

### policy.json

Create a `policy.json` file in the project root:

```json
{
  "destructive_requires_approval": true,
  "write_requires_approval": false
}
```

- `destructive_requires_approval`: Require approval for tools with `destructive` tag
- `write_requires_approval`: Require approval for tools with `write` tag

## Audit Logging

All tool executions are logged with:

- Tool name
- Timestamp
- Project ID
- Parameters
- Result or error
- Duration
- User
- Approval ID (if applicable)

Logs are written to stderr in JSON format for external processing.

## Example Tool

```javascript
export const tools = [
  {
    name: "run_terminal_cmd",
    description: "Execute a terminal command",
    tags: [ToolTags.WRITE, ToolTags.DESTRUCTIVE, ToolTags.NEEDS_APPROVAL],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory" },
        explanation: { 
          type: "string", 
          description: "Explain why this command needs to run"
        }
      },
      required: ["command", "explanation"]
    },
    handler: async (args, context) => {
      // Tool implementation
      return { output: "..." };
    }
  }
];
```

## Best Practices

1. **Always include explanation field** for write/destructive tools so LLM can explain its reasoning
2. **Use appropriate tags** - don't mark read-only tools as write
3. **Add descriptive inputSchema** with descriptions for all parameters
4. **Use ToolTags constants** instead of raw strings
5. **Return standardized envelope** `{ ok: true, data: ... }` or `{ ok: false, error: ... }`

## API Endpoints

- `POST /approve` - Approve a pending tool execution
- `GET /policy/approvals` - List pending approvals
- `POST /policy/approvals/:id/approve` - Approve specific request
- `POST /policy/approvals/:id/reject` - Reject specific request
- `POST /policy/evaluate` - Test if a request would be allowed
