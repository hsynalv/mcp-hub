# Debug Module

Enhanced debugging utilities for MCP Hub development.

## Overview

The Debug Module provides comprehensive debugging capabilities:
- **Request Tracing**: Log all HTTP requests with timing
- **Tool Tracing**: Track MCP tool execution
- **Performance Profiling**: Measure function execution time
- **Colorized Output**: Easy-to-read terminal output
- **Assertion Helpers**: Debug-only assertions

## Features

| Feature | Description |
|---------|-------------|
| Request Tracing | Log HTTP method, path, status, duration |
| Tool Tracing | Track plugin tool calls with params and results |
| Performance Profiler | Measure execution time with checkpoints |
| Colorized Logs | Terminal-friendly colored output |
| Debug Assertions | Assertions that only run in debug mode |

## Usage

### Enable Debug Mode

```bash
# Environment variable
DEBUG=true npm start

# Or in code
import { setDebug } from './debug.js';
setDebug(true, { traceRequests: true, traceTools: true });
```

### Request Tracing Middleware

```javascript
import { requestTracer } from './debug.js';

app.use(requestTracer());
```

**Output:**
```
[14:32:15.123] [DEBUG] → GET /health
[14:32:15.146] [INFO]  ← GET /health 200 23ms
```

### Tool Execution Tracing

```javascript
import { traceToolExecution } from './debug.js';

const wrappedHandler = traceToolExecution('github', 'analyze_repo', handler);
const result = await wrappedHandler(params);
```

**Output:**
```
[14:32:20.456] [DEBUG] ▶ github.analyze_repo()
[14:32:25.789] [SUCCESS] ✓ github.analyze_repo() 5231ms
```

### Performance Profiler

```javascript
import { Profiler } from './debug.js';

const profiler = new Profiler('Database Query').start();

// ... do work ...
profiler.checkpoint('connected');

// ... more work ...
profiler.checkpoint('queried');

const total = profiler.end();
// Output: ⏹ Database Query completed 2450ms
```

### Measure Function Execution

```javascript
import { measure } from './debug.js';

const measuredFn = measure('expensiveOperation', async (data) => {
  // Your code here
  return result;
});

const result = await measuredFn(data);
```

### Debug Assertions

```javascript
import { assert } from './debug.js';

assert(user !== null, 'User must be authenticated');
assert(result.length > 0, 'Result must not be empty');
```

## Configuration Options

```javascript
setDebug(true, {
  traceRequests: true,      // Log HTTP requests
  traceTools: true,         // Log tool calls
  profilePerformance: true, // Enable profiling
  logLevel: 'debug',        // debug, info, warn, error
  output: process.stdout    // Output stream
});
```

## Debug Information Endpoint

```javascript
import { getDebugInfo } from './debug.js';

app.get('/debug/info', (req, res) => {
  res.json(getDebugInfo());
});
```

**Returns:**
```json
{
  "state": {
    "enabled": true,
    "traceRequests": true,
    "traceTools": true
  },
  "requestCount": 42,
  "toolCallCount": 15,
  "recentRequests": [...],
  "recentTools": [...],
  "performanceMetrics": [...]
}
```

## CLI Integration

Use via the MCP CLI:

```bash
node bin/mcp-cli.js

mcp> debug on
✓ Debug mode enabled

mcp> debug off
✓ Debug mode disabled
```

## API Reference

### `setDebug(enabled, options)`
Enable or disable debug mode.

### `isDebug()`
Check if debug mode is enabled.

### `requestTracer()`
Express middleware for request tracing.

### `traceToolExecution(plugin, tool, handler)`
Wrap a tool handler with tracing.

### `Profiler`
Class for performance profiling.
- `start()` - Start profiling
- `checkpoint(label)` - Add checkpoint
- `end()` - End profiling and return total time

### `measure(name, fn)`
Wrap a function with performance measurement.

### `assert(condition, message)`
Debug-only assertion.

### `inspect(obj, depth)`
Pretty print object for debugging.

### `getDebugInfo()`
Get comprehensive debug information.

### `clearDebugData()`
Clear all debug traces and metrics.

## Color Scheme

| Level | Color | Usage |
|-------|-------|-------|
| DEBUG | Gray | Detailed tracing |
| INFO | Blue | General information |
| WARN | Yellow | Warnings |
| ERROR | Red | Errors |
| SUCCESS | Green | Successful operations |

## Best Practices

1. **Production**: Always disable debug mode in production
2. **Sensitive Data**: Don't log sensitive information (use maskBody)
3. **Performance**: Profiling adds overhead, use sparingly in production
4. **Logs**: Redirect logs to files for long-running processes
