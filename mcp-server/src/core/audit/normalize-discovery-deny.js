/**
 * Normalize REST/MCP discovery denial into safe hub metadata (no secrets, no bodies).
 */

/**
 * @param {object} detail
 * @param {number} [detail.httpStatus]
 * @param {string} [detail.errorCode]
 * @param {string} [detail.denyKind]
 * @returns {{ reason: string, metadata: Record<string, string|number|undefined> }}
 */
export function normalizeDiscoveryDeny(detail = {}) {
  const httpStatus = typeof detail.httpStatus === "number" ? detail.httpStatus : undefined;
  const errorCode =
    typeof detail.errorCode === "string" && detail.errorCode.length > 0
      ? detail.errorCode
      : "discovery_denied";
  const denyKind =
    typeof detail.denyKind === "string" && detail.denyKind.length > 0
      ? detail.denyKind
      : errorCode;

  const metadata = {
    hubDenyKind: denyKind,
    hubErrorCode: errorCode,
  };
  if (httpStatus !== undefined) {
    metadata.hubStatusCode = httpStatus;
  }

  return { reason: errorCode, metadata };
}
