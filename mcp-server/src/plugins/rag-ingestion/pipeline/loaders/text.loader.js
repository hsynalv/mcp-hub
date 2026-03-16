/**
 * Plain Text Document Loader
 */

/**
 * @param {string} content - Raw text content
 * @returns {Promise<{ content: string, metadata: Object }>}
 */
export async function loadText(content) {
  if (typeof content !== "string") {
    throw new Error("Text content must be a string");
  }
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Text content cannot be empty");
  }
  return {
    content: trimmed,
    metadata: { sourceType: "text", hasStructure: false },
  };
}
