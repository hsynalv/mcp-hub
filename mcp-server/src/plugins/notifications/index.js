/**
 * Notifications Plugin
 *
 * System notifications and alerts for macOS/Linux/Windows.
 * Integrates with native notification systems.
 */

import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { ToolTags } from "../../core/tool-registry.js";

const execAsync = promisify(exec);

// Notification history
const notificationHistory = [];
const MAX_HISTORY = 50;

/**
 * Detect OS
 */
function getOS() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return "unknown";
}

/**
 * Show native notification
 */
async function showNotification(options) {
  const { title, message, sound = false, subtitle, actions = [] } = options;

  if (!title || !message) {
    throw new Error("Title and message are required");
  }

  const os = getOS();
  let command;

  switch (os) {
    case "macos":
      // Use osascript for macOS notifications
      const soundArg = sound ? 'sound name "default"' : "";
      const actionsArg = actions.length > 0
        ? `& «Show» of {button returned:button returned}`
        : "";
      command = `osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" ${subtitle ? `subtitle "${subtitle.replace(/"/g, '\\"')}"` : ""} ${soundArg}'`;
      break;

    case "linux":
      // Try notify-send, fallback to zenity
      const icon = sound ? "dialog-information" : "dialog-info";
      command = `notify-send "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}" --icon=${icon} ${sound ? "--urgency=critical" : ""}`;
      break;

    case "windows":
      // PowerShell notification
      command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${message.replace(/'/g, "''")}', '${title.replace(/'/g, "''")}')"`;
      break;

    default:
      throw new Error(`Notifications not supported on ${os}`);
  }

  try {
    await execAsync(command);

    const notification = {
      id: `notif_${Date.now()}`,
      title,
      message,
      os,
      timestamp: new Date().toISOString(),
      sound,
    };

    notificationHistory.unshift(notification);
    if (notificationHistory.length > MAX_HISTORY) {
      notificationHistory.pop();
    }

    return { success: true, os };
  } catch (err) {
    throw new Error(`Failed to show notification: ${err.message}`);
  }
}

/**
 * Play system sound
 */
async function playSound(soundName = "default") {
  const os = getOS();
  let command;

  switch (os) {
    case "macos":
      command = `afplay /System/Library/Sounds/${soundName}.aiff`;
      break;
    case "linux":
      command = `paplay /usr/share/sounds/freedesktop/stereo/${soundName}.ogg || beep`;
      break;
    case "windows":
      command = `powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\${soundName}.wav").PlaySync()`;
      break;
    default:
      throw new Error(`Sounds not supported on ${os}`);
  }

  try {
    await execAsync(command);
    return { success: true, os, sound: soundName };
  } catch (err) {
    // Sound failure is not critical
    return { success: false, error: err.message };
  }
}

/**
 * Get notification history
 */
function getHistory(limit = 20) {
  return notificationHistory.slice(0, Math.min(limit, MAX_HISTORY));
}

/**
 * Send notification about task completion
 */
async function notifyTaskComplete(taskName, summary, projectName = null) {
  const title = projectName
    ? `✅ ${projectName}: ${taskName}`
    : `✅ Task Complete: ${taskName}`;

  return showNotification({
    title,
    message: summary.substring(0, 100),
    sound: true,
  });
}

/**
 * Send notification about error
 */
async function notifyError(error, context = null) {
  return showNotification({
    title: `❌ Error${context ? `: ${context}` : ""}`,
    message: typeof error === "string" ? error : error.message,
    sound: true,
  });
}

// ── Plugin exports ───────────────────────────────────────────────────────────

export const name = "notifications";
export const version = "1.0.0";
export const description = "System notifications and alerts";
export const capabilities = ["read", "write"];
export const requires = [];
export const endpoints = [
  { method: "POST", path: "/notifications/show", description: "Show a system notification", scope: "write" },
  { method: "POST", path: "/notifications/sound", description: "Play system sound", scope: "write" },
  { method: "GET", path: "/notifications/history", description: "Get notification history", scope: "read" },
  { method: "GET", path: "/notifications/os", description: "Get OS info", scope: "read" },
];
export const examples = [
  'POST /notifications/show  body: {"title":"Done","message":"Task completed"}',
  'POST /notifications/show  body: {"title":"Error","message":"Failed","sound":true}',
  'POST /notifications/sound  body: {"sound":"Ping"}',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "notification_show",
    description: "Show a system notification",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title" },
        message: { type: "string", description: "Notification message" },
        sound: { type: "boolean", default: false, description: "Play sound" },
        subtitle: { type: "string", description: "Subtitle (macOS only)" },
      },
      required: ["title", "message"],
    },
    handler: async (args) => {
      try {
        const result = await showNotification(args);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: { code: "notification_failed", message: err.message } };
      }
    },
  },
  {
    name: "notification_sound",
    description: "Play a system sound",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        sound: { type: "string", default: "default", description: "Sound name" },
      },
    },
    handler: async (args) => {
      const result = await playSound(args.sound);
      return { ok: true, data: result };
    },
  },
  {
    name: "notification_task_complete",
    description: "Notify about task completion",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        taskName: { type: "string", description: "Task name" },
        summary: { type: "string", description: "Task summary" },
        projectName: { type: "string", description: "Project name" },
      },
      required: ["taskName", "summary"],
    },
    handler: async (args) => {
      try {
        const result = await notifyTaskComplete(args.taskName, args.summary, args.projectName);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: { code: "notification_failed", message: err.message } };
      }
    },
  },
  {
    name: "notification_error",
    description: "Notify about an error",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        error: { type: "string", description: "Error message" },
        context: { type: "string", description: "Error context" },
      },
      required: ["error"],
    },
    handler: async (args) => {
      try {
        const result = await notifyError(args.error, args.context);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: { code: "notification_failed", message: err.message } };
      }
    },
  },
  {
    name: "notification_history",
    description: "Get notification history",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20 },
      },
    },
    handler: async (args) => {
      return { ok: true, data: { notifications: getHistory(args.limit || 20) } };
    },
  },
];

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // Show notification
  router.post("/show", async (req, res) => {
    try {
      const result = await showNotification(req.body);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "notification_failed", message: err.message } });
    }
  });

  // Play sound
  router.post("/sound", async (req, res) => {
    const result = await playSound(req.body?.sound || "default");
    res.json({ ok: true, data: result });
  });

  // Get history
  router.get("/history", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    res.json({ ok: true, data: { notifications: getHistory(limit) } });
  });

  // Get OS info
  router.get("/os", (_req, res) => {
    res.json({
      ok: true,
      data: {
        os: getOS(),
        platform: process.platform,
        notificationsSupported: ["macos", "linux", "windows"].includes(getOS()),
      },
    });
  });

  app.use("/notifications", router);
}
