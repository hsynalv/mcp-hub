# Plugin Unit Test Plan

Create comprehensive unit tests for all 15 plugins using Vitest, with mocked external dependencies and coverage for business logic, validation, and edge cases.

## Scope

Write unit tests for each plugin in `mcp-server/tests/plugins/`:

1. **database** - Query builder, CRUD operations, connection handling
2. **docker** - Container operations, image management
3. **file-storage** - File operations, S3/local storage
4. **github** - API client, analysis functions
5. **http** - Request handling, caching, rate limiting, policy enforcement
6. **n8n** - Workflow execution, credential management
7. **n8n-credentials** - Credential CRUD, encryption
8. **n8n-workflows** - Workflow definitions, execution
9. **notion** - Page/database operations, row management
10. **observability** - Health checks, metrics generation
11. **openapi** - Spec parsing, code generation
12. **policy** - Rule matching, approval queue, rate limiting
13. **projects** - Project CRUD, environment management
14. **secrets** - Secret storage, resolution, redaction
15. **slack** - Message sending, channel operations

## Test Structure per Plugin

```javascript
tests/plugins/{plugin-name}.test.js
├── Unit tests for exported functions
├── Integration tests for routes (using supertest)
├── Mock external APIs/clients
└── Edge cases and error scenarios
```

## Test Categories

1. **Business Logic Tests** - Core functions without HTTP layer
2. **Route/Handler Tests** - Express route handlers with mocked requests
3. **Validation Tests** - Zod schema validation edge cases
4. **Error Handling Tests** - Expected errors and recovery
5. **Integration Tests** - Plugin interactions with core modules

## Testing Approach

- **Pure functions**: Test directly with various inputs
- **External APIs**: Mock with `vi.fn()` and return fixtures
- **Database/Storage**: Mock store modules
- **HTTP routes**: Use `supertest` with `createServer()`
- **Policy engine**: Test rule matching and action determination

## Dependencies to Add

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "supertest": "^6.3.3",
    "@vitest/coverage-v8": "^1.0.0"
  }
}
```

## Priority Order

1. **policy** (critical for PR-5)
2. **http** (widely used)
3. **secrets** (security critical)
4. **database** (core functionality)
5. **github, notion, slack** (external integrations)
6. **docker, file-storage** (I/O operations)
7. **n8n*** (optional plugins)
8. **observability, openapi, projects** (supporting plugins)
