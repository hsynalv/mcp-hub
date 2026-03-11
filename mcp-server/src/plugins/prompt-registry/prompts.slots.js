/**
 * Resolve {{slot}} placeholders in prompt text.
 * Order: system → brain (optional) → caller context.
 */

import { homedir } from "os";
import { join } from "path";

const SLOT_REGEX = /\{\{([^}]+)\}\}/g;

const WORKSPACE_ROOT =
  process.env.WORKSPACE_BASE || process.env.WORKSPACE_ROOT || join(homedir(), "Projects");

/** System slots */
function getSystemSlots() {
  return {
    "current_date": new Date().toISOString().split("T")[0],
    "workspace_root": WORKSPACE_ROOT,
  };
}

/** Brain slots — optional; resolve via dynamic import */
let brainResolve = null;

async function ensureBrain() {
  if (brainResolve) return brainResolve;
  try {
    const [ctxMod, memMod] = await Promise.all([
      import("../brain/brain.context.js"),
      import("../brain/brain.memory.js"),
    ]);
    const { buildCompactContext, buildContext } = ctxMod;
    const { getProfile, getProject, listProjects } = memMod;

    brainResolve = async (slot, context = {}) => {
      const namespace = context.namespace || process.env.BRAIN_NAMESPACE || "default";
      const projectId = context.projectId || null;

      if (slot === "brain.recent_memories" || slot === "brain.context") {
        const block = await buildCompactContext({
          projectId,
          maxChars: context.maxContextChars || 4000,
          maxMemories: context.maxMemories || 10,
        });
        return block || "";
      }

      if (slot === "brain.user_preferences") {
        const profile = await getProfile();
        if (!profile || Object.keys(profile).length === 0) return "";
        const lines = ["## User Preferences"];
        if (profile.preferredLanguage) lines.push(`- Language: ${profile.preferredLanguage}`);
        if (profile.codingStyle) lines.push(`- Coding style: ${profile.codingStyle}`);
        if (profile.techStack) lines.push(`- Tech stack: ${profile.techStack}`);
        if (profile.preferences) lines.push(`- Preferences: ${profile.preferences}`);
        return lines.length > 1 ? lines.join("\n") : "";
      }

      if (slot === "brain.active_project") {
        const projects = await listProjects("active");
        const proj = projectId ? await getProject(projectId) : projects[0];
        if (!proj) return "";
        return `## Active Project: ${proj.name}\n${proj.description || ""}\nPath: ${proj.path || "—"}`;
      }

      return "";
    };
    return brainResolve;
  } catch {
    brainResolve = async () => "";
    return brainResolve;
  }
}

/**
 * Resolve all {{slot}} placeholders in text.
 * @param {string} text - Raw prompt text with {{slots}}
 * @param {Object} [context] - Caller context: { namespace, projectId, project_name, user_prefs, ... }
 * @param {{ missingSlotValue?: string }} [options] - missingSlotValue defaults to ""
 * @returns {Promise<string>}
 */
export async function resolveSlots(text, context = {}, options = {}) {
  const missing = options.missingSlotValue ?? "";
  const system = getSystemSlots();
  const caller = context && typeof context === "object" ? context : {};

  let brainResolver = null;
  try {
    brainResolver = await ensureBrain();
  } catch {
    brainResolver = async () => "";
  }

  const replacer = async (match, key) => {
    const k = key.trim();
    if (Object.prototype.hasOwnProperty.call(system, k)) return system[k];
    if (Object.prototype.hasOwnProperty.call(caller, k)) {
      const v = caller[k];
      return v != null ? String(v) : missing;
    }
    if (k.startsWith("brain.")) {
      return await brainResolver(k, context);
    }
    return missing;
  };

  const parts = [];
  let lastIndex = 0;
  let m;
  SLOT_REGEX.lastIndex = 0;
  while ((m = SLOT_REGEX.exec(text)) !== null) {
    parts.push(text.slice(lastIndex, m.index));
    parts.push(replacer(m[0], m[1]));
    lastIndex = SLOT_REGEX.lastIndex;
  }
  parts.push(text.slice(lastIndex));

  const resolved = await Promise.all(parts);
  return resolved.join("");
}
