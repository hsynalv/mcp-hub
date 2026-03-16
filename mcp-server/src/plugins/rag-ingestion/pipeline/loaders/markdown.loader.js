/**
 * Markdown Document Loader
 * Loads and parses markdown content for ingestion.
 */

/**
 * @param {string} content - Raw markdown content
 * @returns {Promise<{ content: string, metadata: Object }>}
 */
export async function loadMarkdown(content) {
  if (typeof content !== "string") {
    throw new Error("Markdown content must be a string");
  }
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Markdown content cannot be empty");
  }
  return {
    content: trimmed,
    metadata: { sourceType: "markdown", hasStructure: /^#{1,6}\s/m.test(trimmed) },
  };
}
