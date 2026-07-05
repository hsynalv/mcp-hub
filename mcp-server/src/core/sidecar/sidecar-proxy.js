/**
 * Proxy local sidecar operations (fs, terminal, notify).
 */

import { touchDevice, isLocalFsOnServer } from "./pairing.service.js";
import { resolveSidecarDevice } from "./sidecar-device-resolver.service.js";
import { auditLog } from "../audit/index.js";
import { signedSidecarHeaders, sidecarSignedRequestsEnabled } from "./sidecar-auth.js";
import { FS_APPROVAL_HEADER } from "../../plugins/local-sidecar/fs-access.js";

export function requiresSidecarDelegation() {
  return !isLocalFsOnServer();
}

export function sidecarRequiredError() {
  return {
    ok: false,
    error: {
      code: "sidecar_required",
      message:
        "Local actions are delegated to a paired sidecar. Run `npm run sidecar:daemon` and pair via POST /sidecar/pair.",
    },
  };
}

function capabilityForOp(op) {
  if (!op || typeof op !== "string") return null;
  if (op.startsWith("fs_")) return "fs";
  if (op.startsWith("terminal")) return "terminal";
  if (op === "desktop_notify") return "notify";
  if (op.startsWith("desktop_")) return "desktop";
  if (op.startsWith("browser_")) return "browser";
  if (op.startsWith("clipboard_")) return "desktop";
  if (op === "sidecar_dependency_check" || op === "desktop_permission_check") return null;
  return null;
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: object|null, op?: string, approvalGranted?: boolean, context?: object }} opts
 */
async function fetchSidecar(path, { method = "GET", body = null, op = "sidecar", approvalGranted = false, context = {} } = {}) {
  if (isLocalFsOnServer()) return null;

  const resolved = await resolveSidecarDevice(context);
  if (!resolved.ok) return resolved;

  const device = resolved.device;

  const capability = capabilityForOp(op);
  const caps = device.capabilities || ["fs"];
  if (capability && !caps.includes(capability)) {
    return {
      ok: false,
      error: {
        code: "sidecar_capability_denied",
        message: `Paired device lacks '${capability}' capability (have: ${caps.join(", ")})`,
        deviceId: device.id,
        deviceName: device.name,
      },
    };
  }

  const start = Date.now();
  try {
    const url = `${device.baseUrl}${path}`;
    const headers = { Accept: "application/json" };
    const bodyStr = body ? JSON.stringify(body) : null;
    if (device.authToken) headers.Authorization = `Bearer ${device.authToken}`;
    if (body) headers["Content-Type"] = "application/json";
    if (approvalGranted) headers[FS_APPROVAL_HEADER] = "1";
    if (sidecarSignedRequestsEnabled() && device.authToken) {
      Object.assign(headers, signedSidecarHeaders(device.authToken, method, path, body));
    }

    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr ?? undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const json = await res.json().catch(() => ({}));
    await touchDevice(device.id);

    void auditLog({
      plugin: "local-sidecar",
      operation: op,
      actor: context.actor || "sidecar-proxy",
      allowed: true,
      success: json.ok !== false,
      durationMs: Date.now() - start,
      metadata: {
        path,
        deviceId: device.id,
        deviceName: device.name,
        resolution: resolved.resolution,
        capability,
        op,
        undoId: json?.data?.undoRecordId || null,
      },
    });

    if (json?.data && typeof json.data === "object") {
      json.data.sidecarDeviceId = device.id;
      json.data.sidecarDeviceName = device.name;
    }

    return json;
  } catch (err) {
    void auditLog({
      plugin: "local-sidecar",
      operation: op,
      actor: context.actor || "sidecar-proxy",
      allowed: true,
      success: false,
      durationMs: Date.now() - start,
      metadata: { path, deviceId: device.id, error: err.message },
    });
    return {
      ok: false,
      error: {
        code: "sidecar_unreachable",
        message: err.message,
        deviceId: device.id,
        deviceName: device.name,
      },
    };
  }
}

function ctxFromParams(params) {
  if (params?.context && typeof params.context === "object") return params.context;
  if (params?._context && typeof params._context === "object") return params._context;
  return {};
}

