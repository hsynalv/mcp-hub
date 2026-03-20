/**
 * Re-export canonical principal resolution (single layer: src/core/auth/resolve-principal.js).
 */
export {
  resolvePrincipalScopes,
  maxScopeRank,
  resolveRequestedBy,
} from "../auth/resolve-principal.js";
