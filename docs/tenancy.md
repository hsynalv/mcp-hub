# Tenancy Infrastructure

Central tenant/workspace/project model for MCP-Hub platform.

## Overview

The Tenancy infrastructure provides:
- **Tenant Data Model** - Hierarchical tenant/workspace/project structure
- **Context Extraction** - Standardized context extraction from requests
- **Validation** - Secure identifier validation and sanitization
- **Isolation Guards** - Cross-tenant/workspace access control
- **Registry** - In-memory tenant/workspace/project management
- **Policy Integration** - Tenant-aware policy enforcement

## Architecture

```
src/core/tenancy/
├── tenant.types.js      # Type definitions
├── tenant.context.js    # Context extraction
├── tenant.validation.js # ID validation
├── tenant.isolation.js  # Isolation guards
├── tenant.policy.js     # Policy integration
├── tenant.registry.js   # Registry management
├── index.js             # Main exports
└── tenancy.test.js      # Test suite
```

## Quick Start

### Basic Usage

```javascript
import {
  extractTenantContext,
  validateTenantId,
  assertTenantAccess,
  getTenantRegistry,
} from "./core/tenancy/index.js";

// Extract context from request
const ctx = extractTenantContext(req);

// Validate tenant ID
const validation = validateTenantId("tenant_123");
if (!validation.valid) {
  console.error(validation.errors);
}

// Check access
assertTenantAccess(ctx, "tenant_123");

// Use registry
const registry = getTenantRegistry();
registry.registerTenant({ tenantId: "t1", name: "Tenant 1" });
```

## Tenant Data Model

### Hierarchy

```
Tenant (tenantId)
  └── Workspace (workspaceId, tenantId)
        └── Project (projectId, workspaceId, tenantId)
```

### Tenant

```javascript
{
  tenantId: "tenant_abc123",
  name: "Acme Corp",
  status: "active",  // active | suspended | deleted
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  metadata: {}
}
```

### Workspace

```javascript
{
  workspaceId: "workspace_def456",
  tenantId: "tenant_abc123",
  name: "Production",
  status: "active",  // active | archived | deleted
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  metadata: {}
}
```

### Project

```javascript
{
  projectId: "project_ghi789",
  workspaceId: "workspace_def456",
  tenantId: "tenant_abc123",
  name: "Main Project",
  status: "active",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  metadata: {}
}
```

### Request Context

```javascript
{
  actor: "user@example.com",
  roles: ["admin", "developer"],
  tenantId: "tenant_abc123",
  workspaceId: "workspace_def456",
  projectId: "project_ghi789",
  correlationId: "corr_16a8f9k2_3d9f2a1b"
}
```

## Context Extraction

### From HTTP Request

```javascript
import { extractTenantContext } from "./core/tenancy/index.js";

// Headers: x-tenant-id, x-workspace-id, x-project-id
// User: req.user from auth middleware
const ctx = extractTenantContext(req);

// Strict mode (throws on missing required fields)
const ctx = extractTenantContext(req, {
  strict: true,
  required: ["tenantId", "workspaceId"]
});
```

### Building Context

```javascript
import { buildTenantContext } from "./core/tenancy/index.js";

const ctx = buildTenantContext({
  tenantId: "t1",
  workspaceId: "w1",
  actor: "user@example.com",
  roles: ["admin"]
});
```

### Validation

```javascript
import { validateTenantContext } from "./core/tenancy/index.js";

const result = validateTenantContext(ctx);
console.log(result.valid);   // true/false
console.log(result.errors);  // Error messages
console.log(result.warnings); // Warning messages
```

## Validation Rules

### Valid Identifier Format

- Only alphanumeric, underscore, hyphen: `[a-zA-Z0-9_-]`
- Maximum length: 128 characters
- No path traversal: `..`, `/`, `\`
- No null bytes: `\0`
- No control characters

### Validation Functions

```javascript
import {
  validateTenantId,
  validateWorkspaceId,
  validateProjectId,
  validateHierarchy,
  isValidTenantIdentifier,
  assertValidTenantId,
} from "./core/tenancy/index.js";

// Validate single ID
const result = validateTenantId("tenant_123");
// → { valid: true, errors: [], warnings: [] }

const result = validateTenantId("invalid/id!");
// → { valid: false, errors: [...], warnings: [...] }

// Quick check
if (isValidTenantIdentifier("tenant_123")) {
  // Valid
}

// Assert (throws if invalid)
assertValidTenantId("tenant_123");  // OK
assertValidTenantId("invalid/id");  // Throws

