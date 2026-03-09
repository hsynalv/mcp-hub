# Jobs / Queue System

Central job/queue management system for MCP-Hub platform.

## Overview

The Jobs system provides:
- **Async Task Submission** - Submit long-running tasks
- **Queue Management** - FIFO with priority support
- **Job State Tracking** - Monitor job lifecycle
- **Cancellation** - Cancel running jobs
- **Progress Reporting** - Real-time progress updates
- **Event System** - Job lifecycle events for observability

## Architecture

```
src/core/jobs/
├── job.types.js       # Type definitions & enums
├── job.store.js       # Job storage (memory-based)
├── job.events.js      # Event system
├── job.queue.js       # Queue management
├── job.worker.js      # Job execution engine
├── job.manager.js     # Central manager
├── index.js           # Main exports
└── jobs.test.js       # Test suite
```

## Job Data Model

```javascript
{
  id: "job_abc123",           // Unique ID
  type: "rag.index",          // Job type (plugin.action)
  status: "running",          // queued | running | completed | failed | cancelled
  plugin: "rag",              // Plugin name
  action: "index",            // Action name
  workspaceId: "ws_1",        // Workspace context
  projectId: null,            // Project context
  actor: "user@example.com",  // Who submitted
  correlationId: "corr_123",    // Tracing ID
  input: { ... },            // Job input
  output: { ... },            // Job output (on completion)
  error: { ... },             // Error details (on failure)
  progress: 50,               // 0-100
  priority: 0,                // Higher = more important
  createdAt: "2024-01-01...", // Created timestamp
  startedAt: "2024-01-01...", // Started timestamp
  finishedAt: null,           // Finished timestamp
  metadata: { ... }           // Additional metadata
}
```

## Quick Start

### Basic Usage

```javascript
import { JobManager, createJobManager, JobEventType } from "./core/jobs/index.js";

// Create manager
const manager = createJobManager();

// Register job handler
manager.registerHandler("rag.index", async ({ job, updateProgress, signal }) => {
  // Process job
  await updateProgress(25);
  
  // Check for cancellation
  if (signal.aborted) {
    throw new Error("Cancelled");
  }
  
  await updateProgress(50);
  // ... more work ...
  await updateProgress(100);
  
  return { indexed: 42 };
});

// Start processing
manager.startProcessing();

// Submit job
const job = await manager.submitJob("rag.index", {
  documents: ["doc1.pdf", "doc2.pdf"]
}, {
  workspaceId: "ws_1",
  actor: "user@example.com",
  correlationId: "corr_123"
});

// Monitor progress
console.log(`Job ${job.id} status: ${job.status}`);
```

### Configuration

```bash
# .env
JOBS_ENABLED=true
JOBS_MAX_CONCURRENCY=2
JOBS_MAX_RETRIES=1
JOBS_STORE=memory
JOBS_POLL_INTERVAL=1000
```

## Job Lifecycle

```
queued → running → completed
   ↓         ↓          ↓
   └──────── cancelled  ↓
              └────── failed
```

### States

| Status | Description |
|--------|-------------|
| `queued` | Waiting to be processed |
| `running` | Currently executing |
| `completed` | Successfully finished |
| `failed` | Error occurred |
| `cancelled` | User cancelled |

## API Reference

### JobManager

#### Register Handler

```javascript
manager.registerHandler("job.type", async ({ job, updateProgress, signal, context }) => {
  // job - Full job object
  // updateProgress(progress, data) - Update progress
  // signal - AbortSignal for cancellation
  // context - { jobId, type, plugin, action, workspaceId, actor, correlationId }
  
  return { result: "data" };
});
```

#### Submit Job

```javascript
const job = await manager.submitJob(
  "rag.index",           // Job type
  { docs: [...] },       // Input data
  {
    workspaceId: "ws_1",
    actor: "user",
    priority: 10,         // Higher = more important
  }
);
```

#### Manage Jobs

