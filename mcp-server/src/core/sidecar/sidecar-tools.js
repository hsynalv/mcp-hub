/**
 * MCP tools for local sidecar — terminal + desktop notify.
 */

import { registerTool, ToolTags } from "../tool-registry.js";
import { isLocalFsOnServer } from "./pairing.service.js";
import {
  delegateTerminalExec,
  delegateTerminalSessionCreate,
  delegateTerminalSessionExec,
  delegateNotify,
  delegateDesktopScreenshot,
  delegateDesktopRegionScreenshot,
  delegateDesktopWindowScreenshot,
  delegateDesktopActiveWindow,
  delegateDesktopOcr,
  delegateDesktopClick,
  delegateDesktopType,
  delegateDesktopScroll,
  delegateDesktopHotkey,
  delegateDesktopDrag,
  delegateDesktopFocusApp,
  delegateClipboardRead,
  delegateClipboardWrite,
  sidecarRequiredError,
} from "./sidecar-proxy.js";
import { execTerminalCommand } from "../../plugins/local-sidecar/terminal.core.js";
import { sendDesktopNotification } from "../../plugins/local-sidecar/notify.core.js";
import {
  captureScreenshot,
  captureRegionScreenshot,
  captureWindowScreenshot,
  screenshotWithContextGuard,
  getActiveWindow,
  ocrScreenRegion,
  desktopClick,
  desktopType,
  desktopScroll,
  desktopHotkey,
  desktopDrag,
  desktopFocusApp,
} from "../../plugins/local-sidecar/desktop.core.js";
import { clipboardRead, clipboardWrite } from "../../plugins/local-sidecar/clipboard.core.js";

import { registerBrowserTools } from "./browser-tools.js";
import { registerSidecarHealthTools } from "./sidecar-health-tools.js";
import { listSidecarDevices } from "./pairing.service.js";
import { getSidecarStatusPayload } from "./sidecar-routes.js";
import {
  setSidecarPreference,
  resolveSidecarActorId,
  resolveSidecarChannel,
} from "./sidecar-preferences.service.js";
import { formatSidecarDeviceSummary } from "./sidecar-device-resolver.service.js";

function sidecarCtx(context = {}) {
  return context && typeof context === "object" ? context : {};
}

function registerSidecarSelectionTools() {
  registerTool({
    name: "sidecar_list_devices",
    description: "List paired Felix Desktop sidecar devices with online status and platform",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY],
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, context) => {
      const status = await getSidecarStatusPayload();
      const actorId = resolveSidecarActorId(sidecarCtx(context));
      const channel = resolveSidecarChannel(sidecarCtx(context));
      return {
        ok: true,
        data: {
          devices: status.devices,
          aggregateStatus: status.aggregateStatus,
          actorId,
          channel,
        },
      };
    },
  });

  registerTool({
    name: "sidecar_set_active",
    description: "Set the default Felix Desktop device for this actor and channel (chat/telegram/default)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" },
        deviceName: { type: "string" },
        channel: { type: "string", enum: ["default", "chat", "telegram"] },
        explanation: { type: "string" },
      },
    },
    handler: async ({ deviceId, deviceName, channel, explanation }, context) => {
      const ctx = sidecarCtx(context);
      const actorId = resolveSidecarActorId(ctx);
      const ch = channel || resolveSidecarChannel(ctx);
      let targetId = deviceId;
      if (!targetId && deviceName) {
        const devices = await listSidecarDevices();
        const match = devices.find(
          (d) => d.name.toLowerCase() === String(deviceName).trim().toLowerCase()
        );
        if (!match) {
          return {
            ok: false,
            error: {
              code: "sidecar_not_found",
              message: `No device named: ${deviceName}`,
              devices: devices.map(formatSidecarDeviceSummary),
            },
          };
        }
        targetId = match.id;
      }
      if (!targetId) {
        return { ok: false, error: { code: "device_required", message: "deviceId or deviceName required" } };
      }
      const result = await setSidecarPreference(actorId, { channel: ch, deviceId: targetId });
      if (!result.ok) return { ok: false, error: { code: result.error, message: result.error } };
      return {
        ok: true,
        data: {
          ...result,
          explanation,
        },
      };
    },
  });
}

