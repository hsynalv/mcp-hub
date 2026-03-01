import { z } from "zod";

// ── Query / param schemas (used by GET routes) ────────────────────────────

export const searchQuerySchema = z.object({
  q: z.string().optional(),
  group: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const nodeTypeParamSchema = z.object({
  type: z.string().min(1),
});

export const examplesQuerySchema = z.object({
  intent: z.string().optional(),
});

// ── Write operation body schemas ──────────────────────────────────────────

// Accept both a plain object AND a JSON string (AI tools sometimes stringify).
// z.preprocess runs before schema validation — parse string → object first.
const workflowJsonField = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  },
  z
    .any()
    .refine(
      (v) => v !== null && typeof v === "object" && !Array.isArray(v),
      { message: "workflowJson must be a non-null, non-array object" }
    )
);

export const applyWorkflowBodySchema = z.object({
  workflowJson: workflowJsonField,
  mode: z.enum(["create", "update", "upsert"]),
});

export const executeWorkflowBodySchema = z.object({
  workflowId: z.string().min(1),
  inputData: z.any().optional(),
});

export const getExecutionBodySchema = z.object({
  executionId: z.string().min(1),
});

// ── Workflow validate body schema ─────────────────────────────────────────

export const workflowValidateBodySchema = z.object({
  workflowJson: workflowJsonField,
});

// ── Semantic workflow validator ───────────────────────────────────────────

const TRIGGER_RE = /trigger|webhook|poll|form/i;

function isTriggerType(type) {
  return TRIGGER_RE.test(type);
}

/**
 * Semantic error/warning object shape:
 *   { code: string, path: string, message: string }
 */

/** Walk the connections map and collect all target node names. */
function collectConnectionTargets(connections, nodeNames, errors) {
  const targets = new Set();

  for (const [source, outputMap] of Object.entries(connections)) {
    if (!nodeNames.has(source)) {
      errors.push({
        code: "connection_unknown_source",
        path: `connections["${source}"]`,
        message: `Connection source "${source}" does not match any node name`,
      });
    }

    if (!outputMap || typeof outputMap !== "object" || Array.isArray(outputMap)) continue;

    for (const [outputType, slots] of Object.entries(outputMap)) {
      if (!Array.isArray(slots)) continue;
      slots.forEach((slot, slotIdx) => {
        if (!Array.isArray(slot)) return;
        for (const conn of slot) {
          if (!conn?.node) continue;
          targets.add(conn.node);
          if (!nodeNames.has(conn.node)) {
            errors.push({
              code: "connection_unknown_target",
              path: `connections["${source}"]["${outputType}"][${slotIdx}]`,
              message: `Connection target "${conn.node}" does not match any node name`,
            });
          }
        }
      });
    }
  }

  return targets;
}

/**
 * Validate a workflow JSON object.
 * Pure function — no API calls, no disk IO.
 *
 * @param {object} workflow
 * @returns {{ ok: true, warnings: object[] } | { ok: false, errors: object[] }}
 */
export function validateWorkflow(workflow) {
  const errors = [];
  const warnings = [];

  // ── Top-level fields ────────────────────────────────────────────────────

  if (typeof workflow.name !== "string" || !workflow.name.trim()) {
    errors.push({
      code: "workflow_missing_name",
      path: "name",
      message: 'Workflow must have a non-empty "name" string',
    });
  }

  const hasNodes = Array.isArray(workflow.nodes);
  if (!hasNodes) {
    errors.push({
      code: "workflow_missing_nodes",
      path: "nodes",
      message: '"nodes" must be an array',
    });
  } else if (workflow.nodes.length === 0) {
    errors.push({
      code: "workflow_empty_nodes",
      path: "nodes",
      message: '"nodes" array must not be empty',
    });
  }

  const hasConnections =
    workflow.connections !== null &&
    typeof workflow.connections === "object" &&
    !Array.isArray(workflow.connections);
  if (!hasConnections) {
    errors.push({
      code: "workflow_missing_connections",
      path: "connections",
      message: '"connections" must be a plain object',
    });
  }

  // Cannot do deeper checks without a nodes array
  if (!hasNodes) return { ok: false, errors };

  // ── Node checks ─────────────────────────────────────────────────────────

  const nodeNames = new Set();
  const seenNames = new Set();

  for (let i = 0; i < workflow.nodes.length; i++) {
    const node = workflow.nodes[i];
    const p = `nodes[${i}]`;

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push({ code: "node_invalid", path: p, message: `Item at index ${i} is not an object` });
      continue;
    }

    // name
    if (!node.name || typeof node.name !== "string" || !node.name.trim()) {
      errors.push({ code: "node_missing_name", path: `${p}.name`, message: `Node at index ${i} is missing "name"` });
    } else if (seenNames.has(node.name)) {
      errors.push({ code: "node_duplicate_name", path: `${p}.name`, message: `Duplicate node name: "${node.name}"` });
    } else {
      seenNames.add(node.name);
      nodeNames.add(node.name);
    }

    const label = node.name ?? `[${i}]`;

    // type
    if (!node.type || typeof node.type !== "string") {
      errors.push({ code: "node_missing_type", path: `${p}.type`, message: `Node "${label}" is missing "type"` });
    } else if (!node.type.includes(".")) {
      warnings.push({
        code: "node_type_unusual",
        path: `${p}.type`,
        message: `Node "${label}" type "${node.type}" does not follow n8n convention ("package.NodeName")`,
      });
    }

    // position
    if (
      !Array.isArray(node.position) ||
      node.position.length !== 2 ||
      typeof node.position[0] !== "number" ||
      typeof node.position[1] !== "number"
    ) {
      errors.push({
        code: "node_invalid_position",
        path: `${p}.position`,
        message: `Node "${label}" must have "position" as [x, y] numbers`,
      });
    }

    // parameters
    if (
      node.parameters === undefined ||
      node.parameters === null ||
      typeof node.parameters !== "object" ||
      Array.isArray(node.parameters)
    ) {
      errors.push({
        code: "node_missing_parameters",
        path: `${p}.parameters`,
        message: `Node "${label}" must have a "parameters" object (use {} if empty)`,
      });
    }

    // typeVersion — soft warning only
    if (node.typeVersion === undefined || node.typeVersion === null) {
      warnings.push({
        code: "node_missing_type_version",
        path: `${p}.typeVersion`,
        message: `Node "${label}" has no "typeVersion" — n8n will default to version 1`,
      });
    }
  }

  // ── Connection checks ───────────────────────────────────────────────────

  if (hasConnections && nodeNames.size > 0) {
    const targets = collectConnectionTargets(workflow.connections, nodeNames, errors);

    // Orphan detection: non-trigger nodes that nothing feeds into
    for (const node of workflow.nodes) {
      if (!node?.name || !nodeNames.has(node.name)) continue;
      if (targets.has(node.name)) continue;
      if (node.type && isTriggerType(node.type)) continue;

      warnings.push({
        code: "node_orphan",
        path: `nodes[name="${node.name}"]`,
        message: `Node "${node.name}" (${node.type ?? "unknown"}) has no incoming connection and is not a trigger node`,
      });
    }
  }

  // ── Workflow-level warnings ─────────────────────────────────────────────

  const hasTrigger = workflow.nodes.some((n) => n?.type && isTriggerType(n.type));
  if (!hasTrigger && workflow.nodes.length > 0) {
    warnings.push({
      code: "no_trigger_node",
      path: "nodes",
      message:
        "Workflow has no trigger node (webhook, scheduleTrigger, etc.) — it cannot run automatically",
    });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, warnings };
}
