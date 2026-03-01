/**
 * n8n Node Catalog - Knowledge for AI workflow creation
 * Based on n8n docs: nodes-overview, popular-nodes
 * NO LLM - static data only
 */

export const NODE_CATALOG = [
  // Triggers
  {
    type: "n8n-nodes-base.manualTrigger",
    name: "Manual Trigger",
    category: "trigger",
    description: "Manually start workflow execution",
    parameters: [],
  },
  {
    type: "n8n-nodes-base.webhook",
    name: "Webhook",
    category: "trigger",
    description: "Start workflows from external HTTP requests. Production: /webhook/{path}, Test: /webhook-test/{path}",
    parameters: [
      { name: "path", type: "string", required: true, description: "Webhook path (e.g. user-signup)" },
      { name: "httpMethod", type: "options", options: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "POST" },
    ],
    example: { path: "new-customer", httpMethod: "POST" },
  },
  {
    type: "n8n-nodes-base.scheduleTrigger",
    name: "Schedule Trigger",
    category: "trigger",
    description: "Run workflows on cron-based schedule (seconds, minutes, hours, days, weeks, custom cron)",
    parameters: [
      { name: "rule", type: "object", description: "Schedule rule with interval config" },
    ],
    example: { rule: { interval: [{ field: "days", hoursInterval: 1, triggerAtHour: 9 }] } },
  },
  {
    type: "n8n-nodes-base.formTrigger",
    name: "Form Trigger",
    category: "trigger",
    description: "Form submissions as webhook trigger",
  },
  // Core / Data
  {
    type: "n8n-nodes-base.httpRequest",
    name: "HTTP Request",
    category: "action",
    description: "Connect to any REST API. All methods (GET, POST, PUT, DELETE, PATCH), auth types, headers, query params",
    parameters: [
      { name: "method", type: "options", options: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET" },
      { name: "url", type: "string", required: true, description: "Request URL" },
      { name: "authentication", type: "options", options: ["none", "basicAuth", "headerAuth", "oauth2"] },
    ],
    example: { method: "POST", url: "https://api.example.com/users" },
  },
  {
    type: "n8n-nodes-base.set",
    name: "Set",
    category: "action",
    description: "Transform data: add/remove/rename fields, set values, use expressions. Prefer over Code for simple transforms",
    parameters: [
      { name: "mode", type: "options", options: ["manual", "auto"] },
      { name: "fields", type: "object", description: "Field values with name, type, value" },
    ],
    example: {
      mode: "manual",
      fields: {
        values: [
          { name: "fullName", type: "stringValue", stringValue: "={{ $json.firstName }} {{ $json.lastName }}" },
        ],
      },
    },
  },
  {
    type: "n8n-nodes-base.filter",
    name: "Filter",
    category: "action",
    description: "Route or remove items based on conditions (string, number, date, boolean, regex)",
    parameters: [
      { name: "conditions", type: "object", description: "Conditions with combinator (and/or), leftValue, operator, rightValue" },
    ],
    example: {
      conditions: {
        combinator: "and",
        conditions: [{ leftValue: "={{ $json.status }}", operator: "equals", rightValue: "active" }],
      },
    },
  },
  {
    type: "n8n-nodes-base.merge",
    name: "Merge",
    category: "action",
    description: "Combine data: Append, Keep Key Matches, Merge By Index, Merge By Key, Multiplex",
    parameters: [
      { name: "mode", type: "options", options: ["append", "combine", "multiplex"] },
    ],
  },
  {
    type: "n8n-nodes-base.if",
    name: "IF",
    category: "action",
    description: "Conditional routing with true/false outputs",
    parameters: [
      { name: "conditions", type: "object" },
    ],
  },
  {
    type: "n8n-nodes-base.code",
    name: "Code",
    category: "action",
    description: "Run JavaScript or Python. Use as last resort - prefer Set, Filter, Aggregate. Sandboxed.",
    parameters: [
      { name: "mode", type: "options", options: ["runOnceForAllItems", "runOnceForEachItem"] },
      { name: "jsCode", type: "string", description: "JavaScript code" },
    ],
    example: "return $input.all().map(item => ({ json: { ...item.json, processed: true } }));",
  },
  // Integrations
  {
    type: "n8n-nodes-base.slack",
    name: "Slack",
    category: "action",
    description: "Send/update/delete messages, channels, files, reactions. OAuth2 or Access Token",
    parameters: [
      { name: "resource", type: "options", options: ["message", "channel", "file", "reaction"] },
      { name: "operation", type: "string" },
    ],
  },
  {
    type: "n8n-nodes-base.googleSheets",
    name: "Google Sheets",
    category: "action",
    description: "Read/write rows, append, update, delete, lookup. OAuth2. documentId, sheetName, columns",
    parameters: [
      { name: "operation", type: "options", options: ["appendOrUpdate", "readRows", "update", "delete"] },
      { name: "documentId", type: "string" },
      { name: "sheetName", type: "string" },
    ],
  },
  {
    type: "n8n-nodes-base.gmail",
    name: "Gmail",
    category: "action",
    description: "Send, search, add labels, mark read/unread, download attachments",
    parameters: [
      { name: "operation", type: "options", options: ["send", "getAll", "addLabels"] },
    ],
  },
  {
    type: "n8n-nodes-base.postgres",
    name: "PostgreSQL",
    category: "action",
    description: "Execute queries, insert, update, delete, transactions",
    parameters: [
      { name: "operation", type: "options", options: ["executeQuery", "insert", "update"] },
      { name: "query", type: "string" },
    ],
  },
  {
    type: "n8n-nodes-base.mongodb",
    name: "MongoDB",
    category: "action",
    description: "Find, insert, update, delete, aggregate",
    parameters: [
      { name: "operation", type: "options", options: ["find", "insert", "update", "delete"] },
      { name: "collection", type: "string" },
    ],
  },
];

export function getCatalog() {
  return NODE_CATALOG;
}

export function getNodeByType(type) {
  return NODE_CATALOG.find((n) => n.type === type);
}

export function getNodesByCategory(category) {
  return NODE_CATALOG.filter((n) => n.category === category);
}
