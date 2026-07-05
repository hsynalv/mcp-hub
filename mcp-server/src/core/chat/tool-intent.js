/**
 * Tool intent classifier — narrows the tool surface per user message.
 */

import { detectBrainIntent } from "./brain-intent.js";

/** @typedef {import('./tool-intent.js').ToolIntent} ToolIntent */

export const TOOL_INTENTS = [
  "no_tool",
  "brain_save",
  "brain_recall",
  "project_context",
  "read_repo",
  "modify_files",
  "run_command",
  "desktop_local",
  "external_api",
  "automation",
  "agent_workflow",
  "general",
];

const PROJECT_PATTERNS = [
  /\bprojede\b/i,
  /\bprojesinde\b/i,
  /\bprojesinin\b/i,
  /\bprojesine\b/i,
  /\bproje(?:de|si|sinde|sine|sinin)\b/i,
  /\bproject\b/i,
  /\bworkspace\b/i,
  /\bcontext\s+search\b/i,
];

const CURRENCY_PATTERNS = [
  /\b(?:tl|try|dolar|usd|eur|gbp|₺|\$)\b/i,
  /\b(?:kur|karşılığı|exchange|döviz|çevir)\b/i,
];

const REPO_PATTERNS = [
  /\bgit\b/i,
  /\bcommit\b/i,
  /\bbranch\b/i,
  /\brepo\b/i,
  /\bdiff\b/i,
  /\bpr\b/i,
  /\bpull\s+request\b/i,
];

const MODIFY_PATTERNS = [
  /\b(?:yaz|oluştur|ekle|değiştir|düzenle|sil)\b/i,
  /\b(?:write|create|edit|delete|modify|refactor|implement)\b/i,
  /\b(?:fix|patch)\b/i,
];

const COMMAND_PATTERNS = [
  /\b(?:çalıştır|run|execute|test(?:leri)?)\b/i,
  /\bnpm\b/i,
  /\bvitest\b/i,
  /\bshell\b/i,
];

const API_PATTERNS = [
  /\bgithub\b/i,
  /\bnotion\b/i,
  /\btavily\b/i,
  /\bapi\b/i,
  /\bhttp\b/i,
  /\bfetch\b/i,
];

const LIVE_LOOKUP_PATTERNS = [
  /\b(?:kur|exchange|döviz|çevir|yapıyor)\b/i,
  /\b(?:usd|eur|gbp|try|tl|dolar)\b/i,
  /\b(?:bugün|güncel|current|today)\b/i,
];

const N8N_AUTOMATION_PATTERNS = [/\bn8n\b/i];

const DESKTOP_LOCAL_PATTERNS = [
  /\b(?:mac(?:'|')?im|mac\b|masaüstü|bilgisayar(?:ı|im)?)\b/i,
  /\b(?:documents|dokümanlar|downloads|indirilenler)\b/i,
  /\b(?:klasör|dizin|folder|directory)\b/i,
  /\bliste(?:le|ler|leyebilir)\b/i,
  /\b(?:screenshot|ekran\s*görüntü|screen\s*shot|ss\s*al)\b/i,
  /\b(?:sidecar|felix\s*desktop)\b/i,
  /\b(?:dosya(?:yı|yi)?\s*(?:oku|gönder|aç|listele))\b/i,
  /\b(?:finder|safari|chrome|cursor|spotlight|terminal|iterm)\b/i,
  /\b(?:öne\s*getir|ön(?:e|a)\s*al|focus|activate|bring\s+to\s+front)\b/i,
  /\b(?:uygulama(?:yı|yi)?\s*(?:aç|getir|değiştir|switch))\b/i,
  /\b(?:pano|clipboard|kopyala(?:nan|dı)?|yapıştır)\b/i,
  /\/file\b/i,
  /\/desktop\b/i,
];


/** Hub agent workflow templates (Workflow Designer / runbooks) — not n8n */
const AGENT_WORKFLOW_PATTERNS = [
  /\bworkflow\b/i,
  /\botomasyon\b/i,
  /\bautomation\b/i,
  /\b(?:agent\s+run|runbook)\b/i,
  /\bworkflow\s+(?:oluştur|tasarla|kaydet|template|şablon)/i,
  /\b(?:oluştur|tasarla|kaydet).{0,40}workflow/i,
  /\bworkflow\s+designer\b/i,
  /\badım\s+adım\s+(?:çalıştır|workflow)/i,
  /\bagent_workflow_/i,
  /\brepo-ship-feature\b/i,
  /\brelease-manager\b/i,
];

