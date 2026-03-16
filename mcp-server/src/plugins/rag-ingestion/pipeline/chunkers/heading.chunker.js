/**
 * Heading-Aware / Structure-Aware Chunker
 * Splits markdown at heading boundaries to preserve semantic structure.
 */

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

/**
 * @param {string} text - Normalized markdown/text
 * @param {Object} options
 * @param {number} [options.maxChunkSize=2000]
 * @param {number} [options.maxChunks=100]
 * @returns {Array<{ content: string, metadata: { chunkIndex: number, totalChunks: number, heading?: string, headingPath?: string[] } }>}
 */
export function chunkByHeading(text, options = {}) {
  const maxChunkSize = options.maxChunkSize ?? 2000;
  const maxChunks = options.maxChunks ?? 100;

  if (!text || text.length === 0) return [];

  const sections = splitByHeadings(text);
  const chunks = [];
  const headingStack = [];

  for (const section of sections) {
    if (chunks.length >= maxChunks) break;

    const { heading, level, content } = section;

    if (heading) {
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ heading, level });
    }

    const headingPath = headingStack.map((h) => h.heading);
    const fullContent = heading ? `## ${heading}\n\n${content}` : content;
    const trimmed = fullContent.trim();
    if (!trimmed) continue;

    if (trimmed.length <= maxChunkSize) {
      chunks.push({
        content: trimmed,
        metadata: {
          chunkIndex: chunks.length,
          totalChunks: 0,
          heading: heading || undefined,
          headingPath: headingPath.length ? headingPath : undefined,
        },
      });
    } else {
      const subChunks = splitBySize(trimmed, maxChunkSize);
      for (const c of subChunks) {
        chunks.push({
          content: c,
          metadata: {
            chunkIndex: chunks.length,
            totalChunks: 0,
            heading: heading || undefined,
            headingPath: headingPath.length ? headingPath : undefined,
          },
        });
      }
    }
  }

  chunks.forEach((c) => {
    c.metadata.totalChunks = chunks.length;
  });

  return chunks;
}

function splitByHeadings(text) {
  const sections = [];
  const matches = [...text.matchAll(new RegExp(HEADING_RE.source, "gm"))];

  if (matches.length === 0) {
    if (text.trim()) sections.push({ heading: null, level: 0, content: text.trim() });
    return sections;
  }

  let lastEnd = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const contentBefore = text.slice(lastEnd, m.index).trim();
    if (contentBefore) {
      sections.push({ heading: null, level: 0, content: contentBefore });
    }
    const level = m[1].length;
    const heading = m[2].trim();
    const next = matches[i + 1];
    const content = next
      ? text.slice(m.index + m[0].length, next.index).trim()
      : text.slice(m.index + m[0].length).trim();
    sections.push({ heading, level, content });
    lastEnd = next ? next.index : text.length;
  }

  return sections;
}

function splitBySize(text, size) {
  const result = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline + 1;
    }
    result.push(text.slice(start, end).trim());
    start = end;
  }
  return result.filter(Boolean);
}
