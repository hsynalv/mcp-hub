import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { getAdapter, isValidBackend, sanitizePath } from "./storage.adapter.js";

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
    res.status(400).json({ ok: false, error: "invalid_request", details: result.error.flatten() });
    return null;
  }
  return result.data;
}

async function runAdapter(backend, fn, res) {
  if (!isValidBackend(backend)) {
    return res.status(400).json({ ok: false, error: "invalid_backend", message: `Backend must be one of: s3, gdrive, local` });
  }
  try {
    const adapter = await getAdapter(backend);
    const result = await fn(adapter);
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err.message || "Unknown error";
    if (msg === "invalid_path") {
      return res.status(400).json({ ok: false, error: "invalid_path", message: "Path traversal or invalid path" });
    }
    if (msg === "connection_failed") {
      return res.status(502).json({ ok: false, error: "connection_failed", message: "Storage connection failed" });
    }
    console.error("[file-storage]", err);
    res.status(500).json({ ok: false, error: "internal_error", message: msg });
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
      return res.status(400).json({ ok: false, error: "invalid_path", message: "Path traversal or invalid path" });
    }
    await runAdapter(backend, (adapter) => adapter.list(path), res);
  });

  router.get("/read", requireScope("read"), async (req, res) => {
    const backend = req.query.backend;
    const path = sanitizePath(req.query.path);
    if (!path || path === null) {
      return res.status(400).json({ ok: false, error: "invalid_path", message: "Path required and must be valid" });
    }
    await runAdapter(backend, (adapter) => adapter.read(path), res);
  });

  router.post("/write", requireScope("write"), async (req, res) => {
    const data = validate(writeSchema, req.body, res);
    if (!data) return;
    const path = sanitizePath(data.path);
    if (path === null) {
      return res.status(400).json({ ok: false, error: "invalid_path", message: "Path traversal or invalid path" });
    }
    await runAdapter(data.backend, (adapter) => adapter.write(path, data.content, data.contentType), res);
  });

  router.delete("/delete", requireScope("write"), async (req, res) => {
    const backend = req.query.backend;
    const path = sanitizePath(req.query.path);
    if (!path || path === null) {
      return res.status(400).json({ ok: false, error: "invalid_path", message: "Path required and must be valid" });
    }
    await runAdapter(backend, (adapter) => adapter.delete(path), res);
  });

  router.post("/copy", requireScope("write"), async (req, res) => {
    const data = validate(copyMoveSchema, req.body, res);
    if (!data) return;
    const src = sanitizePath(data.sourcePath);
    const dst = sanitizePath(data.destPath);
    if (src === null || dst === null) {
      return res.status(400).json({ ok: false, error: "invalid_path", message: "Path traversal or invalid path" });
    }
    await runAdapter(data.backend, (adapter) => adapter.copy(src, dst), res);
  });

  router.post("/move", requireScope("write"), async (req, res) => {
    const data = validate(copyMoveSchema, req.body, res);
    if (!data) return;
    const src = sanitizePath(data.sourcePath);
    const dst = sanitizePath(data.destPath);
    if (src === null || dst === null) {
      return res.status(400).json({ ok: false, error: "invalid_path", message: "Path traversal or invalid path" });
    }
    await runAdapter(data.backend, (adapter) => adapter.move(src, dst), res);
  });

  app.use("/file-storage", router);
}
