/**
 * V10 Faz A — Sidecar policy hook: path approval, terminal power, capability guard.
 */

import { registerBeforeExecutionHook } from "../tool-hooks.js";
import { getApprovalStore } from "../policy-hooks.js";
import {
  buildSidecarActionPreview,
  fsPathFromToolArgs,
  fsOperationFromTool,
} from "./sidecar-action-preview.js";
import { fsPolicyDecide } from "../../plugins/local-sidecar/fs-path-policy.js";
import {
  isSidecarPowerCommand,
  sidecarTerminalSessionsEnabled,
} from "../../plugins/local-sidecar/sidecar-terminal-config.js";
import { resolvePrincipalScopes } from "../authorization/resolve-principal.js";
import { classifyBrowserUrl } from "../../plugins/local-sidecar/browser-guard.js";

const FS_TOOLS = new Set([
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
]);
const FS_WRITE_TOOLS = new Set(["fs_write", "fs_copy", "fs_move", "fs_delete_to_trash"]);
const DESKTOP_ACTION_TOOLS = new Set([
  "desktop_click",
  "desktop_type",
  "desktop_scroll",
  "desktop_hotkey",
  "desktop_drag",
]);
const CLIPBOARD_TOOLS = new Set(["clipboard_read", "clipboard_write"]);
const BROWSER_TOOLS = new Set([
  "browser_open_url",
  "browser_snapshot",
  "browser_screenshot",
  "browser_extract_links",
  "browser_extract_table",
  "browser_find_text",
  "browser_click",
  "browser_type",
]);
const BROWSER_ACTION_TOOLS = new Set(["browser_click", "browser_type"]);
const TERMINAL_TOOLS = new Set([
  "local_terminal_exec",
  "local_terminal_session_exec",
  "local_terminal_session_create",
]);
const SIDECAR_TOOLS = new Set([
  ...FS_TOOLS,
  ...TERMINAL_TOOLS,
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
  ...BROWSER_TOOLS,
]);

const TOOL_CAPABILITY = {
  fs_list: "fs",
  fs_read: "fs",
  fs_write: "fs",
  fs_hash: "fs",
  fs_stat: "fs",
  fs_recent: "fs",
  fs_search: "fs",
  fs_copy: "fs",
  fs_move: "fs",
  fs_delete_to_trash: "fs",
  local_terminal_exec: "terminal",
  local_terminal_session_create: "terminal",
  local_terminal_session_exec: "terminal",
  local_notify: "notify",
  desktop_screenshot: "desktop",
  desktop_region_screenshot: "desktop",
  desktop_window_screenshot: "desktop",
  desktop_active_window: "desktop",
  desktop_ocr: "desktop",
  desktop_click: "desktop",
  desktop_type: "desktop",
  desktop_scroll: "desktop",
  desktop_hotkey: "desktop",
  desktop_drag: "desktop",
  desktop_focus_app: "desktop",
  clipboard_read: "desktop",
  clipboard_write: "desktop",
  browser_open_url: "browser",
  browser_snapshot: "browser",
  browser_screenshot: "browser",
  browser_extract_links: "browser",
  browser_extract_table: "browser",
  browser_find_text: "browser",
  browser_click: "browser",
  browser_type: "browser",
};

let registered = false;

function isAdmin(context = {}) {
  const scopes = resolvePrincipalScopes(context);
  return scopes.includes("admin");
}

async function requireApproval(toolName, args, context, preview) {
  const store = getApprovalStore();
  if (!store?.createApproval) return null;

  if (context.approvalId) {
    const approval = store.getApproval?.(context.approvalId);
    if (approval?.status === "approved") return null;
  }

  const approval = store.createApproval({
    ruleId: "sidecar_v10_policy",
    path: `/tools/${toolName}`,
    method: context.method || "POST",
    body: args,
    requestedBy: context.user || context.actor || "agent",
    toolName,
    explanation: args.explanation || preview.summary,
    metadata: { preview },
  });

  return {
    ok: false,
    status: "approval_required",
    tool: toolName,
    explanation: args.explanation || preview.summary,
    parameters: args,
    approval: {
      id: approval.id,
      status: "pending",
      createdAt: approval.createdAt,
    },
    message: preview.summary,
    preview,
  };
}

