/**
 * Tool classification tags (shared by registry, authorization, policy filters).
 * Kept separate from tool-registry.js to avoid circular imports with execute-tool → authorization.
 */

/** Standard tool tags for policy and UX */
export const ToolTags = {
  READ_ONLY: "read_only",
  WRITE: "write",
  DESTRUCTIVE: "destructive",
  NEEDS_APPROVAL: "needs_approval",
  BULK: "BULK",
  NETWORK: "NETWORK",
  LOCAL_FS: "LOCAL_FS",
  GIT: "GIT",
  EXTERNAL_API: "EXTERNAL_API",
};

/** All valid tags */
export const VALID_TAGS = Object.values(ToolTags);
