/**
 * Annotates an n8n workflow with sticky notes before it is applied.
 *
 * Adds three types of notes:
 *   1. Overview   — top of canvas, lists nodes in execution order
 *   2. Sections   — large background notes grouping Trigger / Process / Action nodes
 *   3. Credentials — per-node notes explaining which credential is needed
 */

// ── Node classification ───────────────────────────────────────────────────────

const TRIGGER_TYPES = new Set([
  "webhook", "schedule", "scheduletrigger", "cron", "manualtrigger",
  "chattrigger", "emailreadimap", "form", "ssetrigger", "kafkatrigger",
  "rabbitmqtrigger", "mqtttrigger", "redisTrigger",
]);

const TRANSFORM_TYPES = new Set([
  "if", "switch", "merge", "code", "set", "filter", "splitinbatches",
  "aggregate", "sort", "limit", "removeDuplicates", "summarize",
  "itemlists", "xml", "html", "markdown", "crypto", "datetime",
  "extractFromFile", "convertToFile",
]);

function classifyNode(node) {
  const raw = (node.type || "").toLowerCase().replace(/^[a-z0-9-]+\./, "");
  if (raw.includes("trigger") || TRIGGER_TYPES.has(raw)) return "trigger";
  if (TRANSFORM_TYPES.has(raw)) return "transform";
  return "action";
}

// ── Bounding box helpers ──────────────────────────────────────────────────────

const NODE_W = 220;
const NODE_H = 80;

function boundingBox(nodes, pad = 35) {
  const xs = nodes.map((n) => n.position[0]);
  const ys = nodes.map((n) => n.position[1]);
  return {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    w: Math.max(...xs) - Math.min(...xs) + NODE_W + pad * 2,
    h: Math.max(...ys) - Math.min(...ys) + NODE_H + pad * 2,
  };
}

// n8n sticky note colors: 1=yellow 2=red 3=green 4=purple 5=blue 6=gray
const SECTION_META = {
  trigger:   { label: "🚀 Trigger",  desc: "Workflow'u başlatan olay veya zamanlama", color: 5 },
  transform: { label: "⚙️ Process",  desc: "Veri işleme, filtreleme ve mantık adımları", color: 3 },
  action:    { label: "📤 Actions",  desc: "Dış servislere istek veya mesaj gönderimi",  color: 6 },
};

// ── Step list builder (follows connections graph) ─────────────────────────────

function buildStepList(workflowJson) {
  const nodeMap = Object.fromEntries(
    workflowJson.nodes.map((n) => [n.name, n])
  );

  // Count incoming connections per node
  const incoming = {};
  for (const n of workflowJson.nodes) incoming[n.name] = 0;
  for (const [, conns] of Object.entries(workflowJson.connections || {})) {
    for (const outputGroup of Object.values(conns)) {
      for (const targets of outputGroup) {
        for (const t of targets || []) {
          incoming[t.node] = (incoming[t.node] || 0) + 1;
        }
      }
    }
  }

  // BFS from root nodes (no incoming edges)
  const roots = Object.entries(incoming)
    .filter(([, c]) => c === 0)
    .map(([name]) => name);

  const visited = new Set();
  const ordered = [];
  const queue = [...roots];

  while (queue.length) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    visited.add(name);
    const n = nodeMap[name];
    if (n && n.type !== "n8n-nodes-base.stickyNote") ordered.push(name);
    const conns = workflowJson.connections?.[name];
    if (conns) {
      for (const outputGroup of Object.values(conns)) {
        for (const targets of outputGroup) {
          for (const t of targets || []) queue.push(t.node);
        }
      }
    }
  }

  return ordered.map((name, i) => `${i + 1}. **${name}**`).join("\n");
}

// ── Main export ───────────────────────────────────────────────────────────────

export function annotateWorkflow(workflowJson) {
  const datanodes = workflowJson.nodes.filter(
    (n) => n.type !== "n8n-nodes-base.stickyNote"
  );

  if (!datanodes.length) return workflowJson;

  const stickies = [];
  let sid = 0;
  const id = () => `sticky_auto_${++sid}`;

  // ── 1. Overview note ───────────────────────────────────────────────────────
  const xs = datanodes.map((n) => n.position[0]);
  const ys = datanodes.map((n) => n.position[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const totalW = Math.max(...xs) - minX + NODE_W + 70;
  const steps = buildStepList(workflowJson);

  stickies.push({
    id: id(),
    name: "📋 Overview",
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position: [minX - 30, minY - 220],
    parameters: {
      content: `# ${workflowJson.name}\n\n**Çalışma Sırası:**\n${steps}`,
      height: 180,
      width: Math.max(totalW, 380),
      color: 1,
    },
  });

  // ── 2. Section background notes ────────────────────────────────────────────
  const groups = { trigger: [], transform: [], action: [] };
  for (const node of datanodes) {
    groups[classifyNode(node)].push(node);
  }

  for (const [section, nodes] of Object.entries(groups)) {
    if (!nodes.length) continue;
    const { label, desc, color } = SECTION_META[section];
    const bb = boundingBox(nodes);
    stickies.push({
      id: id(),
      name: label,
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [bb.x, bb.y - 55],
      parameters: {
        content: `## ${label}\n${desc}`,
        height: bb.h + 60,
        width: bb.w,
        color,
      },
    });
  }

  // ── 3. Per-node credential notes ───────────────────────────────────────────
  for (const node of datanodes) {
    if (!node.credentials || !Object.keys(node.credentials).length) continue;

    const entries = Object.entries(node.credentials);
    const lines = entries.map(([type, val]) => {
      const configured = val?.id && val?.name;
      return configured
        ? `✅ \`${type}\` → **"${val.name}"**`
        : `⚠️ \`${type}\` → **kurulum gerekli**\nn8n → Settings → Credentials → Add credential → \`${type}\``;
    });

    const allConfigured = entries.every(([, v]) => v?.id && v?.name);

    stickies.push({
      id: id(),
      name: `🔑 ${node.name}`,
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [node.position[0], node.position[1] + 160],
      parameters: {
        content: `## 🔑 Credential\n${lines.join("\n\n")}`,
        height: 100 + entries.length * 60,
        width: 270,
        color: allConfigured ? 1 : 2,
      },
    });
  }

  return {
    ...workflowJson,
    nodes: [...workflowJson.nodes, ...stickies],
  };
}