// Validate hierarchy
const hierarchy = validateHierarchy({
  tenantId: "t1",
  workspaceId: "w1",
  projectId: "p1"
});
// → Checks that hierarchy is consistent
```

### Sanitization

```javascript
import { sanitizeTenantIdentifier } from "./core/tenancy/index.js";

sanitizeTenantIdentifier("valid/id!");  // "validid"
sanitizeTenantIdentifier("  test  ");     // "test"
```

## Isolation Guards

### Access Control

```javascript
import {
  isTenantAccessAllowed,
  isWorkspaceAccessAllowed,
  isProjectAccessAllowed,
  assertTenantAccess,
  checkResourceAccess,
} from "./core/tenancy/index.js";

const context = {
  tenantId: "tenant_1",
  workspaceId: "workspace_1",
  projectId: "project_1"
};

// Check tenant access
const result = isTenantAccessAllowed(context, "tenant_1");
// → { allowed: true }

const result = isTenantAccessAllowed(context, "tenant_2");
// → { allowed: false, reason: "...", code: "tenant_mismatch" }

// Check workspace access
const result = isWorkspaceAccessAllowed(context, "tenant_1", "workspace_1");
// → { allowed: true }

// Assert (throws if denied)
assertTenantAccess(context, "tenant_1");  // OK
assertTenantAccess(context, "tenant_2");  // Throws

// Check resource
const resource = { tenantId: "tenant_1", workspaceId: "workspace_1" };
const result = checkResourceAccess(context, resource);
// → { allowed: true }
```

### Error Codes

```javascript
import { IsolationErrorCode } from "./core/tenancy/index.js";

IsolationErrorCode.TENANT_MISMATCH;    // "tenant_mismatch"
IsolationErrorCode.WORKSPACE_MISMATCH; // "workspace_mismatch"
IsolationErrorCode.PROJECT_MISMATCH;   // "project_mismatch"
IsolationErrorCode.MISSING_CONTEXT;    // "missing_context"
IsolationErrorCode.INVALID_CONTEXT;    // "invalid_context"
IsolationErrorCode.UNAUTHORIZED;       // "unauthorized"
```

### Middleware

```javascript
import { createIsolationMiddleware } from "./core/tenancy/index.js";

// Basic middleware
app.use(createIsolationMiddleware());

// Require tenant context
app.use(createIsolationMiddleware({ requireTenant: true }));

// Require workspace context
app.use(createIsolationMiddleware({ requireWorkspace: true }));

// Access context in routes
app.get("/data", (req, res) => {
  const ctx = req.tenantContext;
  // Use ctx.tenantId, ctx.workspaceId, etc.
});
```

## Tenant Registry

### Operations

```javascript
import {
  getTenantRegistry,
  TenantRegistry,
} from "./core/tenancy/index.js";

const registry = getTenantRegistry();

// Register tenant
registry.registerTenant({
  tenantId: "t1",
  name: "Tenant 1",
  status: "active"
});

// Get tenant
const tenant = registry.getTenant("t1");

// List tenants
const tenants = registry.listTenants();
const activeTenants = registry.listTenants({ status: "active" });

// Register workspace
registry.registerWorkspace({
  workspaceId: "w1",
  tenantId: "t1",
  name: "Workspace 1",
  status: "active"
});

// Register project
registry.registerProject({
  projectId: "p1",
  workspaceId: "w1",
  tenantId: "t1",
  name: "Project 1"
});

// List workspaces for tenant
const workspaces = registry.listTenantWorkspaces("t1");

// List projects for workspace
const projects = registry.listWorkspaceProjects("w1");

// Resolve full path
const resolved = registry.resolvePath("t1", "w1", "p1");
// → { tenant, workspace, project }

// Get stats
const stats = registry.getStats();
// → { tenants, workspaces, projects, activeTenants, activeWorkspaces }
```

## Policy Integration

### Policy Context

```javascript
import {
  createPolicyContext,
  TenantPolicyReason,
} from "./core/tenancy/index.js";

const tenantContext = {
  actor: "user@example.com",
  roles: ["admin"],
  tenantId: "t1",
  workspaceId: "w1",
  projectId: "p1",
  correlationId: "corr_123"
};

const policyContext = createPolicyContext(tenantContext);
// → { actor, roles, tenantId, workspaceId, projectId, correlationId }
```

### Policy Reasons

```javascript
import { TenantPolicyReason } from "./core/tenancy/index.js";

