/**
 * Helpers for asserting an authenticated principal (optional use in handlers).
 */

/**
 * @param {import("./resolve-principal.js").ResolvedHubPrincipal | undefined} principal
 * @returns {boolean}
 */
export function isPrincipalAuthenticated(principal) {
  return !!(principal && principal.authenticated && Array.isArray(principal.scopes));
}
