/**
 * n8n Plugin - Node catalog, examples, optional workflow write
 * NO LLM - knowledge + optional apply service
 */

import { getCatalog, getNodeByType, getNodesByCategory } from "./catalog.js";
import { getExamples, getExampleById } from "./examples.js";
import { isWriteEnabled, createWorkflow, updateWorkflow } from "./workflow.js";

const PLUGIN_ID = "n8n";

const tools = [
  {
    name: "n8n_get_node_catalog",
    description: "Get the full n8n node catalog with types, parameters, and examples. Use when AI needs to know which nodes exist and how to configure them.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional: filter by category (trigger, action)",
        },
      },
    },
  },
  {
    name: "n8n_get_node_info",
    description: "Get detailed info for a specific node type (e.g. n8n-nodes-base.httpRequest)",
    inputSchema: {
      type: "object",
      properties: {
        nodeType: { type: "string", description: "Node type (e.g. n8n-nodes-base.webhook)" },
      },
      required: ["nodeType"],
    },
  },
  {
    name: "n8n_get_examples",
    description: "Get workflow examples to help create similar workflows",
    inputSchema: {
      type: "object",
      properties: {
        exampleId: {
          type: "string",
          description: "Optional: specific example ID (webhook-to-set, schedule-http, etc.)",
        },
      },
    },
  },
  ...(isWriteEnabled()
    ? [
        {
          name: "n8n_create_workflow",
          description: "Create a new workflow in n8n. Requires workflow JSON from AI.",
          inputSchema: {
            type: "object",
            properties: {
              workflow: {
                type: "object",
                description: "Workflow object: { name, nodes, connections, settings? }",
              },
            },
            required: ["workflow"],
          },
        },
        {
          name: "n8n_update_workflow",
          description: "Update an existing workflow in n8n.",
          inputSchema: {
            type: "object",
            properties: {
              workflowId: { type: "string", description: "n8n workflow ID" },
              workflow: {
                type: "object",
                description: "Partial workflow object to update",
              },
            },
            required: ["workflowId", "workflow"],
          },
        },
      ]
    : []),
];

const resources = [
  {
    uri: "n8n://catalog",
    name: "n8n Node Catalog",
    description: "Full node catalog with types and parameters",
    mimeType: "application/json",
  },
  {
    uri: "n8n://examples",
    name: "n8n Workflow Examples",
    description: "Example workflows for common patterns",
    mimeType: "application/json",
  },
];

async function callTool(name, args) {
  switch (name) {
    case "n8n_get_node_catalog": {
      const catalog = args.category ? getNodesByCategory(args.category) : getCatalog();
      return { catalog };
    }
    case "n8n_get_node_info": {
      const node = getNodeByType(args.nodeType);
      if (!node) return { error: `Node type not found: ${args.nodeType}` };
      return { node };
    }
    case "n8n_get_examples": {
      if (args.exampleId) {
        const ex = getExampleById(args.exampleId);
        return ex ? { example: ex } : { error: `Example not found: ${args.exampleId}` };
      }
      return { examples: getExamples() };
    }
    case "n8n_create_workflow": {
      const created = await createWorkflow(args.workflow);
      return { success: true, workflow: created };
    }
    case "n8n_update_workflow": {
      const updated = await updateWorkflow(args.workflowId, args.workflow);
      return { success: true, workflow: updated };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function readResource(uri) {
  if (uri === "n8n://catalog") {
    return { content: JSON.stringify(getCatalog(), null, 2), mimeType: "application/json" };
  }
  if (uri === "n8n://examples") {
    return { content: JSON.stringify(getExamples(), null, 2), mimeType: "application/json" };
  }
  if (uri.startsWith("n8n://examples/")) {
    const id = uri.replace("n8n://examples/", "");
    const ex = getExampleById(id);
    if (!ex) throw new Error(`Example not found: ${id}`);
    return { content: JSON.stringify(ex, null, 2), mimeType: "application/json" };
  }
  throw new Error(`Unknown resource: ${uri}`);
}

export const n8nPlugin = {
  id: PLUGIN_ID,
  tools,
  resources,
  callTool,
  readResource,
};