```javascript
// Get job
const job = await manager.getJob(jobId);

// List jobs
const result = await manager.listJobs(
  { status: "running", plugin: "rag" },  // Filters
  { limit: 10, offset: 0, sortBy: "createdAt" }  // Options
);

// Cancel job
await manager.cancelJob(jobId);

// Retry failed job
await manager.retryJob(jobId);

// Delete job
await manager.deleteJob(jobId);

// Get counts
const counts = await manager.getJobCounts();
// { queued: 5, running: 2, completed: 10, failed: 1, total: 18 }
```

#### Control Processing

```javascript
// Start processing queue
manager.startProcessing();

// Stop processing
manager.stopProcessing();

// Check if running
manager.isRunning();  // true | false
```

### Events

```javascript
import { getJobEventEmitter, JobEventType } from "./core/jobs/index.js";

const emitter = getJobEventEmitter();

emitter.on(JobEventType.CREATED, ({ jobId, job, timestamp }) => {
  console.log(`Job ${jobId} created`);
});

emitter.on(JobEventType.STARTED, ({ jobId, job }) => {
  console.log(`Job ${jobId} started`);
});

emitter.on(JobEventType.PROGRESS, ({ jobId, progress, data }) => {
  console.log(`Job ${jobId}: ${progress}%`);
});

emitter.on(JobEventType.COMPLETED, ({ jobId, job, result }) => {
  console.log(`Job ${jobId} completed:`, result);
});

emitter.on(JobEventType.FAILED, ({ jobId, job, error }) => {
  console.error(`Job ${jobId} failed:`, error.message);
});

emitter.on(JobEventType.CANCELLED, ({ jobId, job }) => {
  console.log(`Job ${jobId} cancelled`);
});
```

## Queue Behavior

### FIFO with Priority

Jobs are processed in order:
1. **Priority** (higher first)
2. **CreatedAt** (older first)

```javascript
// Job with priority 10 processed before priority 0
await manager.submitJob("test.job", {}, { priority: 10 });
await manager.submitJob("test.job", {}, { priority: 0 });
```

### Max Concurrency

```bash
JOBS_MAX_CONCURRENCY=2  # Max 2 jobs running simultaneously
```

Additional jobs remain in queue until a slot is available.

## Job Store

### Memory Store (Default)

```javascript
import { createJobStore, getJobStore } from "./core/jobs/index.js";

// New store instance
const store = createJobStore();

// Global store
const globalStore = getJobStore();
```

### Future: Persistent Stores

The store interface can be implemented for:
- Redis
- PostgreSQL
- MongoDB

```javascript
class RedisJobStore {
  async createJob(data) { /* ... */ }
  async getJob(id) { /* ... */ }
  async updateJob(id, updates) { /* ... */ }
  // ... other methods
}
```

## Plugin Integration

### Plugin Job Handler

```javascript
// In plugin index.js
export function registerJobHandlers(manager) {
  manager.registerHandler("rag.index", handleIndex);
  manager.registerHandler("rag.clear", handleClear);
}

async function handleIndex({ job, updateProgress, signal }) {
  const { input, workspaceId } = job;
  
  // Index documents
  for (let i = 0; i < input.documents.length; i++) {
    if (signal.aborted) {
      throw new Error("Cancelled");
    }
    
    await indexDocument(input.documents[i]);
    await updateProgress(
      Math.round((i + 1) / input.documents.length * 100)
    );
  }
  
  return { indexed: input.documents.length };
}
```

### Registration

```javascript
import { getJobManager } from "./core/jobs/index.js";
import { registerJobHandlers } from "./plugins/rag/index.js";

const manager = getJobManager();
registerJobHandlers(manager);
```

## Cancellation

### Automatic Cancellation

```javascript
manager.registerHandler("long.job", async ({ signal }) => {
  // Check periodically
  if (signal.aborted) {
    throw new Error("Cancelled");
  }
  
  // Or use AbortController with fetch
  const response = await fetch(url, { signal });
});
```

### Manual Cancellation

