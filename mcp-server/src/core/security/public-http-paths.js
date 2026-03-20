/**
 * Paths that skip principal resolution and HTTP hub lifecycle noise (health, static UI, CORS preflight).
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function isPublicSecurityPath(req) {
  if (req.method === "OPTIONS") return true;
  const p = req.path || "";

  if (p === "/health") return true;

  if (req.method === "GET" && (p === "/" || p.startsWith("/landing/"))) {
    return true;
  }

  if (
    req.method === "GET" &&
    (p === "/ui" || p === "/ui/" || p.startsWith("/ui/"))
  ) {
    return true;
  }

  if (
    req.method === "GET" &&
    (p === "/admin" || p === "/admin/" || p.startsWith("/admin/"))
  ) {
    return true;
  }

  if (req.method === "POST" && p === "/ui/token") return true;

  return false;
}