export function registerSidecarTools() {
  registerTool({
    name: "local_terminal_exec",
    description: "Execute an allowlisted shell command on the paired local sidecar (or server in dev)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["command", "explanation"],
    },
    handler: async ({ command, cwd, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const delegated = await delegateTerminalExec(command, { cwd }, sidecarCtx(context));
        if (delegated) return { ...delegated, data: { ...delegated.data, explanation } };
        return sidecarRequiredError();
      }
      const result = await execTerminalCommand(command, { cwd });
      return result.ok
        ? { ok: true, data: { ...result.data, explanation } }
        : result;
    },
  });

  registerTool({
    name: "local_terminal_session_create",
    description: "Create a named terminal session on the local sidecar",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string" } },
    },
    handler: async ({ cwd }, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateTerminalSessionCreate(cwd, sidecarCtx(context))) || sidecarRequiredError();
      }
      const { createTerminalSession } = await import("../../plugins/local-sidecar/terminal.core.js");
      return { ok: true, data: createTerminalSession({ cwd }) };
    },
  });

  registerTool({
    name: "local_terminal_session_exec",
    description: "Run command in an existing sidecar terminal session",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        command: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["sessionId", "command", "explanation"],
    },
    handler: async ({ sessionId, command, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateTerminalSessionExec(sessionId, command, {}, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const { execInSession } = await import("../../plugins/local-sidecar/terminal.core.js");
      const result = await execInSession(sessionId, command);
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "local_notify",
    description: "Send a desktop notification via the paired local sidecar",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        message: { type: "string" },
      },
      required: ["message"],
    },
    handler: async ({ title, message }, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateNotify({ title, message }, sidecarCtx(context))) || sidecarRequiredError();
      }
      return sendDesktopNotification({ title, message });
    },
  });

  registerTool({
    name: "desktop_screenshot",
    description: "Capture the local screen via paired sidecar (observe-only)",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["png", "jpg"], description: "Image format" },
      },
    },
    handler: async ({ format }, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateDesktopScreenshot({ format }, sidecarCtx(context))) || sidecarRequiredError();
      }
      return screenshotWithContextGuard(await captureScreenshot({ format }));
    },
  });

  registerTool({
    name: "desktop_region_screenshot",
    description: "Capture a rectangular screen region via paired sidecar (x, y, width, height)",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        format: { type: "string", enum: ["png", "jpg"] },
      },
      required: ["x", "y", "width", "height"],
    },
    handler: async ({ x, y, width, height, format }, context) => {
      if (!isLocalFsOnServer()) {
        return (
          (await delegateDesktopRegionScreenshot({ x, y, width, height, format }, sidecarCtx(context))) ||
          sidecarRequiredError()
        );
      }
      return screenshotWithContextGuard(
        await captureRegionScreenshot({ x, y, width, height, format })
      );
    },
  });

  registerTool({
    name: "desktop_window_screenshot",
    description: "Capture the frontmost application window via paired sidecar",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["png", "jpg"] },
      },
    },
    handler: async ({ format }, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateDesktopWindowScreenshot({ format }, sidecarCtx(context))) || sidecarRequiredError();
      }
      return screenshotWithContextGuard(await captureWindowScreenshot({ format }));
    },
  });

  registerTool({
    name: "desktop_active_window",
    description: "Get the frontmost application and window title on the local machine",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateDesktopActiveWindow(sidecarCtx(context))) || sidecarRequiredError();
      }
      return getActiveWindow();
    },
  });

  registerTool({
    name: "desktop_ocr",
    description: "OCR text from a screenshot image (base64 from desktop_screenshot)",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        imageBase64: { type: "string", description: "PNG/JPEG base64 payload" },
      },
      required: ["imageBase64"],
    },
    handler: async ({ imageBase64 }, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateDesktopOcr({ imageBase64 }, sidecarCtx(context))) || sidecarRequiredError();
      }
      return ocrScreenRegion({ imageBase64 });
    },
  });

  registerTool({
    name: "desktop_click",
    description: "Click at screen coordinates (requires approval; local sidecar only)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right", "middle"] },
        explanation: { type: "string" },
      },
      required: ["x", "y", "explanation"],
    },
    handler: async ({ x, y, button, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateDesktopClick({ x, y, button }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await desktopClick({ x, y, button });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "desktop_type",
    description: "Type text into the focused window (requires approval; local sidecar only)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["text", "explanation"],
    },
    handler: async ({ text, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateDesktopType({ text }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await desktopType({ text });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "desktop_scroll",
    description: "Scroll the mouse wheel at optional screen coordinates (requires approval)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"], default: "down" },
        amount: { type: "number", default: 3 },
        x: { type: "number" },
        y: { type: "number" },
        explanation: { type: "string" },
      },
      required: ["explanation"],
    },
    handler: async ({ direction, amount, x, y, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateDesktopScroll({ direction, amount, x, y }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await desktopScroll({ direction, amount, x, y });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "desktop_hotkey",
    description: "Send a keyboard shortcut on the local machine (requires approval)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        keys: {
          description: 'Shortcut as string "cmd+c" or array ["command","c"]',
        },
        explanation: { type: "string" },
      },
      required: ["keys", "explanation"],
    },
    handler: async ({ keys, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateDesktopHotkey({ keys }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await desktopHotkey({ keys });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "desktop_drag",
    description: "Drag from one screen coordinate to another (requires approval)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        fromX: { type: "number" },
        fromY: { type: "number" },
        toX: { type: "number" },
        toY: { type: "number" },
        explanation: { type: "string" },
      },
      required: ["fromX", "fromY", "toX", "toY", "explanation"],
    },
    handler: async ({ fromX, fromY, toX, toY, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateDesktopDrag({ fromX, fromY, toX, toY }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await desktopDrag({ fromX, fromY, toX, toY });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "desktop_focus_app",
    description: "Bring an application to the foreground by name",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        appName: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["appName"],
    },
    handler: async ({ appName, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateDesktopFocusApp({ appName }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await desktopFocusApp({ appName });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "clipboard_read",
    description: "Read text from the system clipboard (preview + approval on sensitive context)",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        explanation: { type: "string" },
      },
      required: ["explanation"],
    },
    handler: async ({ explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateClipboardRead(sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await clipboardRead();
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerTool({
    name: "clipboard_write",
    description: "Write text to the system clipboard (requires approval; saves undo)",
    plugin: "local-sidecar",
    tags: [ToolTags.WRITE, ToolTags.NEEDS_APPROVAL, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["text", "explanation"],
    },
    handler: async ({ text, explanation }, context) => {
      if (!isLocalFsOnServer()) {
        const r = await delegateClipboardWrite({ text }, sidecarCtx(context));
        return r ? { ...r, data: r.data ? { ...r.data, explanation } : undefined } : sidecarRequiredError();
      }
      const result = await clipboardWrite({ text });
      return result.ok ? { ok: true, data: { ...result.data, explanation } } : result;
    },
  });

  registerSidecarSelectionTools();
  registerBrowserTools();
  registerSidecarHealthTools();
}
