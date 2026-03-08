/**
 * OpenAPI Spec Generator
 * 
 * Derives OpenAPI specification from the tool registry.
 * Single source of truth: registry → OpenAPI (not the reverse)
 */

import { getTools } from "./tool-registry.js";
import { getPlugins } from "./plugins.js";

/**
 * Generate OpenAPI spec from tool registry and plugin manifests
 * @returns {Object} OpenAPI 3.0 specification
 */
export function generateOpenApiSpec() {
  const plugins = getPlugins();
  const tools = getTools();
  
  const paths = {};
  const schemas = {};
  
  // Generate paths from plugin endpoints
  for (const plugin of plugins) {
    for (const endpoint of plugin.endpoints || []) {
      const pathKey = endpoint.path.replace(/:(\w+)/g, "{$1}");
      
      if (!paths[pathKey]) {
        paths[pathKey] = {};
      }
      
      const method = endpoint.method.toLowerCase();
      const operationId = `${plugin.name}_${method}_${pathKey.replace(/[^a-zA-Z0-9]/g, "_")}`;
      
      // Extract path parameters
      const pathParams = extractPathParams(endpoint.path);
      
      // Build parameters array
      const parameters = [
        ...pathParams,
        {
          name: "x-correlation-id",
          in: "header",
          description: "Correlation ID for request tracing",
          schema: { type: "string" },
        },
        {
          name: "x-project-id",
          in: "header",
          description: "Project context",
          schema: { type: "string" },
        },
      ];
      
      if (endpoint.scope) {
        parameters.push({
          name: "Authorization",
          in: "header",
          required: true,
          description: "Bearer token",
          schema: { type: "string" },
        });
      }
      
      paths[pathKey][method] = {
        summary: endpoint.description || `${endpoint.method} ${endpoint.path}`,
        description: endpoint.description,
        operationId,
        tags: [plugin.name],
        parameters,
        requestBody: endpoint.requestSchema ? {
          content: {
            "application/json": {
              schema: endpoint.requestSchema,
            },
          },
        } : undefined,
        responses: {
          "200": {
            description: "Success",
            content: {
              "application/json": {
                schema: endpoint.responseSchema || buildDefaultResponseSchema(),
              },
            },
          },
          "400": {
            description: "Bad Request",
            content: {
              "application/json": {
                schema: buildErrorSchema(),
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": {
                schema: buildErrorSchema(),
              },
            },
          },
          "403": {
            description: "Forbidden",
            content: {
              "application/json": {
                schema: buildErrorSchema(),
              },
            },
          },
          "429": {
            description: "Rate Limited",
            content: {
              "application/json": {
                schema: buildErrorSchema(),
              },
            },
          },
        },
        security: endpoint.scope ? [{ bearerAuth: [] }] : [],
        "x-plugin-status": plugin.status,
        "x-plugin-owner": plugin.owner,
        "x-required-scope": endpoint.scope,
      };
    }
  }
  
  // Generate MCP tool paths
  paths["/mcp"] = {
    post: {
      summary: "MCP Protocol Endpoint",
      description: "Model Context Protocol JSON-RPC endpoint",
      operationId: "mcp_protocol",
      tags: ["MCP"],
      parameters: [
        {
          name: "x-correlation-id",
          in: "header",
          description: "Correlation ID",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                jsonrpc: { type: "string", enum: ["2.0"] },
                method: { 
                  type: "string", 
                  enum: ["tools/list", "tools/call", "initialize"],
                },
                params: { type: "object" },
                id: { type: ["string", "number"] },
              },
              required: ["jsonrpc", "method", "id"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Success",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  jsonrpc: { type: "string" },
                  result: { type: "object" },
                  error: { type: "object" },
                  id: { type: ["string", "number"] },
                },
              },
            },
          },
        },
      },
    },
  };
  
  // Add tools listing endpoint
  paths["/tools"] = {
    get: {
      summary: "List all available tools",
      description: "Returns all MCP tools registered in the system",
      operationId: "list_tools",
      tags: ["Tools"],
      parameters: [
        {
          name: "plugin",
          in: "query",
          description: "Filter by plugin name",
          schema: { type: "string" },
        },
        {
          name: "tag",
          in: "query",
          description: "Filter by tag",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "List of tools",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  data: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Tool" },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  
  // Build schemas
  schemas.Tool = buildToolSchema();
  schemas.Error = buildErrorSchema();
  schemas.Plugin = buildPluginSchema();
  
  // Build tool schemas from registered tools
  for (const tool of tools) {
    schemas[`Tool_${tool.name}`] = tool.inputSchema || { type: "object" };
  }
  
  return {
    openapi: "3.0.3",
    info: {
      title: "MCP-Hub API",
      version: "1.0.0",
      description: "AI Agent Hub - Universal tool and service bridge",
      contact: {
        name: "API Support",
        email: "support@mcp-hub.local",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:8787",
        description: "Local development server",
      },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
          description: "Enter your API key as: Bearer YOUR_API_KEY",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: buildTags(plugins),
    "x-plugin-count": plugins.length,
    "x-tool-count": tools.length,
    "x-generated-at": new Date().toISOString(),
  };
}

/**
 * Extract path parameters from Express route
 */
function extractPathParams(path) {
  const params = [];
  const paramRegex = /:(\w+)/g;
  let match;
  
  while ((match = paramRegex.exec(path)) !== null) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }
  
  return params;
}

/**
 * Build default response schema
 */
function buildDefaultResponseSchema() {
  return {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      data: { type: "object" },
      meta: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
    },
  };
}

/**
 * Build error schema
 */
function buildErrorSchema() {
  return {
    type: "object",
    properties: {
      ok: { type: "boolean", enum: [false] },
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: { type: "object" },
        },
        required: ["code", "message"],
      },
      meta: {
        type: "object",
        properties: {
          requestId: { type: "string" },
        },
      },
    },
  };
}

