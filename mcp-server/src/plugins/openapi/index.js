import { Router } from "express";
import { z } from "zod";
import { requireScope } from "../../core/auth.js";
import { makeId, saveSpec, loadSpec, deleteSpec, listSpecs } from "./spec.store.js";
import { parseSpec, extractOperations, detectAuth, generateCode } from "./spec.parser.js";

export const name = "openapi";
export const version = "1.0.0";
export const description = "Load and analyze OpenAPI specs; generate n8n/curl/fetch code";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "POST",   path: "/openapi/load",                      description: "Load spec from URL or body", scope: "write"  },
  { method: "GET",    path: "/openapi/specs",                     description: "List loaded specs",          scope: "read"   },
  { method: "GET",    path: "/openapi/specs/:id",                 description: "Spec detail",                scope: "read"   },
  { method: "GET",    path: "/openapi/specs/:id/endpoints",       description: "All operations",             scope: "read"   },
  { method: "GET",    path: "/openapi/specs/:id/endpoints/:opId", description: "Single operation + code",   scope: "read"   },
  { method: "POST",   path: "/openapi/specs/:id/generate",        description: "Generate code for op",       scope: "read"   },
  { method: "DELETE", path: "/openapi/specs/:id",                 description: "Delete spec",                scope: "danger" },
  { method: "GET",    path: "/openapi/health",                    description: "Plugin health",              scope: "read"   },
];
export const examples = [
  'POST /openapi/load  body: {"url":"https://petstore3.swagger.io/api/v3/openapi.json","name":"petstore"}',
  "GET  /openapi/specs",
  "GET  /openapi/specs/:id/endpoints",
  'POST /openapi/specs/:id/generate  body: {"operationId":"getPets","target":"n8n"}',
];

const loadSchema = z.object({
  name: z.string().min(1),
  url:  z.string().url().optional(),
  spec: z.any().optional(),
}).refine((d) => d.url || d.spec, { message: "Either url or spec is required" });

const generateSchema = z.object({
  operationId: z.string().min(1),
  target:      z.enum(["n8n", "curl", "fetch"]).default("n8n"),
});

function validate(schema, body, res) {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ ok: false, error: "invalid_request", details: result.error.flatten() });
    return null;
  }
  return result.data;
}

