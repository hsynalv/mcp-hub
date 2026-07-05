/**
 * V8 Faz A — render builtin prompt bundles + mode overlays for chat system prompt.
 */

import { SECTION_ORDER, DEFAULT_PROMPT_BUNDLE_ID, isChatMode } from "./prompt-constants.js";
import { FELIX_DEFAULT_BUNDLE } from "./prompt-bundles/felix-default.js";
import { getModeOverlay } from "./prompt-mode-overlays.js";
import { AGENT_LOOP_FLOW_SECTION } from "./agent-loop.js";
import { buildMemoryPromptSection } from "./memory-brain-prompt.js";
import { resolveMarketplacePack } from "./prompt-marketplace.js";
import { BRAND } from "../branding.js";

/** @type {Record<string, typeof FELIX_DEFAULT_BUNDLE>} */
const BUILTIN_BUNDLES = {
  [FELIX_DEFAULT_BUNDLE.id]: FELIX_DEFAULT_BUNDLE,
};

const TELEGRAM_CHANNEL_SECTION = `## Telegram channel rules
- The user is on **Telegram** — keep replies concise; you may send a follow-up message with full results after tools finish.
- For **live facts** (news, exchange rates, weather, current events): you **must** call **tavily__tavily_search** — never guess or invent.
- For **Notion projects list**: call **notion_list_projects** — do not list projects from memory alone.
- For **create Notion project**: call **notion_setup_project** (or **notion_add_row** on projects DB) — only say "created" after the tool returns success with id/url.
- **Never** promise future completion ("bir dakika içinde", "oluşturuyorum" without a tool result). Either run the tool now or explain what blocked you.
- When a tool returns a **url** or **id**, include it in your reply.

## Felix Desktop on Telegram (mandatory)
- Local file/desktop/clipboard requests use Felix Desktop sidecar tools (macOS or Windows) — **you have access** when devices are paired.
- If **multiple** Felix Desktop devices are paired and the user did not specify which one: call **sidecar_list_devices**, ask which machine, then **sidecar_set_active** (or tell them \`/desktop use <name>\`).
- If a tool returns **sidecar_ambiguous**, ask the user to pick a device — do not retry blindly.
- **Never** say "I don't have permission" / "yetkim yok" without calling the tool first.
- **App focus** (Finder, Explorer, Safari, Cursor, …) → call **desktop_focus_app** with \`appName\`.
- **Clipboard read** → call **clipboard_read** (user gets Onayla/Reddet buttons if approval is needed).
- **Screenshots** → **desktop_screenshot** / **desktop_window_screenshot** (image is delivered to Telegram automatically).
- If a tool returns **approval_required**, tell the user: "Onay isteği gönderdim — Onayla veya Reddet." Do **not** claim you lack permission.
- If a tool **errors**, quote the tool error — do not invent permission limits.`;

/**
 * @param {Record<string, string | undefined | null>} sections
 */
export function assembleSections(sections) {
  const keys = [...SECTION_ORDER];
  const rest = Object.keys(sections).filter((k) => !SECTION_ORDER.includes(k)).sort();
  for (const k of rest) keys.push(k);

  const parts = [];
  for (const k of keys) {
    const v = sections[k];
    if (v != null && String(v).trim()) parts.push(String(v).trim());
  }
  return parts.join("\n\n");
}

/**
 * @param {string} bundleId
 */
export function getBuiltinBundle(bundleId) {
  return BUILTIN_BUNDLES[bundleId] || BUILTIN_BUNDLES[DEFAULT_PROMPT_BUNDLE_ID];
}

/**
 * @param {{ bundleId?: string; mode?: string; channel?: string | null; chatProfile?: string; marketplacePackId?: string | null }} [opts]
 */
export function renderChatPrompt(opts = {}) {
  const bundleId = opts.bundleId || DEFAULT_PROMPT_BUNDLE_ID;
  const mode = isChatMode(opts.mode) ? opts.mode : "agent";
  const bundle = getBuiltinBundle(bundleId);
  const overlay = getModeOverlay(mode);

  const merged = { ...bundle.sections };
  merged.memory_injection = buildMemoryPromptSection(opts.chatProfile);
  merged.flow = merged.flow
    ? `${merged.flow}\n\n${AGENT_LOOP_FLOW_SECTION}`
    : AGENT_LOOP_FLOW_SECTION;

  const pack = opts.marketplacePackId ? resolveMarketplacePack(opts.marketplacePackId) : null;
  if (pack?.sectionOverlay) {
    for (const [key, value] of Object.entries(pack.sectionOverlay)) {
      if (!value?.trim()) continue;
      merged[key] = merged[key] ? `${merged[key]}\n\n${value.trim()}` : value.trim();
    }
  }

  for (const [key, value] of Object.entries(overlay)) {
    if (!value?.trim()) continue;
    merged[key] = merged[key] ? `${merged[key]}\n\n${value.trim()}` : value.trim();
  }

  const parts = [assembleSections(merged)];

  if (opts.channel === "telegram") {
    parts.push(TELEGRAM_CHANNEL_SECTION);
  }

  return parts.filter(Boolean).join("\n\n");
}

/**
 * Legacy monolith text (fallback when CHAT_PROMPT_LEGACY=1).
 */
export function buildLegacyBasePrompt() {
  return renderChatPrompt({ bundleId: DEFAULT_PROMPT_BUNDLE_ID, mode: "agent" });
}

export function listBuiltinBundles() {
  return Object.values(BUILTIN_BUNDLES).map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    mode: b.mode,
    tags: b.tags,
    provenance: b.provenance,
  }));
}

export { BRAND };