/** Tool name prefixes / exact names per intent */
export const INTENT_TOOL_MAP = {
  no_tool: [],
  brain_save: ["brain_remember", "brain_update_memory", "brain_forget"],
  brain_recall: [
    "brain_recall",
    "brain_get_context",
    "brain_what_do_you_know_about",
    "brain_get_stats",
    "brain_search_files",
  ],
  project_context: [
    "brain_recall",
    "brain_get_context",
    "project_context_search",
    "project_context_for_goal",
    "project_recent_changes",
    "tavily__",
    "tavily_",
    "rag_search",
    "workspace_search",
    "workspace_read_file",
  ],
  read_repo: [
    "git_status",
    "git_diff",
    "git_log",
    "repo_summary",
    "repo_analyze",
    "repo_recent_commits",
    "workspace_read_file",
    "workspace_search",
    "rag_search",
  ],
  modify_files: [
    "workspace_write_file",
    "workspace_apply_patch",
    "project_generate_code",
    "project_generate_structure",
    "shell_execute",
  ],
  run_command: [
    "shell_execute",
    "shell_session_create",
    "shell_session_output",
    "tests_run",
    "local_terminal_exec",
    "local_terminal_session_create",
    "local_terminal_session_exec",
  ],
  desktop_local: [
    "fs_list",
    "fs_read",
    "fs_write",
    "fs_hash",
    "fs_stat",
    "fs_recent",
    "fs_search",
    "fs_copy",
    "fs_move",
    "fs_delete_to_trash",
    "local_terminal_exec",
    "local_terminal_session_create",
    "local_terminal_session_exec",
    "local_notify",
    "desktop_screenshot",
    "desktop_region_screenshot",
    "desktop_window_screenshot",
    "desktop_active_window",
    "desktop_ocr",
    "desktop_click",
    "desktop_type",
    "desktop_scroll",
    "desktop_hotkey",
    "desktop_drag",
    "desktop_focus_app",
    "clipboard_read",
    "clipboard_write",
    "browser_open_url",
    "browser_snapshot",
    "browser_screenshot",
    "browser_extract_links",
    "browser_extract_table",
    "browser_find_text",
    "browser_click",
    "browser_type",
    "sidecar_dependency_check",
    "desktop_permission_check",
    "sidecar_capabilities",
  ],
  external_api: [
    "tavily__",
    "tavily_",
    "github_",
    "notion_",
    "http_",
    "openapi_",
    "gmail_",
  ],
  automation: ["n8n_"],
  agent_workflow: [
    "agent_workflow_templates",
    "agent_workflow_preview",
    "agent_workflow_create",
    "agent_run_from_template",
    "agent_run_list",
    "agent_run_status",
  ],
  general: [],
};

/**
 * @param {string} message
 * @returns {{ intent: string; confidence: number; reasons: string[]; needsLiveRate?: boolean }}
 */
export function classifyToolIntentRegex(message) {
  const text = typeof message === "string" ? message.trim() : "";
  const reasons = [];

  if (!text || text.length < 3) {
    return { intent: "no_tool", confidence: 0.9, reasons: ["too_short"] };
  }

  const brain = detectBrainIntent(text);
  if (brain.save) {
    return { intent: "brain_save", confidence: 0.95, reasons: ["brain_save_pattern"] };
  }
  if (brain.recall) {
    return { intent: "brain_recall", confidence: 0.95, reasons: ["brain_recall_pattern"] };
  }

  if (N8N_AUTOMATION_PATTERNS.some((p) => p.test(text))) {
    return { intent: "automation", confidence: 0.9, reasons: ["n8n_pattern"] };
  }
  if (AGENT_WORKFLOW_PATTERNS.some((p) => p.test(text))) {
    return { intent: "agent_workflow", confidence: 0.88, reasons: ["agent_workflow_pattern"] };
  }
  if (DESKTOP_LOCAL_PATTERNS.some((p) => p.test(text))) {
    return { intent: "desktop_local", confidence: 0.9, reasons: ["desktop_local_pattern"] };
  }
  if (COMMAND_PATTERNS.some((p) => p.test(text))) {
    return { intent: "run_command", confidence: 0.8, reasons: ["command_pattern"] };
  }
  if (MODIFY_PATTERNS.some((p) => p.test(text))) {
    return { intent: "modify_files", confidence: 0.75, reasons: ["modify_pattern"] };
  }
  if (REPO_PATTERNS.some((p) => p.test(text))) {
    return { intent: "read_repo", confidence: 0.8, reasons: ["repo_pattern"] };
  }

  const hasProjectCue = PROJECT_PATTERNS.some((p) => p.test(text));
  const needsLiveRate = CURRENCY_PATTERNS.some((p) => p.test(text));

  if (hasProjectCue) {
    return {
      intent: "project_context",
      confidence: needsLiveRate ? 0.92 : 0.85,
      reasons: needsLiveRate ? ["project_pattern", "currency_lookup"] : ["project_pattern"],
      needsLiveRate,
    };
  }

  if (needsLiveRate) {
    return {
      intent: "external_api",
      confidence: 0.88,
      reasons: ["currency_lookup"],
      needsLiveRate: true,
    };
  }

  if (API_PATTERNS.some((p) => p.test(text))) {
    const tavily = /\btavily\b/i.test(text);
    const liveLookup = LIVE_LOOKUP_PATTERNS.some((p) => p.test(text));
    return {
      intent: "external_api",
      confidence: tavily || liveLookup ? 0.9 : 0.7,
      reasons: [tavily ? "tavily_pattern" : liveLookup ? "live_lookup_pattern" : "api_pattern"],
    };
  }

  if (/^(?:merhaba|selam|hello|thanks|teşekkür)\b/i.test(text) && text.length < 50) {
    return { intent: "no_tool", confidence: 0.85, reasons: ["greeting"] };
  }

  return { intent: "general", confidence: 0.5, reasons: ["default"] };
}

