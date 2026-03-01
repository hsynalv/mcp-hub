/**
 * Hand-written workflow examples for the n8n AI assistant.
 * NOT LLM output — static templates the AI can use as a starting point.
 *
 * Plan shape:
 *   nodes:       Array of { id, name, type, typeVersion, position, parameters }
 *   connections: Object of { "<FromNodeName>": { main: [[{ node, type, index }]] } }
 */

const EXAMPLES = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    intent: "cron_http_post",
    description: "Run an HTTP POST request on a schedule (e.g. every day at 9 AM).",
    plan: {
      nodes: [
        {
          id: "node_schedule",
          name: "Schedule",
          type: "n8n-nodes-base.scheduleTrigger",
          typeVersion: 1,
          position: [250, 300],
          parameters: {
            rule: {
              interval: [{ field: "days", hoursInterval: 1, triggerAtHour: 9 }],
            },
          },
        },
        {
          id: "node_http",
          name: "HTTP Request",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4,
          position: [470, 300],
          parameters: {
            method: "POST",
            url: "https://api.example.com/trigger",
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: "Content-Type", value: "application/json" }],
            },
            sendBody: true,
            bodyParameters: {
              parameters: [{ name: "source", value: "n8n" }],
            },
          },
        },
      ],
      connections: {
        Schedule: { main: [[{ node: "HTTP Request", type: "main", index: 0 }]] },
      },
    },
    notes: [
      "Adjust 'triggerAtHour' (0–23) and 'field' (minutes/hours/days/weeks) to change cadence.",
      "Replace the URL and body parameters with your actual endpoint.",
      "Add an 'Authorization' header parameter for authenticated APIs.",
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    intent: "webhook_to_slack",
    description: "Receive a webhook and forward the payload as a Slack message.",
    plan: {
      nodes: [
        {
          id: "node_webhook",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [250, 300],
          parameters: {
            path: "notify-slack",
            httpMethod: "POST",
            responseMode: "onReceived",
          },
        },
        {
          id: "node_slack",
          name: "Slack",
          type: "n8n-nodes-base.slack",
          typeVersion: 2,
          position: [470, 300],
          parameters: {
            resource: "message",
            operation: "post",
            channel: "#alerts",
            text: "={{ JSON.stringify($json, null, 2) }}",
          },
        },
      ],
      connections: {
        Webhook: { main: [[{ node: "Slack", type: "main", index: 0 }]] },
      },
    },
    notes: [
      "Set up Slack credentials (OAuth2 or Bot Token) before activating.",
      "Replace '#alerts' with your target channel.",
      "The 'text' expression serializes the full incoming payload. Narrow it to specific fields if needed, e.g. '={{ $json.message }}'.",
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    intent: "webhook_set_respond",
    description: "Receive a webhook, transform fields with Set, and respond immediately.",
    plan: {
      nodes: [
        {
          id: "node_webhook",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [250, 300],
          parameters: {
            path: "transform",
            httpMethod: "POST",
            responseMode: "responseNode",
          },
        },
        {
          id: "node_set",
          name: "Set Fields",
          type: "n8n-nodes-base.set",
          typeVersion: 3,
          position: [470, 300],
          parameters: {
            mode: "manual",
            fields: {
              values: [
                {
                  name: "fullName",
                  type: "stringValue",
                  stringValue: "={{ $json.firstName }} {{ $json.lastName }}",
                },
                {
                  name: "email",
                  type: "stringValue",
                  stringValue: "={{ $json.email.toLowerCase() }}",
                },
                {
                  name: "receivedAt",
                  type: "stringValue",
                  stringValue: "={{ $now.toISO() }}",
                },
              ],
            },
          },
        },
        {
          id: "node_respond",
          name: "Respond to Webhook",
          type: "n8n-nodes-base.respondToWebhook",
          typeVersion: 1,
          position: [690, 300],
          parameters: {
            respondWith: "json",
            responseBody: "={{ $json }}",
          },
        },
      ],
      connections: {
        Webhook: { main: [[{ node: "Set Fields", type: "main", index: 0 }]] },
        "Set Fields": { main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]] },
      },
    },
    notes: [
      "Webhook 'responseMode' must be 'responseNode' so the Respond node controls the reply.",
      "Extend the Set node 'values' array to map more fields.",
      "To include only transformed fields, set 'includeOtherFields' to false in Set node options.",
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    intent: "if_branch",
    description: "Route items to different branches based on a condition using the IF node.",
    plan: {
      nodes: [
        {
          id: "node_trigger",
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [250, 300],
          parameters: {},
        },
        {
          id: "node_if",
          name: "IF",
          type: "n8n-nodes-base.if",
          typeVersion: 2,
          position: [470, 300],
          parameters: {
            conditions: {
              options: { caseSensitive: false },
              combinator: "and",
              conditions: [
                {
                  id: "cond_1",
                  leftValue: "={{ $json.status }}",
                  rightValue: "active",
                  operator: { type: "string", operation: "equals" },
                },
              ],
            },
          },
        },
        {
          id: "node_true",
          name: "Handle Active",
          type: "n8n-nodes-base.set",
          typeVersion: 3,
          position: [690, 200],
          parameters: {
            mode: "manual",
            fields: {
              values: [{ name: "result", type: "stringValue", stringValue: "User is active" }],
            },
          },
        },
        {
          id: "node_false",
          name: "Handle Inactive",
          type: "n8n-nodes-base.set",
          typeVersion: 3,
          position: [690, 420],
          parameters: {
            mode: "manual",
            fields: {
              values: [{ name: "result", type: "stringValue", stringValue: "User is inactive" }],
            },
          },
        },
      ],
      connections: {
        "Manual Trigger": { main: [[{ node: "IF", type: "main", index: 0 }]] },
        IF: {
          main: [
            [{ node: "Handle Active", type: "main", index: 0 }],   // output 0 = true
            [{ node: "Handle Inactive", type: "main", index: 0 }], // output 1 = false
          ],
        },
      },
    },
    notes: [
      "IF node output[0] = true branch, output[1] = false branch.",
      "Add more conditions to the 'conditions' array and change 'combinator' to 'or' if needed.",
      "Replace the Set nodes with any action nodes (HTTP Request, Slack, etc.).",
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    intent: "merge_branches",
    description: "Fetch data from two HTTP sources in parallel and merge results into one stream.",
    plan: {
      nodes: [
        {
          id: "node_trigger",
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [250, 300],
          parameters: {},
        },
        {
          id: "node_api_a",
          name: "API A",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4,
          position: [470, 180],
          parameters: { method: "GET", url: "https://api.example.com/source-a" },
        },
        {
          id: "node_api_b",
          name: "API B",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4,
          position: [470, 420],
          parameters: { method: "GET", url: "https://api.example.com/source-b" },
        },
        {
          id: "node_merge",
          name: "Merge",
          type: "n8n-nodes-base.merge",
          typeVersion: 3,
          position: [690, 300],
          parameters: { mode: "append" },
        },
      ],
      connections: {
        "Manual Trigger": {
          main: [
            [
              { node: "API A", type: "main", index: 0 },
              { node: "API B", type: "main", index: 0 },
            ],
          ],
        },
        "API A": { main: [[{ node: "Merge", type: "main", index: 0 }]] },
        "API B": { main: [[{ node: "Merge", type: "main", index: 1 }]] },
      },
    },
    notes: [
      "Merge mode 'append' combines all items from both inputs into a single list.",
      "Use mode 'combine' with 'mergeByFields' to join on a shared key (like user ID).",
      "Both API nodes run in parallel since they share the same trigger output connection.",
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    intent: "telegram_send_message",
    description: "Send a Telegram message when a webhook is received.",
    plan: {
      nodes: [
        {
          id: "node_webhook",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [250, 300],
          parameters: {
            path: "telegram-notify",
            httpMethod: "POST",
            responseMode: "onReceived",
          },
        },
        {
          id: "node_telegram",
          name: "Telegram",
          type: "n8n-nodes-base.telegram",
          typeVersion: 1,
          position: [470, 300],
          parameters: {
            resource: "message",
            operation: "sendMessage",
            chatId: "={{ $json.chatId }}",
            text: "={{ $json.message }}",
            additionalFields: { parse_mode: "HTML" },
          },
        },
      ],
      connections: {
        Webhook: { main: [[{ node: "Telegram", type: "main", index: 0 }]] },
      },
    },
    notes: [
      "Add 'Telegram API' credentials (Bot Token) before activating.",
      "'chatId' can be a user ID, group ID, or channel username (e.g. @mychannel).",
      "Set 'parse_mode' to 'Markdown' or 'HTML' to format the message text.",
      "To send to a fixed chat, hardcode chatId in the parameter instead of reading from payload.",
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    intent: "code_transform",
    description: "Transform an array of items using a Code node (JavaScript).",
    plan: {
      nodes: [
        {
          id: "node_trigger",
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [250, 300],
          parameters: {},
        },
        {
          id: "node_code",
          name: "Transform",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [470, 300],
          parameters: {
            mode: "runOnceForAllItems",
            jsCode: [
              "const items = $input.all();",
              "return items.map(item => ({",
              "  json: {",
              "    id:        item.json.id,",
              "    fullName:  `${item.json.firstName} ${item.json.lastName}`,",
              "    email:     item.json.email?.toLowerCase() ?? null,",
              "    createdAt: new Date().toISOString(),",
              "  }",
              "}));",
            ].join("\n"),
          },
        },
      ],
      connections: {
        "Manual Trigger": { main: [[{ node: "Transform", type: "main", index: 0 }]] },
      },
    },
    notes: [
      "Use 'runOnceForEachItem' mode to process items independently instead of as a batch.",
      "Prefer the Set node for simple field renaming/mapping — Code adds overhead.",
      "$input.all() returns all items; $input.first() returns just the first one.",
      "Throw an error inside the code to halt the workflow: throw new Error('reason').",
    ],
  },
];

// Build a lookup map for O(1) retrieval by intent
const BY_INTENT = new Map(EXAMPLES.map((e) => [e.intent, e]));

/** Return all example summaries (intent + description only). */
export function listExamples() {
  return EXAMPLES.map(({ intent, description }) => ({ intent, description }));
}

/**
 * Return a single example by intent, or null if not found.
 * @param {string} intent
 */
export function getExample(intent) {
  return BY_INTENT.get(intent) ?? null;
}
