/**
 * n8n Workflow Examples - Help AI create workflows
 * NO LLM - static examples only
 */

export const WORKFLOW_EXAMPLES = [
  {
    id: "webhook-to-set",
    name: "Webhook → Set → Response",
    description: "Receive webhook, transform data with Set node",
    workflow: {
      name: "Webhook Transform Example",
      nodes: [
        {
          id: "webhook_1",
          type: "n8n-nodes-base.webhook",
          name: "Webhook",
          position: [250, 300],
          parameters: { path: "user-signup", httpMethod: "POST" },
        },
        {
          id: "set_1",
          type: "n8n-nodes-base.set",
          name: "Set",
          position: [470, 300],
          parameters: {
            mode: "manual",
            fields: {
              values: [
                { name: "fullName", type: "stringValue", stringValue: "={{ $json.firstName }} {{ $json.lastName }}" },
                { name: "email", type: "stringValue", stringValue: "={{ $json.email.toLowerCase() }}" },
              ],
            },
          },
        },
      ],
      connections: {
        Webhook: { main: [[{ node: "Set", type: "main", index: 0 }]] },
      },
      settings: { executionOrder: "v1" },
    },
  },
  {
    id: "schedule-http",
    name: "Schedule → HTTP Request",
    description: "Run HTTP request on schedule (e.g. daily)",
    workflow: {
      name: "Scheduled API Call",
      nodes: [
        {
          id: "schedule_1",
          type: "n8n-nodes-base.scheduleTrigger",
          name: "Schedule",
          position: [250, 300],
          parameters: {
            rule: { interval: [{ field: "days", hoursInterval: 1, triggerAtHour: 9 }] },
          },
        },
        {
          id: "http_1",
          type: "n8n-nodes-base.httpRequest",
          name: "HTTP Request",
          position: [470, 300],
          parameters: { method: "GET", url: "https://api.example.com/status" },
        },
      ],
      connections: {
        Schedule: { main: [[{ node: "HTTP Request", type: "main", index: 0 }]] },
      },
      settings: { executionOrder: "v1" },
    },
  },
  {
    id: "webhook-filter-branch",
    name: "Webhook → Filter → Branches",
    description: "Filter items and route to different branches",
    workflow: {
      name: "Webhook Filter Example",
      nodes: [
        {
          id: "webhook_1",
          type: "n8n-nodes-base.webhook",
          name: "Webhook",
          position: [250, 300],
          parameters: { path: "orders", httpMethod: "POST" },
        },
        {
          id: "filter_1",
          type: "n8n-nodes-base.filter",
          name: "Filter",
          position: [470, 300],
          parameters: {
            conditions: {
              combinator: "and",
              conditions: [
                { leftValue: "={{ $json.status }}", operator: "equals", rightValue: "active" },
                { leftValue: "={{ $json.amount }}", operator: "gt", rightValue: 100 },
              ],
            },
          },
        },
      ],
      connections: {
        Webhook: { main: [[{ node: "Filter", type: "main", index: 0 }]] },
      },
      settings: { executionOrder: "v1" },
    },
  },
  {
    id: "manual-code",
    name: "Manual Trigger → Code",
    description: "Run custom JavaScript on manual trigger",
    workflow: {
      name: "Code Node Example",
      nodes: [
        {
          id: "manual_1",
          type: "n8n-nodes-base.manualTrigger",
          name: "Manual Trigger",
          position: [250, 300],
          parameters: {},
        },
        {
          id: "code_1",
          type: "n8n-nodes-base.code",
          name: "Code",
          position: [470, 300],
          parameters: {
            mode: "runOnceForAllItems",
            jsCode: "return $input.all().map(item => ({ json: { ...item.json, processed: true, timestamp: new Date().toISOString() } }));",
          },
        },
      ],
      connections: {
        "Manual Trigger": { main: [[{ node: "Code", type: "main", index: 0 }]] },
      },
      settings: { executionOrder: "v1" },
    },
  },
];

export function getExamples() {
  return WORKFLOW_EXAMPLES.map((e) => ({ id: e.id, name: e.name, description: e.description }));
}

export function getExampleById(id) {
  return WORKFLOW_EXAMPLES.find((e) => e.id === id);
}