/**
 * Build tool schema
 */
function buildToolSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      plugin: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      inputSchema: { type: "object" },
    },
    required: ["name", "description"],
  };
}

/**
 * Build plugin schema
 */
function buildPluginSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      version: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["stable", "beta", "experimental"] },
      owner: { type: "string" },
      capabilities: {
        type: "array",
        items: { type: "string" },
      },
      endpoints: {
        type: "array",
        items: { type: "object" },
      },
    },
  };
}

/**
 * Build OpenAPI tags from plugins
 */
function buildTags(plugins) {
  const tags = [
    { name: "MCP", description: "Model Context Protocol endpoints" },
    { name: "Tools", description: "Tool management" },
    { name: "Health", description: "Health and status" },
  ];
  
  for (const plugin of plugins) {
    tags.push({
      name: plugin.name,
      description: plugin.description || `${plugin.name} plugin`,
      "x-status": plugin.status,
      "x-owner": plugin.owner,
    });
  }
  
  return tags;
}

/**
 * Validate that OpenAPI spec matches registered tools
 * @returns {Object} Validation result
 */
export function validateOpenApiSync() {
  const plugins = getPlugins();
  const tools = getTools();
  const spec = generateOpenApiSpec();
  
  const issues = [];
  
  // Check each plugin endpoint has a matching path in spec
  for (const plugin of plugins) {
    for (const endpoint of plugin.endpoints || []) {
      const pathKey = endpoint.path.replace(/:(\w+)/g, "{$1}");
      
      if (!spec.paths[pathKey]) {
        issues.push({
          type: "missing_path",
          plugin: plugin.name,
          path: endpoint.path,
          message: `Endpoint ${endpoint.path} not in OpenAPI spec`,
        });
      } else if (!spec.paths[pathKey][endpoint.method.toLowerCase()]) {
        issues.push({
          type: "missing_method",
          plugin: plugin.name,
          path: endpoint.path,
          method: endpoint.method,
          message: `Method ${endpoint.method} for ${endpoint.path} not in OpenAPI spec`,
        });
      }
    }
  }
  
  // Check each tool has a schema
  for (const tool of tools) {
    if (!spec.components.schemas[`Tool_${tool.name}`]) {
      issues.push({
        type: "missing_tool_schema",
        tool: tool.name,
        message: `Tool ${tool.name} schema not in OpenAPI spec`,
      });
    }
  }
  
  return {
    valid: issues.length === 0,
    issueCount: issues.length,
    issues,
    pluginCount: plugins.length,
    toolCount: tools.length,
    pathCount: Object.keys(spec.paths).length,
  };
}

/**
 * Export OpenAPI spec to file
 */
export function exportOpenApiSpec(filepath) {
  const spec = generateOpenApiSpec();
  const fs = require("fs");
  fs.writeFileSync(filepath, JSON.stringify(spec, null, 2), "utf-8");
  return { success: true, filepath, size: JSON.stringify(spec).length };
}
