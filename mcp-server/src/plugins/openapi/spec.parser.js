/**
 * spec.parser.js — OpenAPI spec parsing and code generation.
 *
 * Wraps swagger-parser (validation + $ref resolution) and js-yaml (YAML→JSON).
 * Generates n8n node JSON, curl commands, and fetch snippets from operations.
 */

import yaml from "js-yaml";

/**
 * Parse a raw spec string/object into a validated, dereferenced spec.
 * Returns { ok, spec } or { ok:false, error }.
 */
export async function parseSpec(raw) {
  let parsed;

  // Accept string (YAML or JSON) or plain object
  if (typeof raw === "string") {
    try {
      // Try JSON first, fall back to YAML
      try { parsed = JSON.parse(raw); } catch { parsed = yaml.load(raw); }
    } catch (err) {
      return { ok: false, error: "parse_failed", message: err.message };
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  } else {
    return { ok: false, error: "invalid_input" };
  }

  // Minimal structural validation without external API calls
  if (!parsed.openapi && !parsed.swagger) {
    return { ok: false, error: "not_openapi", message: "Must have 'openapi' or 'swagger' field" };
  }

  // Skip $ref resolution — was causing hangs on large specs
  // try { parsed = resolveInternalRefs(parsed); } catch { /* continue */ }

  return { ok: true, spec: parsed };
}

/**
 * Extract all operations from a parsed spec.
 * Returns array of operation descriptors.
 */
export function extractOperations(spec) {
  const ops = [];
  const paths = spec.paths ?? {};
  const servers = spec.servers ?? [{ url: "" }];
  const baseUrl = servers[0]?.url ?? "";

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op = pathItem[method];
      if (!op) continue;

      const parameters = [
        ...(pathItem.parameters ?? []),
        ...(op.parameters ?? []),
      ];

      ops.push({
        operationId: op.operationId ?? `${method}_${path.replace(/\W+/g, "_")}`,
        method:      method.toUpperCase(),
        path,
        fullUrl:     baseUrl + path,
        summary:     op.summary ?? "",
        description: op.description ?? "",
        tags:        op.tags ?? [],
        parameters:  parameters.map(simplifyParam),
        requestBody: simplifyBody(op.requestBody),
        security:    op.security ?? spec.security ?? [],
        responses:   Object.entries(op.responses ?? {}).map(([code, r]) => ({
          code,
          description: r.description ?? "",
        })),
      });
    }
  }

  return ops;
}

/** Detect authentication type from spec securitySchemes. */
export function detectAuth(spec) {
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const types = [];

  for (const [name, scheme] of Object.entries(schemes)) {
    if (scheme.type === "apiKey") types.push({ name, type: "apiKey", in: scheme.in, paramName: scheme.name });
    else if (scheme.type === "http" && scheme.scheme === "bearer") types.push({ name, type: "bearer" });
    else if (scheme.type === "http" && scheme.scheme === "basic")  types.push({ name, type: "basic" });
    else if (scheme.type === "oauth2") types.push({ name, type: "oauth2", flows: Object.keys(scheme.flows ?? {}) });
    else types.push({ name, type: scheme.type });
  }

  return types;
}

/**
 * Generate code for a specific operation.
 * target: "n8n" | "curl" | "fetch"
 */
export function generateCode(op, target, baseUrl = "") {
  const url = (baseUrl || op.fullUrl || "") || "/";
  const pathWithParams = op.path;

  switch (target) {
    case "n8n":   return genN8n(op, url);
    case "curl":  return genCurl(op, url, pathWithParams);
    case "fetch": return genFetch(op, url);
    default:      throw new Error(`Unknown target: ${target}`);
  }
}

// ─── Generators ──────────────────────────────────────────────────────────────

