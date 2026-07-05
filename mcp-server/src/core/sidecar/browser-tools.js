/**
 * V10 Faz D — MCP browser tools (sidecar-delegated).
 */

import { registerTool, ToolTags } from "../tool-registry.js";
import { isLocalFsOnServer } from "./pairing.service.js";
import {
  delegateBrowserOpen,
  delegateBrowserSnapshot,
  delegateBrowserScreenshot,
  delegateBrowserExtractLinks,
  delegateBrowserExtractTable,
  delegateBrowserFindText,
  delegateBrowserClick,
  delegateBrowserType,
  sidecarRequiredError,
} from "./sidecar-proxy.js";
import {
  browserOpenUrl,
  browserSnapshot,
  browserScreenshot,
  browserExtractLinks,
  browserExtractTable,
  browserFindText,
  browserClick,
  browserType,
} from "../../plugins/local-sidecar/browser.core.js";

function sidecarCtx(context = {}) {
  return context && typeof context === "object" ? context : {};
}

export function registerBrowserTools() {
  registerTool({
    name: "browser_open_url",
    description: "Open a URL in the sidecar browser session (fetch or Playwright)",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS, ToolTags.NETWORK],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        browser: { type: "string", description: "macOS app name for visual open (default Google Chrome)" },
        explanation: { type: "string" },
      },
      required: ["url", "explanation"],
    },
    handler: async ({ url, browser, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserOpen({ url, browser }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserOpenUrl({ url, browser });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "browser_snapshot",
    description: "Get text preview and structure summary of the current browser session page",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: { explanation: { type: "string" } },
      required: ["explanation"],
    },
    handler: async ({ explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserSnapshot(sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserSnapshot();
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "browser_screenshot",
    description: "Screenshot the current browser page (Playwright or window capture)",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: { explanation: { type: "string" } },
      required: ["explanation"],
    },
    handler: async ({ explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserScreenshot(sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserScreenshot();
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "browser_extract_links",
    description: "Extract anchor links from the current browser session HTML",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        maxLinks: { type: "number", default: 50 },
        explanation: { type: "string" },
      },
      required: ["explanation"],
    },
    handler: async ({ maxLinks, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserExtractLinks({ maxLinks }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserExtractLinks({ maxLinks });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "browser_extract_table",
    description: "Extract HTML tables from the current browser session page",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        maxTables: { type: "number", default: 3 },
        explanation: { type: "string" },
      },
      required: ["explanation"],
    },
    handler: async ({ maxTables, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserExtractTable({ maxTables }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserExtractTable({ maxTables });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "browser_find_text",
    description: "Search visible text in the current browser session page",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxMatches: { type: "number", default: 10 },
        explanation: { type: "string" },
      },
      required: ["query", "explanation"],
    },
    handler: async ({ query, maxMatches, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserFindText({ query, maxMatches }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserFindText({ query, maxMatches });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "browser_click",
    description: "Click an element by CSS selector (Playwright; approval required)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["selector", "explanation"],
    },
    handler: async ({ selector, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserClick({ selector }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserClick({ selector });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "browser_type",
    description: "Type into an input by CSS selector (Playwright; approval required)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["selector", "text", "explanation"],
    },
    handler: async ({ text, selector, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateBrowserType({ selector, text }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await browserType({ selector, text });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });
}
