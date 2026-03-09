# Core Policy System

Centralized authorization and policy management for all MCP plugins.

## Overview

The policy system provides a unified, extensible authorization layer that can be used across all plugins. It standardizes how permissions are checked, decisions are made, and results are reported.

## Architecture

```
src/core/policy/
├── policy.interface.js    # Base interfaces and types
├── policy.context.js      # Policy context builder
├── policy.result.js       # Policy result format
├── policy.rules.js        # Default rules and rule engine
├── policy.manager.js      # Central policy manager
├── policy.helpers.js      # Common helper functions
├── policy.config.js       # Configuration management
├── index.js               # Main exports
└── policy.test.js         # Test suite
```

## Key Concepts

### PolicyContext

Standard context for all authorization decisions:

```javascript
{
  actor: "user123",           // Who is requesting
  plugin: "shell",            // Which plugin
  action: "execute",          // What action
  resourceType: "command",    // Resource type (optional)
  resourceId: "cmd-1",        // Resource ID (optional)
  workspaceId: "ws1",         // Workspace scope
  projectId: "proj1",         // Project scope (optional)
  scope: "admin",             // Permission scope (read/write/admin)
  readonly: false,            // Is read-only operation
  destructive: true,          // Is destructive operation
  correlationId: "uuid",      // Request correlation ID
  metadata: {},               // Additional context
  timestamp: Date             // When evaluated
}
```

### PolicyResult

Standard result format:

```javascript
{
  allowed: false,             // Decision
  reason: "Operation blocked", // Human-readable reason
  code: "DENIED_DESTRUCTIVE",  // Machine-readable code
  policy: "default-rules",     // Which policy made the decision
  metadata: {},              // Additional info
  timestamp: Date             // When decided
}
```

## Usage

### Basic Authorization

```javascript
import { authorize, isAllowed } from "../../core/policy/index.js";

// Simple check
const result = await authorize({
  actor: "user123",
  plugin: "shell",
  action: "execute",
  command: "ls -la"
});

if (isAllowed(result)) {
  // Execute the command
}
```

### Helper Functions

```javascript
import {
  canRead,
  canWrite,
  canDelete,
  canExecute,
  canResolveSecret
} from "../../core/policy/index.js";

// Check read permission
const readResult = await canRead({
  actor: "user123",
  workspaceId: "ws1",
  resourceType: "file"
});

// Check write permission
const writeResult = await canWrite({
  actor: "user123",
  workspaceId: "ws1",
  resourceType: "file"
});

// Check delete permission
const deleteResult = await canDelete({
  actor: "user123",
  workspaceId: "ws1",
  resourceType: "file"
});
```

### Custom Evaluator

```javascript
import { PolicyEvaluator } from "../../core/policy/index.js";

class MyEvaluator extends PolicyEvaluator {
  constructor() {
    super("my-evaluator", 100); // name, priority
  }

  canEvaluate(context) {
    return context.plugin === "my-plugin";
  }

  evaluate(context) {
    // Your logic here
    return allow({ policy: this.name });
  }
}

// Register with manager
import { getPolicyManager } from "../../core/policy/index.js";
const manager = getPolicyManager();
manager.registerEvaluator(new MyEvaluator());
```

### Custom Rules

```javascript
import { createRule, RuleEngine } from "../../core/policy/index.js";

const rule = createRule({
  name: "custom-rule",
  description: "My custom rule",
  priority: 100,
  evaluate: (context) => {
    if (context.action === "special-action") {
      return allow({ code: "ALLOWED_CUSTOM" });
    }
    return null; // Not applicable
  }
});

const engine = new RuleEngine();
engine.addRule(rule);
```

## Default Policy Rules

The system includes built-in rules for common scenarios:

| Rule | Description | Priority |
|------|-------------|----------|
| `allowReadScope` | Allows all read operations | 10 |
| `denyDestructive` | Denies destructive actions | 100 |
| `denyShellExecution` | Denies shell command execution | 90 |
| `denySecretResolution` | Denies secret access | 80 |
| `denyWriteInReadonlyMode` | Denies writes in readonly mode | 70 |
| `denyRagClear` | Denies RAG index clearing | 60 |

## Policy Codes

### Allow Codes
- `ALLOWED` - Generic allow
- `ALLOWED_READ_SCOPE` - Read operation allowed
- `ALLOWED_WRITE_SCOPE` - Write operation allowed
- `ALLOWED_TRUSTED_PLUGIN` - Trusted plugin bypass
- `ALLOWED_ADMIN_SCOPE` - Admin operation allowed