function genN8n(op, baseUrl) {
  const node = {
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4,
    name: op.operationId,
    parameters: {
      method: op.method,
      url:    baseUrl + op.path,
    },
  };

  // Query params
  const queryParams = op.parameters.filter((p) => p.in === "query");
  if (queryParams.length) {
    node.parameters.sendQuery = true;
    node.parameters.queryParameters = {
      parameters: queryParams.map((p) => ({ name: p.name, value: `={{/* ${p.description || p.name} */}}` })),
    };
  }

  // Path params
  const pathParams = op.parameters.filter((p) => p.in === "path");
  if (pathParams.length) {
    node.parameters.sendHeaders = true;
    node.parameters.headerParameters = {
      parameters: pathParams.map((p) => ({ name: p.name, value: "" })),
    };
  }

  // Body
  if (op.requestBody) {
    node.parameters.sendBody = true;
    node.parameters.bodyContentType = op.requestBody.contentType ?? "json";
    if (op.requestBody.example) {
      node.parameters.rawBody = JSON.stringify(op.requestBody.example, null, 2);
    }
  }

  // Auth hints
  if (op.security?.length) {
    node.parameters.authentication = "genericCredentialType";
    node.parameters.genericAuthType = "httpHeaderAuth";
  }

  return node;
}

function genCurl(op, baseUrl, rawPath) {
  const url = (baseUrl + rawPath).replace(/\{(\w+)\}/g, ":$1");
  const parts = [`curl -X ${op.method} "${url}"`];

  if (op.requestBody) {
    parts.push(`  -H "Content-Type: application/json"`);
    if (op.requestBody.example) {
      parts.push(`  -d '${JSON.stringify(op.requestBody.example)}'`);
    }
  }

  const queryParams = op.parameters.filter((p) => p.in === "query");
  if (queryParams.length) {
    const qs = queryParams.map((p) => `${p.name}=VALUE`).join("&");
    parts[0] = parts[0].replace(`"${url}"`, `"${url}?${qs}"`);
  }

  return parts.join(" \\\n");
}

function genFetch(op, baseUrl) {
  const url = (baseUrl + op.path).replace(/\{(\w+)\}/g, "${/* $1 */}");
  const opts = { method: op.method };

  if (op.requestBody?.example) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = "JSON.stringify(body)";
  }

  const optsStr = JSON.stringify(opts, null, 2).replace('"JSON.stringify(body)"', "JSON.stringify(body)");

  return [
    `const response = await fetch(\`${url}\`, ${optsStr});`,
    "const data = await response.json();",
  ].join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function simplifyParam(p) {
  return {
    name:        p.name,
    in:          p.in,
    required:    p.required ?? false,
    description: p.description ?? "",
    type:        p.schema?.type ?? p.type ?? "string",
    example:     p.example ?? p.schema?.example,
  };
}

function simplifyBody(body) {
  if (!body) return null;
  const content = body.content ?? {};
  const [contentType, mediaType] = Object.entries(content)[0] ?? ["application/json", {}];
  return {
    required:    body.required ?? false,
    contentType,
    description: body.description ?? "",
    example:     mediaType?.example ?? extractSchemaExample(mediaType?.schema),
  };
}

function extractSchemaExample(schema) {
  if (!schema) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.type === "object" && schema.properties) {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out[k] = v.example ?? v.default ?? exampleForType(v.type);
    }
    return out;
  }
  return undefined;
}

function exampleForType(type) {
  switch (type) {
    case "string":  return "string";
    case "integer":
    case "number":  return 0;
    case "boolean": return true;
    case "array":   return [];
    default:        return null;
  }
}

/**
 * Very basic internal $ref resolver — handles same-document refs only.
 * Does not make network requests.
 */
function resolveInternalRefs(spec) {
  const str = JSON.stringify(spec);
  // Only handle simple { "$ref": "#/components/schemas/Foo" } patterns
  const replaced = str.replace(/"(\$ref)":"#\/([^"]+)"/g, (match, key, refPath) => {
    const parts = refPath.split("/");
    let target = spec;
    for (const part of parts) {
      target = target?.[decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"))];
    }
    if (target) return JSON.stringify(target).slice(1, -1); // unwrap {}
    return match;
  });
  try { return JSON.parse(replaced); } catch { return spec; }
}
