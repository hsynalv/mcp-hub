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
    results = results.filter(
      (n) =>
        n.type.toLowerCase().includes(lq) ||
        n.displayName.toLowerCase().includes(lq) ||
        n.description.toLowerCase().includes(lq)
    );
  }

  return results.slice(0, limit).map(toSummary);
}

/**
 * Get full node detail by type string (e.g. n8n-nodes-base.webhook).
 * @param {object[]} nodes
 * @param {string} type
 * @returns {{ ok: true, node: object } | { ok: false, error: string } | null}
 *   null means the node type was not found at all.
 */
export function getNodeDetail(nodes, type) {
  const node = nodes.find((n) => n.type === type || n.name === type);
  if (!node) return null;

  const { _properties, _credentials, ...summary } = node;

  if (!_properties?.length) {
    return { ok: false, error: "details_not_available" };
  }

  const detail = { ...summary, properties: _properties };
  if (_credentials?.length) detail.credentials = _credentials;

  return { ok: true, node: detail };
}