### Deny Codes
- `DENIED_DEFAULT` - Default deny
- `DENIED_DESTRUCTIVE_ACTION` - Destructive action blocked
- `DENIED_READONLY_MODE` - Read-only mode active
- `DENIED_SHELL_EXECUTION` - Shell execution blocked
- `DENIED_SECRET_RESOLUTION` - Secret access blocked
- `DENIED_DATABASE_WRITE` - Database write blocked
- `DENIED_FILE_DELETION` - File deletion blocked
- `DENIED_RAG_CLEAR` - RAG clear blocked
- `DENIED_WORKSPACE_MODIFICATION` - Workspace modification blocked
- `DENIED_INVALID_CONTEXT` - Invalid authorization context
- `DENIED_SCOPE_INSUFFICIENT` - Insufficient scope

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `POLICY_ENABLED` | `true` | Enable/disable policy system |
| `POLICY_DEFAULT_DENY` | `true` | Default to deny if no rule matches |
| `POLICY_STRICT_MODE` | `false` | Fail on missing context fields |
| `POLICY_LOG_DECISIONS` | `false` | Log all policy decisions |
| `POLICY_FAIL_SAFE` | `true` | Deny on errors |
| `POLICY_TRUSTED_PLUGINS` | `""` | Comma-separated trusted plugins |

## Fail-Safe Behavior

The policy system is designed to fail safely:

1. **Evaluator errors** - If a custom evaluator throws, the system continues to the next evaluator
2. **Invalid context** - Missing required fields result in a deny decision
3. **No matching rules** - Default behavior is configurable (default: deny)
4. **System errors** - If evaluation fails entirely, defaults to deny (configurable)

## Plugin Integration

### Shell Plugin

```javascript
import { canExecute, getPolicyManager } from "../../core/policy/index.js";

const policyManager = getPolicyManager();
const policyResult = await canExecute({
  actor: "user123",
  workspaceId: "ws1",
  command: "ls -la"
});

if (!policyResult.allowed) {
  throw new Error(`Policy denied: ${policyResult.reason}`);
}
```

### Secrets Plugin

```javascript
import { canResolveSecret } from "../../core/policy/index.js";

const result = await canResolveSecret({
  actor: "user123",
  workspaceId: "ws1",
  secretName: "API_KEY"
});
```

### Database Plugin

```javascript
import { canAccessDatabase } from "../../core/policy/index.js";

const result = await canAccessDatabase({
  actor: "user123",
  workspaceId: "ws1",
  action: "SELECT",
  table: "users"
});
```

### File Storage Plugin

```javascript
import { canAccessFileStorage } from "../../core/policy/index.js";

const result = await canAccessFileStorage({
  actor: "user123",
  workspaceId: "ws1",
  action: "write",
  path: "/file.txt"
});
```

## Testing

Run the policy test suite:

```bash
npm test src/core/policy/policy.test.js
```

The test suite covers:
- Context building and validation
- Result formatting and merging
- Rule engine evaluation
- Policy manager authorization
- Helper functions
- Integration scenarios

## Best Practices

1. **Always check permissions** before executing sensitive operations
2. **Use helper functions** for common permission patterns
3. **Provide context** - Include workspace, project, and metadata
4. **Handle denials gracefully** - Return clear error messages
5. **Log decisions** - Enable `POLICY_LOG_DECISIONS` in production
6. **Test policies** - Write tests for custom evaluators and rules
7. **Keep rules focused** - Each rule should handle one specific case
8. **Use priorities wisely** - More specific rules should have higher priority

## Extending the System

### Adding Custom Rules

```javascript
import { getPolicyManager } from "../../core/policy/index.js";
import { createRule } from "../../core/policy/index.js";

const manager = getPolicyManager();
manager.addRule(createRule({
  name: "business-hours-only",
  priority: 200,
  evaluate: (ctx) => {
    const hour = new Date().getHours();
    if (hour < 9 || hour > 17) {
      return deny({
        code: "DENIED_OUTSIDE_BUSINESS_HOURS",
        reason: "Operations only allowed during business hours"
      });
    }
    return null;
  }
}));
```

### Custom Policy Evaluator

```javascript
import { PolicyEvaluator, allow, deny } from "../../core/policy/index.js";

class RateLimitEvaluator extends PolicyEvaluator {
  constructor() {
    super("rate-limit", 150);
    this.requests = new Map();
  }

  canEvaluate(ctx) {
    return true; // Evaluate all requests
  }

  evaluate(ctx) {
    const key = `${ctx.actor}:${ctx.plugin}:${ctx.action}`;
    const count = this.requests.get(key) || 0;

    if (count > 100) {
      return deny({
        code: "DENIED_RATE_LIMIT",
        reason: "Rate limit exceeded"
      });
    }

    this.requests.set(key, count + 1);
    return allow({ policy: this.name });
  }
}
```

## API Reference

See individual module files for detailed JSDoc documentation:
- `policy.interface.js` - Interfaces and types
- `policy.context.js` - Context building
- `policy.result.js` - Result handling
- `policy.rules.js` - Rules and engine
- `policy.manager.js` - Manager class
- `policy.helpers.js` - Helper functions
