/**
 * Brain Context Builder
 * Assembles user profile, relevant memories (with temporal decay),
 * and project info into a structured block ready for LLM system prompt injection.
 */

import {
  getProfile,
  listMemories,
  listProjects,
  getProject,
  getFsSnapshot,
  decayedImportance,
} from "./brain.memory.js";

// ── Formatters ────────────────────────────────────────────────────────────────

function formatProfile(profile) {
  if (!profile || Object.keys(profile).length === 0) return null;

  const lines  = ["## User Profile"];
  const fields = [
    ["name",              "Name"],
    ["preferredLanguage", "Language"],
    ["timezone",          "Timezone"],
    ["techStack",         "Tech Stack"],
    ["codingStyle",       "Coding Style"],
    ["workingHours",      "Working Hours"],
    ["preferences",       "Preferences"],
    ["extra",             "Notes"],
  ];

  for (const [key, label] of fields) {
    if (profile[key]) lines.push(`- ${label}: ${profile[key]}`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatProject(p) {
  if (!p) return null;
  const lines = [`## Active Project: ${p.name}`];
  if (p.description)  lines.push(`Description: ${p.description}`);
  if (p.path)         lines.push(`Local Path: ${p.path}`);
  if (p.stack)        lines.push(`Stack: ${p.stack}`);
  if (p.status)       lines.push(`Status: ${p.status}`);
  if (p.githubRepo)   lines.push(`GitHub: ${p.githubRepo}`);
  if (p.notionPageId) lines.push(`Notion: ${p.notionPageId}`);
  return lines.join("\n");
}

function formatProjectList(projects) {
  if (!projects?.length) return null;
  const lines = ["## Known Projects"];
  for (const p of projects) {
    const badge = p.status === "active" ? "✓" : p.status === "archived" ? "✗" : "~";
    const desc  = p.description || p.stack || "";
    const path  = p.path ? ` (${p.path})` : "";
    lines.push(`- [${badge}] **${p.name}**${path}: ${desc}`);
  }
  return lines.join("\n");
}

function formatMemories(mems) {
  if (!mems?.length) return null;
  const lines = ["## Relevant Memories"];
  for (const m of mems) {
    const tags     = m.tags?.length    ? ` [${m.tags.join(", ")}]` : "";
    const project  = m.projectId       ? ` (${m.projectId})`       : "";
    const confNote = m.confidence < 0.8 ? " ⚠ uncertain"            : "";
    lines.push(`- **[${m.type}]**${project}${tags}${confNote}: ${m.content}`);
  }
  return lines.join("\n");
}

function formatFs(snapshot) {
  if (!snapshot?.summary) return null;
  const age = snapshot.indexedAt
    ? ` _(indexed ${new Date(snapshot.indexedAt).toLocaleDateString()})_`
    : "";
  return `## File System${age}\n${snapshot.summary}`;
}

// ── Context Assembly ──────────────────────────────────────────────────────────

/**
 * Build a complete context block suitable for LLM system prompt injection.
 * Memories are sorted by decayed importance so stale facts naturally rank lower.
 *
 * @param {object} opts
 * @param {string}  [opts.task]         Current task description
 * @param {string}  [opts.projectId]    Active project slug to focus on
 * @param {boolean} [opts.includeFs]    Include FS snapshot section
 * @param {number}  [opts.maxMemories]  Max memory entries (default 20)
 * @returns {Promise<{ contextBlock, profile, projects, memories, hasData }>}
 */
export async function buildContext({
  task        = "",
  projectId   = null,
  includeFs   = false,
  maxMemories = 20,
} = {}) {
  const [profile, allProjects] = await Promise.all([
    getProfile(),
    listProjects("active"),
  ]);

  // Memory list is already sorted by decayed importance in listMemories()
  const memFilter  = projectId ? { projectId, limit: maxMemories } : { limit: maxMemories };
  const memories   = await listMemories(memFilter);

  const activeProject = projectId ? await getProject(projectId) : null;

  const sections = [
    formatProfile(profile),
    activeProject
      ? formatProject(activeProject)
      : formatProjectList(allProjects.slice(0, 8)),
    formatMemories(memories),
  ];

  if (includeFs) {
    const snapshot = await getFsSnapshot();
    sections.push(formatFs(snapshot));
  }

  const contextBlock = sections.filter(Boolean).join("\n\n");
  const header       = task ? `# Brain Context\n_Task: ${task}_\n\n` : "# Brain Context\n\n";

  return {
    contextBlock: header + contextBlock,
    profile,
    projects:  activeProject ? [activeProject] : allProjects,
    memories,
    hasData:
      Object.keys(profile).length > 0 ||
      memories.length > 0              ||
      allProjects.length > 0,
  };
}

/**
 * Compact variant — returns a single string with a character budget,
 * suitable for prepending directly to a chat system prompt.
 */
export async function buildCompactContext({ maxChars = 4_000, ...opts } = {}) {
  const { contextBlock } = await buildContext(opts);
  return contextBlock.length > maxChars
    ? contextBlock.slice(0, maxChars) + "\n\n[...context truncated...]"
    : contextBlock;
}