export async function delegateToSidecar(op, params = {}) {
  const context = ctxFromParams(params);
  const approvalGranted = Boolean(params?.approvalGranted);
  const approvalQuery = approvalGranted ? "&approvalGranted=1" : "";
  const paths = {
    list: `/fs/list?path=${encodeURIComponent(params.path || ".")}${approvalQuery}`,
    read: `/fs/read?path=${encodeURIComponent(params.path)}&maxSize=${params.maxSize || 1048576}${approvalQuery}`,
    write: "/fs/write",
    hash: `/fs/hash?path=${encodeURIComponent(params.path)}${approvalQuery}`,
    stat: `/fs/stat?path=${encodeURIComponent(params.path)}${approvalQuery}`,
    recent: `/fs/recent?path=${encodeURIComponent(params.path || ".")}&limit=${params.limit || 20}&maxDepth=${params.maxDepth || 3}${approvalQuery}`,
    search: `/fs/search?path=${encodeURIComponent(params.path || ".")}&pattern=${encodeURIComponent(params.pattern || "")}&extension=${encodeURIComponent(params.extension || "")}&maxResults=${params.maxResults || 50}&maxDepth=${params.maxDepth || 4}${approvalQuery}`,
  };

  if (op === "write") {
    return fetchSidecar(paths.write, {
      method: "POST",
      body: { ...params, approvalGranted: approvalGranted || undefined },
      op: "fs_write",
      approvalGranted,
      context,
    });
  }
  if (op === "copy") {
    return fetchSidecar("/fs/copy", {
      method: "POST",
      body: { source: params.source, destination: params.destination, approvalGranted: approvalGranted || undefined },
      op: "fs_copy",
      approvalGranted,
      context,
    });
  }
  if (op === "move") {
    return fetchSidecar("/fs/move", {
      method: "POST",
      body: { source: params.source, destination: params.destination, approvalGranted: approvalGranted || undefined },
      op: "fs_move",
      approvalGranted,
      context,
    });
  }
  if (op === "delete_to_trash") {
    return fetchSidecar("/fs/delete-to-trash", {
      method: "POST",
      body: { path: params.path, approvalGranted: approvalGranted || undefined },
      op: "fs_delete_to_trash",
      approvalGranted,
      context,
    });
  }
  const path = paths[op];
  if (!path) return { ok: false, error: { code: "invalid_op", message: `Unknown op: ${op}` } };
  return fetchSidecar(path, { op: `fs_${op}`, approvalGranted, context });
}

function withContext(opts = {}, context = {}) {
  return { ...opts, context: { ...context, ...(opts.context || {}) } };
}

export async function delegateTerminalExec(command, opts = {}, context = {}) {
  return fetchSidecar(
    "/terminal/exec",
    withContext(
      {
        method: "POST",
        body: { command, cwd: opts.cwd, timeoutMs: opts.timeoutMs },
        op: "terminal_exec",
      },
      context
    )
  );
}

export async function delegateTerminalSessionCreate(cwd, context = {}) {
  return fetchSidecar(
    "/terminal/sessions",
    withContext({ method: "POST", body: { cwd }, op: "terminal_session_create" }, context)
  );
}

export async function delegateTerminalSessionExec(sessionId, command, opts = {}, context = {}) {
  return fetchSidecar(
    `/terminal/sessions/${encodeURIComponent(sessionId)}/exec`,
    withContext(
      {
        method: "POST",
        body: { command, timeoutMs: opts.timeoutMs },
        op: "terminal_session_exec",
      },
      context
    )
  );
}

export async function delegateNotify({ title, message }, context = {}) {
  return fetchSidecar(
    "/notify",
    withContext({ method: "POST", body: { title, message }, op: "desktop_notify" }, context)
  );
}

export async function delegateDesktopScreenshot(opts = {}, context = {}) {
  const q = opts.format ? `?format=${encodeURIComponent(opts.format)}` : "";
  return fetchSidecar(`/desktop/screenshot${q}`, withContext({ op: "desktop_screenshot" }, context));
}

export async function delegateDesktopRegionScreenshot(opts = {}, context = {}) {
  const q = new URLSearchParams({
    x: String(opts.x),
    y: String(opts.y),
    width: String(opts.width),
    height: String(opts.height),
    format: opts.format || "png",
  });
  return fetchSidecar(
    `/desktop/screenshot/region?${q}`,
    withContext({ op: "desktop_region_screenshot" }, context)
  );
}