export function registerSidecarPolicyHook() {
  if (registered) return;
  registered = true;

  registerBeforeExecutionHook(async (toolName, args, context = {}) => {
    if (toolName === "sidecar_list_devices" || toolName === "sidecar_set_active") return null;
    if (!SIDECAR_TOOLS.has(toolName)) return null;
    if (context.skipSidecarPolicyCheck) return null;

    if (context.sidecarResolution === "ambiguous") {
      return {
        ok: false,
        error: context.sidecarResolutionError || {
          code: "sidecar_ambiguous",
          message: "Birden fazla Felix Desktop eşleşmiş. Hangi cihazı kullanayım?",
          devices: context.availableSidecars || [],
        },
      };
    }

    const capability = TOOL_CAPABILITY[toolName];
    const deviceCaps = context.sidecarCapabilities;
    if (Array.isArray(deviceCaps) && capability && !deviceCaps.includes(capability)) {
      return {
        ok: false,
        error: {
          code: "sidecar_capability_denied",
          message: `Device lacks '${capability}' capability for ${toolName}`,
        },
      };
    }

    const preview = buildSidecarActionPreview(toolName, args, context);

    if (FS_TOOLS.has(toolName)) {
      const path = fsPathFromToolArgs(toolName, args);
      const op = fsOperationFromTool(toolName, args);
      const policy = fsPolicyDecide(path, op);

      if (policy.blocked) {
        return {
          ok: false,
          error: {
            code: "path_blocked",
            message: policy.reason || "Path blocked by sidecar policy",
            details: { path, classification: policy.classification },
          },
        };
      }

      if (args.destination) {
        const destPolicy = fsPolicyDecide(args.destination, "write");
        if (destPolicy.blocked) {
          return {
            ok: false,
            error: {
              code: "path_blocked",
              message: destPolicy.reason || "Destination path blocked",
              details: { path: args.destination, classification: destPolicy.classification },
            },
          };
        }
      }

      if (FS_WRITE_TOOLS.has(toolName) && !context.approvalId) {
        return requireApproval(toolName, args, context, preview);
      }

      if (policy.requireApproval && !context.approvalId) {
        const needsExplicit =
          policy.classification === "critical" || policy.classification === "sensitive";
        if (needsExplicit) {
          return requireApproval(toolName, args, context, preview);
        }
      }
    }

    if (
      (DESKTOP_ACTION_TOOLS.has(toolName) || CLIPBOARD_TOOLS.has(toolName)) &&
      !context.approvalId
    ) {
      return requireApproval(toolName, args, context, preview);
    }

    if (BROWSER_ACTION_TOOLS.has(toolName) && !context.approvalId) {
      return requireApproval(toolName, args, context, preview);
    }

    if (toolName === "browser_open_url" && args.url && !context.approvalId) {
      const urlClass = classifyBrowserUrl(args.url);
      if (urlClass.classification === "blocked") {
        return {
          ok: false,
          error: { code: "url_blocked", message: urlClass.reason || "URL blocked" },
        };
      }
      if (urlClass.classification === "sensitive") {
        return requireApproval(toolName, args, context, preview);
      }
    }

    if (toolName === "local_terminal_session_create" && !sidecarTerminalSessionsEnabled()) {
      return {
        ok: false,
        error: {
          code: "terminal_sessions_disabled",
          message: "Terminal sessions require sidecar power mode (SIDECAR_TERMINAL_MODE=power)",
        },
      };
    }

    if (
      (toolName === "local_terminal_exec" || toolName === "local_terminal_session_exec") &&
      isSidecarPowerCommand(args.command)
    ) {
      if (!isAdmin(context)) {
        return {
          ok: false,
          error: {
            code: "terminal_power_admin_required",
            message: "Power terminal commands require admin scope",
          },
        };
      }
      if (!context.approvalId) {
        return requireApproval(toolName, args, context, preview);
      }
    }

    return null;
  });
}

/** @internal */
export function resetSidecarPolicyHookForTests() {
  registered = false;
}
