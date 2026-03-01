/**
 * Search and detail helpers that operate on the in-memory catalog nodes array.
 * All functions are pure and synchronous — IO is handled by catalog.store.js.
 */

/** Strip internal _ fields to produce a clean NodeSummary for list responses. */
function toSummary({ _properties, _credentials, ...rest }) {
  return rest;
}

/**
 * Search nodes by query string and/or group.
 * @param {object[]} nodes - full node list from catalog (may include _properties)
 * @param {{ q?: string, group?: string, limit?: number }} opts
 * @returns {object[]} NodeSummary array
 */
export function searchNodes(nodes, { q, group, limit = 20 }) {
  let results = nodes;

  if (group) {
    const g = group.toLowerCase();
    results = results.filter((n) =>
      n.group.some((gr) => gr.toLowerCase() === g)
    );
  }

  if (q) {
    const lq = q.toLowerCase();
    // Also strip package prefix so "n8n-nodes-base.webhook" matches "webhook"
    const lqShort = lq.replace(/^[a-z0-9-]+\./, "");
    results = results.filter(
      (n) =>
        n.type.toLowerCase().includes(lq) ||
        n.type.toLowerCase().includes(lqShort) ||
        n.displayName.toLowerCase().includes(lq) ||
        n.displayName.toLowerCase().includes(lqShort) ||
        n.description.toLowerCase().includes(lq)
    );
  }

  return results.slice(0, limit).map(toSummary);
}

/**
 * Get full node detail by type string.
 * Matching priority (most → least specific):
 *   1. Exact type    e.g. "n8n-nodes-base.slack"
 *   2. Exact name    e.g. "slack"
 *   3. Case-insensitive type
 *   4. Case-insensitive displayName  e.g. "Slack"
 *   5. Partial type suffix           e.g. "slack" matches "n8n-nodes-base.slack"
 *
 * This allows the AI to pass short names like "slack" or "Slack" and still
 * get a result instead of a 404.
 *
 * @param {object[]} nodes
 * @param {string} type
 * @returns {{ ok: true, node: object } | { ok: false, error: string } | null}
 *   null means the node type was not found at all.
 */
export function getNodeDetail(nodes, type) {
  const lower = type.toLowerCase();
  // Strip package prefix: "n8n-nodes-base.webhook" → "webhook"
  const shortName = lower.replace(/^[a-z0-9-]+\./, "");

  const node =
    nodes.find((n) => n.type === type) ??                                  // exact: "n8n-nodes-base.webhook"
    nodes.find((n) => n.name === type) ??                                  // exact name match
    nodes.find((n) => n.type.toLowerCase() === lower) ??                   // case-insensitive full type
    nodes.find((n) => n.displayName.toLowerCase() === lower) ??            // display name: "Webhook"
    nodes.find((n) => n.type.toLowerCase() === shortName) ??               // prefix stripped: "webhook"
    nodes.find((n) => n.displayName.toLowerCase() === shortName) ??        // display name stripped
    nodes.find((n) => n.type.toLowerCase().endsWith(`.${lower}`));         // suffix fallback

  if (!node) return null;

  const { _properties, _credentials, ...summary } = node;

  if (!_properties?.length) {
    return { ok: false, error: "details_not_available" };
  }

  const detail = { ...summary, properties: _properties };
  if (_credentials?.length) detail.credentials = _credentials;

  return { ok: true, node: detail };
}