export async function delegateDesktopWindowScreenshot(opts = {}, context = {}) {
  const q = opts.format ? `?format=${encodeURIComponent(opts.format)}` : "";
  return fetchSidecar(
    `/desktop/screenshot/window${q}`,
    withContext({ op: "desktop_window_screenshot" }, context)
  );
}

export async function delegateDesktopActiveWindow(context = {}) {
  return fetchSidecar("/desktop/active-window", withContext({ op: "desktop_active_window" }, context));
}

export async function delegateDesktopOcr(body, context = {}) {
  return fetchSidecar(
    "/desktop/ocr",
    withContext({ method: "POST", body, op: "desktop_ocr" }, context)
  );
}

export async function delegateDesktopClick(body, context = {}) {
  return fetchSidecar(
    "/desktop/click",
    withContext({ method: "POST", body, op: "desktop_click" }, context)
  );
}

export async function delegateDesktopType(body, context = {}) {
  return fetchSidecar(
    "/desktop/type",
    withContext({ method: "POST", body, op: "desktop_type" }, context)
  );
}

export async function delegateDesktopScroll(body, context = {}) {
  return fetchSidecar(
    "/desktop/scroll",
    withContext({ method: "POST", body, op: "desktop_scroll" }, context)
  );
}

export async function delegateDesktopHotkey(body, context = {}) {
  return fetchSidecar(
    "/desktop/hotkey",
    withContext({ method: "POST", body, op: "desktop_hotkey" }, context)
  );
}

export async function delegateDesktopDrag(body, context = {}) {
  return fetchSidecar(
    "/desktop/drag",
    withContext({ method: "POST", body, op: "desktop_drag" }, context)
  );
}

export async function delegateDesktopFocusApp(body, context = {}) {
  return fetchSidecar(
    "/desktop/focus-app",
    withContext({ method: "POST", body, op: "desktop_focus_app" }, context)
  );
}

export async function delegateClipboardRead(context = {}) {
  return fetchSidecar("/clipboard/read", withContext({ op: "clipboard_read" }, context));
}

export async function delegateClipboardWrite(body, context = {}) {
  return fetchSidecar(
    "/clipboard/write",
    withContext({ method: "POST", body, op: "clipboard_write" }, context)
  );
}

export async function delegateBrowserOpen(body, context = {}) {
  return fetchSidecar(
    "/browser/open",
    withContext({ method: "POST", body, op: "browser_open_url" }, context)
  );
}

export async function delegateBrowserSnapshot(context = {}) {
  return fetchSidecar("/browser/snapshot", withContext({ op: "browser_snapshot" }, context));
}

export async function delegateBrowserScreenshot(context = {}) {
  return fetchSidecar("/browser/screenshot", withContext({ op: "browser_screenshot" }, context));
}

export async function delegateBrowserExtractLinks(body, context = {}) {
  const q = body?.maxLinks ? `?maxLinks=${body.maxLinks}` : "";
  return fetchSidecar(
    `/browser/extract-links${q}`,
    withContext({ op: "browser_extract_links" }, context)
  );
}

export async function delegateBrowserExtractTable(body, context = {}) {
  const q = body?.maxTables ? `?maxTables=${body.maxTables}` : "";
  return fetchSidecar(
    `/browser/extract-table${q}`,
    withContext({ op: "browser_extract_table" }, context)
  );
}

export async function delegateBrowserFindText(body, context = {}) {
  const q = new URLSearchParams({
    query: body.query,
    maxMatches: String(body.maxMatches || 10),
  });
  return fetchSidecar(
    `/browser/find-text?${q}`,
    withContext({ op: "browser_find_text" }, context)
  );
}

export async function delegateBrowserClick(body, context = {}) {
  return fetchSidecar(
    "/browser/click",
    withContext({ method: "POST", body, op: "browser_click" }, context)
  );
}

export async function delegateBrowserType(body, context = {}) {
  return fetchSidecar(
    "/browser/type",
    withContext({ method: "POST", body, op: "browser_type" }, context)
  );
}

export async function delegateSidecarDependencies(context = {}) {
  return fetchSidecar("/health/dependencies", withContext({ op: "sidecar_dependency_check" }, context));
}

export async function delegateDesktopPermissions(context = {}) {
  return fetchSidecar("/desktop/permissions", withContext({ op: "desktop_permission_check" }, context));
}