/**
 * Hybrid classifier entry — async NLP + regex.
 * @param {string} message
 */
export async function classifyToolIntent(message) {
  const { classifyToolIntentHybrid } = await import("./tool-intent-hybrid.js");
  return classifyToolIntentHybrid(message);
}

/**
 * @param {string} intent
 * @param {string} toolName
 */
export function toolMatchesIntent(intent, toolName) {
  if (intent === "general" || intent === "no_tool") return false;

  const patterns = INTENT_TOOL_MAP[intent] || [];
  return patterns.some((p) => {
    if (p.endsWith("_")) return toolName.startsWith(p);
    return toolName === p || toolName.startsWith(`${p}_`);
  });
}

/**
 * Re-order and optionally narrow tools for the detected intent.
 * Always keeps priority tools; shortlist boosts matching tools to the front.
 *
 * @param {Array<{ name: string; plugin?: string; tags?: string[] }>} tools
 * @param {string} intent
 * @param {{ maxTools?: number }} [opts]
 */
export function shortlistToolsForIntent(tools, intent, opts = {}) {
  const maxTools = opts.maxTools ?? 128;
  if (intent === "no_tool") {
    return [];
  }
  if (!tools?.length || intent === "general") {
    return tools.slice(0, maxTools);
  }

  const matched = [];
  const rest = [];

  for (const tool of tools) {
    if (toolMatchesIntent(intent, tool.name)) matched.push(tool);
    else rest.push(tool);
  }

  if (!matched.length) return tools.slice(0, maxTools);

  const seen = new Set();
  const merged = [];
  for (const t of [...matched, ...rest]) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    merged.push(t);
    if (merged.length >= maxTools) break;
  }
  return merged;
}

/**
 * System prompt hint for detected tool intent.
 */
export function buildToolIntentHint(classification) {
  const { intent, reasons, needsLiveRate } = classification;
  if (intent === "no_tool") {
    return "## Tool intent\nAnswer without tools unless you discover missing live data.";
  }
  if (intent === "general") return "";

  const toolNames = (INTENT_TOOL_MAP[intent] || []).filter((t) => !t.endsWith("_")).slice(0, 6);
  const prefixTools = (INTENT_TOOL_MAP[intent] || []).filter((t) => t.endsWith("_"));

  const lines = [
    `## Tool intent: ${intent}`,
    `Signals: ${reasons.join(", ")}`,
    "Prefer tools from this shortlist for this message:",
  ];

  if (toolNames.length) lines.push(`- ${toolNames.join(", ")}`);
  for (const prefix of prefixTools) lines.push(`- ${prefix}*`);
  if (needsLiveRate) {
    lines.push("- Live rate/news: **tavily__tavily_search** only — not n8n_* or invented HTTP APIs.");
  }
  if (intent === "project_context") {
    lines.push("- Do **not** use n8n_* tools — they are workflow builders, not project/business context.");
  }
  if (intent === "agent_workflow") {
    lines.push(
      "- Use **agent_workflow_*** / **agent_run_*** tools for Hub Workflow Designer templates — not n8n_* unless user asked for n8n."
    );
    lines.push("- Flow: list templates → preview draft → create (if new) → run from template.");
  }
  if (intent === "automation") {
    lines.push("- User asked for **n8n** automation — use n8n_* tools, not Hub agent_workflow_* tools.");
  }
  if (intent === "desktop_local") {
    lines.push(
      "- Use **fs_list** / **fs_read** for local folders (~/Documents, Desktop, etc.). Never claim missing permission without calling a tool."
    );
    lines.push("- Multiple sidecars: **sidecar_list_devices** → ask user → **sidecar_set_active** if target unclear.");
    lines.push("- If **sidecar_ambiguous** error: ask which Felix Desktop machine — do not retry without selection.");
    lines.push("- Paths: user home dirs or whitelisted paths. Writes need user approval.");
    lines.push("- Screenshots: **desktop_screenshot**, **desktop_region_screenshot**, **desktop_window_screenshot**.");
    lines.push("- App focus: **desktop_focus_app** (Finder, Explorer, Safari, …) — always call it; never refuse without trying.");
    lines.push("- Clipboard: **clipboard_read** / **clipboard_write** — call the tool; Telegram shows approval buttons when required.");
    lines.push("- File tools: **fs_search**, **fs_recent**, **fs_stat**; copy/move/delete need approval.");
    lines.push("- Desktop control: **desktop_hotkey**, **desktop_scroll**, **desktop_drag** (approval required).");
    lines.push("- Browser: **browser_open_url** → snapshot/extract; **browser_click/type** need approval; login/payment hard-stop.");
    lines.push("- Health: **sidecar_dependency_check**, **desktop_permission_check** for sidecar setup diagnostics.");
  }
  lines.push("- Use the smallest sufficient tool set. Read before write.");

  return lines.join("\n");
}
