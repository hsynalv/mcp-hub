/**
 * Text Normalizer
 */

export function normalizeText(content) {
  if (typeof content !== "string") return "";
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