export function register(app) {
  const router = Router();

  router.get("/health", requireScope("read"), (_req, res) => {
    res.json({ ok: true, status: "healthy", plugin: name, version });
  });

  /**
   * GET /openapi/specs
   * List all loaded specs with summary metadata.
   */
  router.get("/specs", requireScope("read"), (_req, res) => {
    const specs = listSpecs();
    res.json({ ok: true, count: specs.length, specs });
  });

  /**
   * GET /openapi/specs/:id
   * Return spec detail (info + auth types, no full paths).
   */
  router.get("/specs/:id", requireScope("read"), (req, res) => {
    const entry = loadSpec(req.params.id);
    if (!entry) return res.status(404).json({ ok: false, error: "not_found" });

    const { parsed, meta, endpointCount } = entry;
    res.json({
      ok: true,
      id:            req.params.id,
      name:          meta.name,
      title:         parsed.info?.title,
      version:       parsed.info?.version,
      description:   parsed.info?.description,
      source:        meta.source,
      loadedAt:      meta.loadedAt,
      endpointCount,
      authTypes:     detectAuth(parsed),
      servers:       parsed.servers ?? [],
    });
  });

  /**
   * GET /openapi/specs/:id/endpoints
   * List all operations (lightweight).
   */
  router.get("/specs/:id/endpoints", requireScope("read"), (req, res) => {
    const entry = loadSpec(req.params.id);
    if (!entry) return res.status(404).json({ ok: false, error: "not_found" });

    const { q, tag, method } = req.query;
    let ops = extractOperations(entry.parsed);

    if (q)      ops = ops.filter((o) => `${o.operationId} ${o.summary} ${o.path}`.toLowerCase().includes(q.toLowerCase()));
    if (tag)    ops = ops.filter((o) => o.tags.includes(tag));
    if (method) ops = ops.filter((o) => o.method === method.toUpperCase());

    const slim = ops.map(({ operationId, method, path, summary, tags }) => ({
      operationId, method, path, summary, tags,
    }));

    res.json({ ok: true, count: slim.length, endpoints: slim });
  });

  /**
   * GET /openapi/specs/:id/endpoints/:opId
   * Return full operation details + generated code.
   */
  router.get("/specs/:id/endpoints/:opId", requireScope("read"), (req, res) => {
    const entry = loadSpec(req.params.id);
    if (!entry) return res.status(404).json({ ok: false, error: "not_found" });

    const op = extractOperations(entry.parsed).find((o) => o.operationId === req.params.opId);
    if (!op) return res.status(404).json({ ok: false, error: "operation_not_found" });

    const baseUrl = entry.parsed.servers?.[0]?.url ?? "";

    res.json({
      ok: true,
      operation: op,
      examples: {
        n8n:   generateCode(op, "n8n",   baseUrl),
        curl:  generateCode(op, "curl",  baseUrl),
        fetch: generateCode(op, "fetch", baseUrl),
      },
    });
  });

  /**
   * POST /openapi/specs/:id/generate
   * Generate code for a specific operation.
   */
  router.post("/specs/:id/generate", requireScope("read"), (req, res) => {
    const data = validate(generateSchema, req.body, res);
    if (!data) return;

    const entry = loadSpec(req.params.id);
    if (!entry) return res.status(404).json({ ok: false, error: "not_found" });

    const op = extractOperations(entry.parsed).find((o) => o.operationId === data.operationId);
    if (!op) return res.status(404).json({ ok: false, error: "operation_not_found" });

    const baseUrl = entry.parsed.servers?.[0]?.url ?? "";

    try {
      const code = generateCode(op, data.target, baseUrl);
      res.json({ ok: true, operationId: data.operationId, target: data.target, code });
    } catch (err) {
      res.status(400).json({ ok: false, error: "generation_failed", message: err.message });
    }
  });

  /**
   * POST /openapi/load
   * Load a spec from a URL or raw body.
   */
  router.post("/load", requireScope("write"), async (req, res) => {
    const data = validate(loadSchema, req.body, res);
    if (!data) return;

    const TIMEOUT_MS = 25000;
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) res.status(504).json({ ok: false, error: "timeout", message: "Request took too long" });
    }, TIMEOUT_MS);

    try {
      let rawSpec;
      let source;

      if (data.url) {
        try {
          const resp = await fetch(data.url, { signal: AbortSignal.timeout(12000) });
          if (!resp.ok && !res.headersSent) {
            return res.status(502).json({ ok: false, error: "fetch_failed", status: resp.status });
          }
          rawSpec = await resp.text();
          source = data.url;
        } catch (err) {
          if (!res.headersSent) return res.status(502).json({ ok: false, error: "fetch_failed", message: err.message || "Network error" });
          return;
        }
      } else {
        rawSpec = typeof data.spec === "object" ? JSON.stringify(data.spec) : data.spec;
        source  = "body";
      }

      const parseResult = await parseSpec(rawSpec);
      if (!parseResult.ok) {
        return res.status(422).json({ ok: false, error: parseResult.error, message: parseResult.message });
      }

      const { spec: parsed } = parseResult;
      const id  = makeId(data.name);
      const ops = extractOperations(parsed);

      saveSpec(id, {
        meta: {
          name:     data.name,
          source,
          loadedAt: new Date().toISOString(),
        },
        parsed,
        endpointCount: ops.length,
      });

      if (!res.headersSent) {
        res.status(201).json({
          ok:            true,
          id,
          name:          data.name,
          title:         parsed.info?.title,
          endpointCount: ops.length,
          authTypes:     detectAuth(parsed),
        });
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          ok:      false,
          error:   "load_failed",
          message: err?.message ?? "Failed to load spec",
        });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  });

  /**
   * DELETE /openapi/specs/:id
   * Remove a spec from disk.
   */
  router.delete("/specs/:id", requireScope("danger"), (req, res) => {
    const existed = deleteSpec(req.params.id);
    if (!existed) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, deleted: req.params.id });
  });

  app.use("/openapi", router);
}