```javascript
// Cancel a job
await manager.cancelJob(jobId);

// Worker cancels current job
worker.cancel();
```

## Progress Reporting

### Basic Progress

```javascript
await updateProgress(50);  // 50% complete
```

### Progress with Data

```javascript
await updateProgress(50, {
  stage: "processing",
  current: 5,
  total: 10
});
```

### Event Listener

```javascript
emitter.on(JobEventType.PROGRESS, ({ jobId, progress, data }) => {
  // Broadcast to WebSocket, update UI, etc.
  ws.broadcast({ jobId, progress, data });
});
```

## Error Handling

### Job Failures

```javascript
manager.registerHandler("risky.job", async () => {
  try {
    return await riskyOperation();
  } catch (error) {
    // Error is captured and job marked as failed
    throw error;
  }
});
```

### Retry Failed Jobs

```javascript
// Retry a failed job
const retried = await manager.retryJob(jobId);

// Or implement automatic retry in handler
manager.registerHandler("retryable.job", async ({ job }) => {
  const attempt = job.metadata?.attempt || 0;
  
  try {
    return await operation();
  } catch (error) {
    if (attempt < 3) {
      // Update metadata and retry
      await manager.store.updateJob(job.id, {
        metadata: { attempt: attempt + 1 }
      });
      // Re-queue
      await manager.retryJob(job.id);
    }
    throw error;
  }
});
```

## Testing

### Run Tests

```bash
npm test src/core/jobs/jobs.test.js
```

### Test Coverage

- Job creation and storage
- Queue FIFO order
- Job execution
- Progress updates
- Cancellation
- Error handling
- Event emission
- Concurrency limits

## REST API Integration

### Endpoints Example

```javascript
import { Router } from "express";
import { getJobManager, JobStatus } from "./core/jobs/index.js";

const router = Router();
const manager = getJobManager();

// Submit job
router.post("/jobs", async (req, res) => {
  const { type, input, ...context } = req.body;
  const job = await manager.submitJob(type, input, context);
  res.status(201).json({ job });
});

// Get job
router.get("/jobs/:id", async (req, res) => {
  const job = await manager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json({ job });
});

// List jobs
router.get("/jobs", async (req, res) => {
  const { status, plugin, limit = 10 } = req.query;
  const result = await manager.listJobs(
    { status, plugin },
    { limit: parseInt(limit) }
  );
  res.json(result);
});

// Cancel job
router.post("/jobs/:id/cancel", async (req, res) => {
  const cancelled = await manager.cancelJob(req.params.id);
  res.json({ success: cancelled });
});

// Job counts
router.get("/jobs/stats", async (req, res) => {
  const counts = await manager.getJobCounts();
  res.json({ counts });
});
```

## Best Practices

1. **Always check cancellation** in long-running handlers
2. **Update progress** for better UX
3. **Handle errors** gracefully - don't crash the manager
4. **Set reasonable concurrency** - don't overwhelm system
5. **Clean up** - delete old completed jobs
6. **Monitor events** for observability
7. **Use correlation IDs** for tracing

## Troubleshooting

### Jobs Not Processing
- Check `JOBS_ENABLED=true`
- Call `manager.startProcessing()`
- Verify handler is registered

### Jobs Failing Immediately
- Check handler is registered for job type
- Verify handler doesn't throw synchronously

### Memory Issues
- Implement job cleanup: `manager.deleteJob(jobId)`
- Limit max concurrency
- Use persistent store for production

### Cancellation Not Working
- Ensure handler checks `signal.aborted`
- Use `signal` with async operations (fetch, fs)

## Future Enhancements

### Persistent Backends
- Redis store for distributed systems
- PostgreSQL store for relational data
- MongoDB store for document-based

### Advanced Features
- Job scheduling (cron-like)
- Job dependencies (DAG)
- Batch job processing
- Dead letter queue
- Job timeouts

---

For more details, see the test suite: `src/core/jobs/jobs.test.js`
