import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import {
  getAdapter,
  isValidBackend,
  sanitizePath,
  validateFileSize,
  checkFilePolicy,
  auditEntry,
  generateCorrelationId,
  getAuditLogEntries,
  MAX_FILE_SIZE_MB,
} from "./storage.adapter.js";
import { canAccessFileStorage, getPolicyManager } from "../../core/policy/index.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

const pluginError = createPluginErrorHandler("file-storage");

export const metadata = createMetadata({
  name: "file-storage",
  version: "1.0.0",
  description: "S3, Google Drive ve lokal depolama ile dosya işlemleri",
  status: PluginStatus.STABLE,
  productionReady: true,
  scopes: ["read", "write", "admin"],
  capabilities: ["read", "write", "delete", "file", "storage", "audit", "policy"],
  requiresAuth: true,
  supportsAudit: true,
  supportsPolicy: true,
  supportsWorkspaceIsolation: true,
  hasTests: true,
  hasDocs: true,
  riskLevel: RiskLevel.HIGH,
  owner: "platform-team",
  tags: ["storage", "files", "s3", "gdrive", "local"],
  dependencies: [],
  backends: ["s3", "gdrive", "local"],
  since: "1.0.0",
  notes: "Supports multiple storage backends with unified interface.",
});

export const name = "file-storage";
export const version = "1.0.0";
export const description = "S3, Google Drive ve lokal depolama ile dosya işlemleri";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "GET",    path: "/file-storage/list",   description: "Dosya/klasör listesi",     scope: "read"  },
  { method: "GET",    path: "/file-storage/read",   description: "Dosya içeriği (base64)",   scope: "read"  },
  { method: "POST",   path: "/file-storage/write",  description: "Dosya yaz",               scope: "write" },
  { method: "DELETE", path: "/file-storage/delete", description: "Dosya sil",               scope: "write" },
  { method: "POST",   path: "/file-storage/copy",   description: "Dosya kopyala",           scope: "write" },
  { method: "POST",   path: "/file-storage/move",   description: "Dosya taşı",              scope: "write" },
  { method: "GET",    path: "/file-storage/health", description: "Plugin health",           scope: "read"  },
];
export const examples = [
  "GET  /file-storage/list?backend=s3&path=prefix/",
  "GET  /file-storage/read?backend=s3&path=key",
  'POST /file-storage/write body: {"backend":"local","path":"test.txt","content":"hello"}',
  "DELETE /file-storage/delete?backend=s3&path=key",
];

const writeSchema = z.object({
  backend:     z.enum(["s3", "gdrive", "local"]),
  path:        z.string().min(1),
  content:     z.string(),
  contentType: z.string().optional(),
});

const copyMoveSchema = z.object({
  backend:    z.enum(["s3", "gdrive", "local"]),
  sourcePath: z.string().min(1),
  destPath:   z.string().min(1),
});

function validate(schema, data, res) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const err = pluginError.validation("Invalid request", result.error.flatten());
    res.status(400).json({ ok: false, error: err.code, message: err.message, details: err.details });
    return null;
  }
  return result.data;
}

function extractContext(req) {
  return {
    actor: req.user?.id || req.user?.email || "anonymous",
    workspaceId: req.headers["x-workspace-id"] || null,
    projectId: req.headers["x-project-id"] || null,
  };
}

