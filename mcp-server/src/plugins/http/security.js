/**
 * HTTP Plugin Security Module
 *
 * Additional security protections:
 * - SSRF protection (localhost, private IPs)
 * - HTTP method restrictions
 * - Redirect safety
 */

import { config } from "../../core/config.js";

/**
 * Check if IP is in private/internal range
 * @param {string} ip - IP address to check
 * @returns {boolean} true if private/internal
 */
export function isPrivateIP(ip) {
  // IPv4 private ranges
  const privateRanges = [
    /^127\./, // Loopback
    /^10\./, // Class A private
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // Class B private
    /^192\.168\./, // Class C private
    /^169\.254\./, // Link-local
    /^0\./, // Current network
    /^::1$/, // IPv6 loopback
    /^fc00:/i, // IPv6 unique local
    /^fe80:/i, // IPv6 link-local
    /^::ffff:127\./, // IPv4-mapped IPv6 loopback
    /^::ffff:10\./, // IPv4-mapped IPv6 Class A
    /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./, // IPv4-mapped IPv6 Class B
    /^::ffff:192\.168\./, // IPv4-mapped IPv6 Class C
  ];

  return privateRanges.some((range) => range.test(ip));
}

/**
 * Check if hostname is localhost or private
 * @param {string} hostname - Hostname to check
 * @returns {boolean} true if blocked
 */
export function isBlockedHost(hostname) {
  if (!hostname) return true;

  const lower = hostname.toLowerCase();

  // Localhost variations
  const localhostNames = [
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
  ];

  if (localhostNames.includes(lower)) return true;

  // Check if it's a private IP
  if (isPrivateIP(lower)) return true;

  return false;
}

/**
 * Validate URL against SSRF protections
 * @param {string} urlStr - URL to validate
 * @returns {{allowed: boolean, reason?: string}}
 */
export function validateUrlSafety(urlStr) {
  try {
    // eslint-disable-next-line no-undef
    const parsed = new URL(urlStr);

    // Check protocol
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { allowed: false, reason: "invalid_protocol" };
    }

    // Check for private/internal hosts
    if (isBlockedHost(parsed.hostname)) {
      return { allowed: false, reason: "private_host_blocked" };
    }

    return { allowed: true };
  } catch (err) {
    return { allowed: false, reason: "invalid_url" };
  }
}

/**
 * Default allowed HTTP methods
 */
const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Check if HTTP method is allowed
 * @param {string} method - HTTP method to check
 * @returns {{allowed: boolean, reason?: string}}
 */
export function isMethodAllowed(method) {
  const upper = method?.toUpperCase();
  if (!upper) return { allowed: false, reason: "missing_method" };

  const allowedMethods = config.http?.allowedMethods || DEFAULT_ALLOWED_METHODS;

  if (!allowedMethods.includes(upper)) {
    return {
      allowed: false,
      reason: "method_not_allowed",
      allowedMethods,
    };
  }

  return { allowed: true };
}

/**
 * Validate redirect URL (for redirect safety)
 * @param {string} url - Redirect target URL
 * @param {Function} isDomainAllowedFn - Domain check function from policy.js
 * @returns {{allowed: boolean, reason?: string}}
 */
export function validateRedirect(url, isDomainAllowedFn) {
  // Re-validate domain allowlist for redirect target
  if (!isDomainAllowedFn(url)) {
    return { allowed: false, reason: "redirect_domain_not_allowed" };
  }

  // Re-validate SSRF protections
  const ssrfCheck = validateUrlSafety(url);
  if (!ssrfCheck.allowed) {
    return { allowed: false, reason: `redirect_${ssrfCheck.reason}` };
  }

  return { allowed: true };
}

/**
 * Fetch options with redirect safety
 * @returns {object} Fetch init options
 */
export function getSecureFetchOptions() {
  return {
    redirect: "manual", // Don't auto-follow, let us validate each redirect
  };
}