TenantPolicyReason.TENANT_MISMATCH;
TenantPolicyReason.WORKSPACE_MISMATCH;
TenantPolicyReason.PROJECT_MISMATCH;
TenantPolicyReason.MISSING_TENANT_CONTEXT;
TenantPolicyReason.TENANT_SUSPENDED;
TenantPolicyReason.CROSS_TENANT_ACCESS;
```

### Middleware

```javascript
import { createTenantPolicyMiddleware } from "./core/tenancy/index.js";

// Require tenant
app.use(createTenantPolicyMiddleware({ requireTenant: true }));

// Require specific roles
app.use(createTenantPolicyMiddleware({
  requireTenant: true,
  requiredRoles: ["admin"]
}));
```

## Integration with Existing Systems

### Audit Integration

```javascript
import { extractTenantContext } from "./core/tenancy/index.js";

// Include tenant context in audit events
app.use((req, res, next) => {
  req.tenantContext = extractTenantContext(req);
  next();
});
```

### Policy Integration

```javascript
import {
  createPolicyContext,
  isTenantActive,
} from "./core/tenancy/index.js";

// Check tenant status before policy decision
if (!isTenantActive(tenant)) {
  return { allowed: false, reason: "Tenant suspended" };
}
```

### Plugin Context

Plugins should use the standard tenant context:

```javascript
import { extractTenantContext } from "../../core/tenancy/index.js";

export default function myPlugin() {
  return {
    async execute(args, context) {
      const tenantCtx = extractTenantContext(context);
      // Use tenantCtx.tenantId, tenantCtx.workspaceId, etc.
    }
  };
}
```

## Security Best Practices

### 1. Always Validate IDs

```javascript
import { assertValidTenantId } from "./core/tenancy/index.js";

// Validate before use
assertValidTenantId(tenantId);
```

### 2. Check Isolation

```javascript
import { assertResourceAccess } from "./core/tenancy/index.js";

// Verify access before operations
assertResourceAccess(context, resource);
```

### 3. Use Middleware

```javascript
import { createIsolationMiddleware } from "./core/tenancy/index.js";

// Enforce context at route level
app.use("/api/data", createIsolationMiddleware({ requireTenant: true }));
```

### 4. Sanitize User Input

```javascript
import { sanitizeTenantIdentifier } from "./core/tenancy/index.js";

const cleanId = sanitizeTenantIdentifier(userInput);
```

## Testing

### Run Tests

```bash
npm test src/core/tenancy/tenancy.test.js
```

### Test Coverage

- Tenant/workspace/project validation
- Context extraction
- Registry behavior
- Cross-tenant deny
- Cross-workspace deny
- Same-tenant allow
- Policy integration

## Multi-Tenant Deployment

### Future SaaS Model

```
┌─────────────────────────────────────┐
│           Platform                  │
│  ┌─────────────────────────────┐   │
│  │  Tenant A                   │   │
│  │  ┌─────────────────────┐   │   │
│  │  │ Workspace 1         │   │   │
│  │  │ ┌───┐ ┌───┐ ┌───┐   │   │   │
│  │  │ │P1 │ │P2 │ │P3 │   │   │   │
│  │  │ └───┘ └───┘ └───┘   │   │   │
│  │  └─────────────────────┘   │   │
│  │  ┌─────────────────────┐   │   │
│  │  │ Workspace 2         │   │   │
│  │  └─────────────────────┘   │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Tenant B                   │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Tenant Isolation

- Each tenant has isolated data
- Cross-tenant access is denied by default
- Workspace-level isolation within tenant
- Project-level granularity

## Configuration

### Environment Variables (Future)

```bash
TENANCY_MODE=single      # single | multi
TENANT_VALIDATION=strict # strict | lenient
TENANT_ID_PREFIX=tenant_
WORKSPACE_ID_PREFIX=workspace_
PROJECT_ID_PREFIX=project_
```

## Troubleshooting

### Invalid Tenant ID

```javascript
const result = validateTenantId("invalid/id!");
console.log(result.errors); // See specific error
```

### Cross-Tenant Access Denied

Check that context and resource have matching tenant IDs:

```javascript
console.log(context.tenantId);  // Should match
console.log(resource.tenantId); // Should match
```

### Context Missing

Ensure middleware is applied before route handlers:

```javascript
app.use(createIsolationMiddleware());
app.get("/route", handler); // req.tenantContext available
```

---

For more details, see the test suite: `src/core/tenancy/tenancy.test.js`