async function runAdapter(backend, fn, res, req, options = {}) {
  const { operation, path, checkPolicy = true } = options;
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  const { actor, workspaceId, projectId } = extractContext(req);

  if (!isValidBackend(backend)) {
    const err = pluginError.validation("Invalid backend", { validBackends: ["s3", "gdrive", "local"] });
    auditEntry({
      operation: operation || "unknown",
      path: path || "unknown",
      backend,
      allowed: false,
      reason: "invalid_backend",
      actor,
      workspaceId,
      projectId,
      correlationId,
      durationMs: Date.now() - startTime,
    });
    return res.status(400).json({ ok: false, error: err.code, message: err.message });
  }

  // Policy check before execution
  if (checkPolicy && path && operation) {
    const policyCheck = checkFilePolicy(operation, path, { actor, workspaceId, projectId });
    if (!policyCheck.allowed) {
      auditEntry({
        operation,
        path,
        backend,
        allowed: false,
        reason: policyCheck.reason,
        actor,
        workspaceId,
        projectId,
        correlationId,
        durationMs: Date.now() - startTime,
      });
      const err = pluginError.authorization(policyCheck.message);
      return res.status(403).json({ ok: false, error: err.code, message: err.message, reason: policyCheck.reason });
    }
  }

  try {
    const adapter = await getAdapter(backend);
    const result = await fn(adapter);

    auditEntry({
      operation: operation || "unknown",
      path: path || "unknown",
      backend,
      allowed: true,
      actor,
      workspaceId,
      projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      sizeBytes: result?.size || null,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err.message || "Unknown error";
    let statusCode = 500;
    let errorCode = "internal_error";
    let errorMessage = msg;

    if (msg === "invalid_path" || msg.includes("path traversal")) {
      statusCode = 400;
      errorCode = "path_traversal";
      errorMessage = "Path traversal or invalid path";
    } else if (msg === "connection_failed") {
      statusCode = 502;
      errorCode = "connection_failed";
      errorMessage = "Storage connection failed";
    } else if (msg.includes("not found") || msg.includes("No such file")) {
      statusCode = 404;
      errorCode = "file_not_found";
      errorMessage = "File not found";
    } else if (msg.includes("size limit") || msg.includes("exceeds")) {
      statusCode = 413;
      errorCode = "file_too_large";
      errorMessage = msg;
    }

    auditEntry({
      operation: operation || "unknown",
      path: path || "unknown",
      backend,
      allowed: false,
      reason: errorCode,
      actor,
      workspaceId,
      projectId,
      correlationId,
      durationMs: Date.now() - startTime,
      error: msg,
    });

    const stdErr = pluginError.external(backend.toUpperCase(), errorMessage, errorCode);
    res.status(statusCode).json({ ok: false, error: stdErr.code, message: stdErr.message });
  }
}

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  router.get("/list", requireScope("read"), async (req, res) => {
    const backend = req.query.backend;
    const path = sanitizePath(req.query.path || ".");
    if (path === null) {
      const err = pluginError.validation("Path traversal or invalid path");
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    const context = extractContext(req);
    await runAdapter(backend, (adapter) => adapter.list(path, context), res, req, { operation: "list", path });
  });

  router.get("/read", requireScope("read"), async (req, res) => {
    const backend = req.query.backend;
    const path = sanitizePath(req.query.path);
    if (!path || path === null) {
      const err = pluginError.validation("Path required and must be valid");
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    const context = extractContext(req);
    await runAdapter(backend, (adapter) => adapter.read(path, context), res, req, { operation: "read", path });
  });

  router.post("/write", requireScope("write"), async (req, res) => {
    const data = validate(writeSchema, req.body, res);
    if (!data) return;

    // Validate file size before processing
    const sizeCheck = validateFileSize(data.content);
    if (!sizeCheck.valid) {
      const err = pluginError.validation(sizeCheck.reason);
      return res.status(413).json({
        ok: false,
        error: err.code,
        message: err.message,
        sizeLimitMb: sizeCheck.maxMb,
      });
    }

    const path = sanitizePath(data.path);
    if (path === null) {
      const err = pluginError.validation("Path traversal or invalid path");
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }

    // Policy check using core policy manager
    const policyManager = getPolicyManager();
    if (policyManager) {
      const context = extractContext(req);
      const policyResult = await canAccessFileStorage({
        actor: context.actor || "unknown",
        workspaceId: context.workspaceId || "global",
        action: "write",
        path,
      });
      if (!policyResult.allowed) {
        return res.status(403).json({
          ok: false,
          error: "POLICY_DENIED",
          message: policyResult.reason || "Write operation not authorized",
        });
      }
    }

    const context = extractContext(req);
    await runAdapter(data.backend, (adapter) => adapter.write(path, data.content, data.contentType, context), res, req, { operation: "write", path });
  });

  router.delete("/delete", requireScope("write"), async (req, res) => {
    const backend = req.query.backend;
    const path = sanitizePath(req.query.path);
    if (!path || path === null) {
      const err = pluginError.validation("Path required and must be valid");
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }

    // Policy check using core policy manager
    const policyManager = getPolicyManager();
    if (policyManager) {
      const context = extractContext(req);
      const policyResult = await canAccessFileStorage({
        actor: context.actor || "unknown",
        workspaceId: context.workspaceId || "global",
        action: "delete",
        path,
      });
      if (!policyResult.allowed) {
        return res.status(403).json({
          ok: false,
          error: "POLICY_DENIED",
          message: policyResult.reason || "Delete operation not authorized",
        });
      }
    }

    const context = extractContext(req);
    await runAdapter(backend, (adapter) => adapter.delete(path, context), res, req, { operation: "delete", path });
  });

  router.post("/copy", requireScope("write"), async (req, res) => {
    const data = validate(copyMoveSchema, req.body, res);
    if (!data) return;
    const src = sanitizePath(data.sourcePath);
    const dst = sanitizePath(data.destPath);
    if (src === null || dst === null) {
      const err = pluginError.validation("Path traversal or invalid path");
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    const context = extractContext(req);
    await runAdapter(data.backend, (adapter) => adapter.copy(src, dst, context), res, req, { operation: "copy", path: `${src} -> ${dst}` });
  });

  router.post("/move", requireScope("write"), async (req, res) => {
    const data = validate(copyMoveSchema, req.body, res);
    if (!data) return;
    const src = sanitizePath(data.sourcePath);
    const dst = sanitizePath(data.destPath);
    if (src === null || dst === null) {
      const err = pluginError.validation("Path traversal or invalid path");
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    const context = extractContext(req);
    await runAdapter(data.backend, (adapter) => adapter.move(src, dst, context), res, req, { operation: "move", path: `${src} -> ${dst}` });
  });

  /**
   * GET /file-storage/audit
   * Returns file operation audit log.
   */
  router.get("/audit", requireScope("read"), (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { audit: getAuditLogEntries(limit) } });
  });

  app.use("/file-storage", router);
}
