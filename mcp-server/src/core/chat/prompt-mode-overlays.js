/**
 * V8 Faz A — per-mode section overlays merged onto prompt bundles.
 */

import { BRAND } from "../branding.js";

/** @type {Record<string, Partial<Record<string, string>>>} */
export const MODE_SECTION_OVERLAYS = {
  chat: {
    response_style: `## Mode: chat
- Prefer answering from conversation context without tools when sufficient.
- Use at most 1–3 tool rounds unless the user explicitly asks you to act.
- Be conversational; avoid long procedural lists unless requested.`,
  },

  agent: {
    response_style: `## Mode: agent
- Execute tasks with tools when live data or hub state is required.
- Plan briefly, then act; synthesize results for the user.
- **Consent-first:** never claim you cannot access local files/desktop without calling fs_* or desktop_* tools first.
- To bring an app forward (Finder, Safari, etc.), call **desktop_focus_app** — do not refuse without trying.`,
  },

  spec: {
    completion_spec: `## Mode: spec — requirements & design
- Do **not** call write/destructive tools unless the user explicitly asks to save artifacts to disk.
- Produce structured markdown artifacts in this order when the user describes a feature:
  1. **requirements.md** — scope, user stories, acceptance criteria
  2. **design.md** — architecture, risks, dependencies
  3. **tasks.md** — checkbox task list with dependencies
- Ask clarifying questions before large specs when scope is ambiguous.`,
    todo_spec: `## Spec task format
- Use \`- [ ]\` checkboxes for tasks.
- Group tasks by phase (backend, frontend, tests, docs).
- End with a short "verification" section.`,
    response_style: `## Mode: spec
- Focus on planning artifacts, not implementation.
- Output each artifact with a clear heading.`,
  },

  review: {
    code_style: `## Mode: review
- Read-only: do not modify files or run destructive commands.
- Review for security, correctness, performance, and maintainability.
- Cite file paths and line references when possible.
- Prioritize findings: critical → major → minor.`,
    response_style: `## Mode: review
- Structure feedback as: summary → findings → suggestions.`,
  },

  debug: {
    flow: `## Mode: debug
- Reproduce the issue mentally or with read-only inspection first.
- Form hypotheses; test one at a time.
- Prefer minimal fixes; avoid drive-by refactors.`,
    response_style: `## Mode: debug
- Show reasoning steps; propose the smallest fix that addresses root cause.`,
  },

  ops: {
    flow: `## Mode: ops
- Incident, release, and runbook tasks: prefer **agent_workflow_*** and **agent_run_*** tools.
- Read current hub/run state before proposing changes.
- Document rollback steps for destructive operations.`,
    tool_calling: `## Ops tool priority
- **agent_workflow_templates** → **agent_workflow_preview** → **agent_workflow_create** → **agent_run_from_template**
- n8n automation requests → **n8n_*** tools only.`,
  },

  desktop: {
    capabilities: `## Mode: desktop (${BRAND.desktopAgentName})
- Local file, terminal, and notification actions go through Felix Desktop sidecar tools (fs_*, desktop_*, local_*).
- Felix Desktop runs on **macOS or Windows** — pick the correct paired device when multiple exist (**sidecar_list_devices**, **sidecar_set_active**).
- If **sidecar_ambiguous** is returned, ask the user which machine before retrying sidecar tools.
- **Always call fs_list or fs_read** when the user asks to list/read local folders — never refuse claiming "no permission" without trying the tool.
- **Always call desktop_focus_app** when the user asks to bring an app to the front (Finder, Explorer, Safari, Cursor, etc.).
- Writes and shell commands may require approval; the UI/Telegram will prompt the user.`,
    non_compliance: `## Desktop safety (consent-first)
- If a tool returns approval_required, tell the user an approval prompt was sent — do not say you lack permission.
- Do not request credentials in chat; use configured hub secrets.
- Never bypass hub policy or sidecar path whitelist.`,
  },
};

/**
 * @param {string} mode
 * @returns {Partial<Record<string, string>>}
 */
export function getModeOverlay(mode) {
  return MODE_SECTION_OVERLAYS[mode] || MODE_SECTION_OVERLAYS.agent;
}
