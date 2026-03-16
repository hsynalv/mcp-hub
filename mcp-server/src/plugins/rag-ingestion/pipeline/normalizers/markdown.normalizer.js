/**
 * Markdown Normalizer
 * Normalizes markdown for consistent chunking (trim, collapse whitespace, preserve structure).
 */

export function normalizeMarkdown(content) {
  if (typeof content !== "string") return "";
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
