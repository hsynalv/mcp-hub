/**
 * V7 — Personal desktop assistant (sidecar status + allowlist + capture).
 */

import { isLocalFsOnServer, listSidecarDevices } from "../sidecar/pairing.service.js";
import { resolveSidecarDevice } from "../sidecar/sidecar-device-resolver.service.js";
import {
  requiresSidecarDelegation,
  delegateDesktopScreenshot,
  delegateDesktopActiveWindow,
  delegateToSidecar,
} from "../sidecar/sidecar-proxy.js";
import {
  captureScreenshot,
  getActiveWindow,
} from "../../plugins/local-sidecar/desktop.core.js";
import { fsRead, fsList } from "../../plugins/local-sidecar/sidecar.core.js";
import { getPersonalDesktopConfig, updatePersonalDesktopConfig, DESKTOP_MODES } from "./personal-desktop-store.js";
import { evaluateScreenSafety } from "./personal-ops.service.js";
import { getPersonalAutonomyState } from "./personal-autonomy.service.js";
import { getSidecarPreference } from "../sidecar/sidecar-preferences.service.js";

function sidecarContext(extra = {}) {
  return extra && typeof extra === "object" ? extra : {};
}

export async function getPersonalDesktopStatus(context = {}) {
  const config = getPersonalDesktopConfig();
  const autonomy = getPersonalAutonomyState();
  const needsSidecar = requiresSidecarDelegation();
  const ctx = sidecarContext(context);
  const resolved = needsSidecar ? await resolveSidecarDevice(ctx) : null;
  const device = resolved?.ok ? resolved.device : null;
  const devices = needsSidecar ? await listSidecarDevices() : [];

  return {
    mode: config.mode,
    effectiveDesktopMode: autonomy.desktopMode,
    modes: DESKTOP_MODES,
    allowlist: {
      apps: config.allowedApps,
      domains: config.allowedDomains,
    },
    sidecar: {
      required: needsSidecar,
      paired: devices.length > 0,
      deviceCount: devices.length,
      deviceName: device?.name || null,
      deviceId: device?.id || null,
      capabilities: device?.capabilities || [],
      resolution: resolved?.resolution || null,
    },
    tools: [
      "desktop_screenshot",
      "desktop_active_window",
      "desktop_ocr",
      "desktop_click",
      "desktop_type",
      "sidecar_list_devices",
      "sidecar_set_active",
    ],
  };
}

export function getDesktopAllowlist() {
  const config = getPersonalDesktopConfig();
  return {
    mode: config.mode,
    allowedApps: config.allowedApps,
    allowedDomains: config.allowedDomains,
  };
}

export function updateDesktopAllowlist(patch) {
  return updatePersonalDesktopConfig(patch);
}

async function activeWindowSnapshot(context = {}) {
  if (isLocalFsOnServer()) {
    const r = await getActiveWindow();
    return r.ok ? { ok: true, data: r.data } : r;
  }
  return delegateDesktopActiveWindow(sidecarContext(context));
}

async function screenshotSnapshot(context = {}) {
  if (isLocalFsOnServer()) {
    return captureScreenshot({ format: "png" });
  }
  return delegateDesktopScreenshot({ format: "png" }, sidecarContext(context));
}

export function isSidecarAmbiguousResult(result) {
  return result?.ok === false && result?.error?.code === "sidecar_ambiguous";
}

export async function capturePersonalDesktopPreview(context = {}) {
  const windowRes = await activeWindowSnapshot(context);
  if (isSidecarAmbiguousResult(windowRes)) {
    return {
      ok: false,
      blocked: false,
      sidecarAmbiguous: true,
      error: windowRes.error,
      activeWindow: null,
      screenshot: null,
      preview: null,
    };
  }
  const windowData = windowRes?.ok ? windowRes.data : null;
  const screenshotRes = await screenshotSnapshot(context);
  if (isSidecarAmbiguousResult(screenshotRes)) {
    return {
      ok: false,
      blocked: false,
      sidecarAmbiguous: true,
      error: screenshotRes.error,
      activeWindow: windowData,
      screenshot: null,
      preview: null,
    };
  }
  const app = windowData?.app || windowData?.application || "";
  const title = windowData?.title || "";

  const safety = evaluateScreenSafety({ app, title });

  return {
    ok: !safety.blocked,
    blocked: safety.blocked,
    safety,
    activeWindow: windowData,
    screenshot: screenshotRes?.ok
      ? {
          captured: true,
          format: screenshotRes.data?.format || "png",
          width: screenshotRes.data?.width,
          height: screenshotRes.data?.height,
          byteLength: screenshotRes.data?.byteLength,
          hasImage: !!(screenshotRes.data?.imageBase64 || screenshotRes.data?.base64),
        }
      : {
          captured: false,
          error: screenshotRes?.error?.message || "Sidecar screenshot unavailable",
          hint: screenshotRes?.error?.hint || null,
        },
    preview: safety.redactedPreview,
  };
}

export async function readPersonalSidecarFile(path, { maxChars = 4000, context = {} } = {}) {
  const ctx = sidecarContext(context);
  const result = isLocalFsOnServer()
    ? await fsRead(path, { maxSize: maxChars * 2 })
    : await delegateToSidecar("read", { path, maxSize: maxChars * 2, context: ctx });
  if (!result?.ok) return result;
  const content = result.data?.content || result.data?.text || "";
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return {
    ok: true,
    data: {
      path,
      preview: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      size: text.length,
    },
  };
}

export async function listPersonalSidecarDir(path = ".", context = {}) {
  if (isLocalFsOnServer()) return fsList(path);
  return delegateToSidecar("list", { path, context: sidecarContext(context) });
}

export async function getTelegramSidecarPreference(chatId) {
  const actorId = `telegram:${chatId}`;
  return getSidecarPreference(actorId, "telegram");
}
