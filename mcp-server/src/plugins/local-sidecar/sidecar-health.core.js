/**
 * V10 Faz E — Sidecar dependency + desktop permission health checks.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

async function commandExists(cmd) {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(which, [cmd], { timeout: 3000 });
    return { available: Boolean(stdout.trim()), path: stdout.trim() || null };
  } catch {
    return { available: false, path: null };
  }
}

async function checkPlaywright() {
  try {
    await import("playwright");
    return { available: true, hint: "Run: npx playwright install chromium" };
  } catch {
    return { available: false, hint: "npm install playwright && npx playwright install chromium" };
  }
}

async function probeScreenRecording() {
  if (process.platform === "win32") {
    try {
      const { captureScreenshot } = await import("./desktop.win32.js");
      const shot = await captureScreenshot();
      if (shot.ok && shot.data?.imageBase64) {
        return { granted: true, status: "ok", platform: "win32" };
      }
      return {
        granted: false,
        status: "error",
        hint: shot.error?.hint || "Windows screen capture failed",
        platform: "win32",
      };
    } catch (err) {
      return { granted: false, status: "error", hint: err.message, platform: "win32" };
    }
  }
  if (process.platform !== "darwin") {
    return { granted: null, status: "unknown", hint: "Screen Recording check is macOS-only" };
  }
  const outPath = join(tmpdir(), `felix-screen-probe-${randomUUID()}.png`);
  try {
    await execFileAsync("screencapture", ["-x", outPath], { timeout: 8000 });
    await access(outPath);
    return { granted: true, status: "ok" };
  } catch (err) {
    const msg = String(err.message || err);
    const needs = /not authorized|could not create image/i.test(msg);
    return {
      granted: false,
      status: needs ? "denied" : "error",
      hint: needs
        ? "Sistem Ayarları → Gizlilik → Ekran Kaydı → node izni verin"
        : msg,
    };
  }
}

async function probeAccessibility() {
  if (process.platform !== "darwin") {
    return { granted: null, status: "unknown", hint: "Accessibility check is macOS-only" };
  }
  try {
    await execFileAsync(
      "osascript",
      ["-e", 'tell application "System Events" to get name of first process'],
      { timeout: 5000 }
    );
    return { granted: true, status: "ok" };
  } catch (err) {
    return {
      granted: false,
      status: "denied",
      hint: "Sistem Ayarları → Gizlilik → Erişilebilirlik → node izni verin",
    };
  }
}

async function probeAutomation() {
  if (process.platform !== "darwin") {
    return { granted: null, status: "unknown", hint: "Automation check is macOS-only" };
  }
  try {
    await execFileAsync("osascript", ["-e", 'tell application "Finder" to activate'], { timeout: 5000 });
    return { granted: true, status: "ok" };
  } catch (err) {
    const msg = String(err.message || err);
    const needs = /not authorized to send apple events|apple event/i.test(msg);
    return {
      granted: false,
      status: needs ? "denied" : "error",
      hint: needs
        ? "Sistem Ayarları → Gizlilik → Otomasyon → node → Finder izni verin"
        : msg,
    };
  }
}

/**
 * Check optional/recommended sidecar CLI dependencies.
 */
export async function checkSidecarDependencies() {
  const [tesseract, cliclick, osascript, rclone, playwright] = await Promise.all([
    commandExists("tesseract"),
    commandExists("cliclick"),
    commandExists("osascript"),
    commandExists("rclone"),
    checkPlaywright(),
  ]);

  const checks = [
    {
      name: "tesseract",
      category: "ocr",
      required: false,
      available: tesseract.available,
      path: tesseract.path,
    },
    {
      name: "cliclick",
      category: "desktop",
      required: false,
      available: cliclick.available,
      path: cliclick.path,
      hint: cliclick.available ? null : "brew install cliclick",
    },
    {
      name: "osascript",
      category: "desktop",
      required: process.platform === "darwin",
      available: osascript.available,
      path: osascript.path,
    },
    {
      name: "rclone",
      category: "upload",
      required: false,
      available: rclone.available,
      path: rclone.path,
    },
    {
      name: "playwright",
      category: "browser",
      required: false,
      available: playwright.available,
      hint: playwright.hint,
    },
  ];

  const missingRequired = checks.filter((c) => c.required && !c.available);

  return {
    ok: true,
    data: {
      platform: process.platform,
      checks,
      ready: missingRequired.length === 0,
      missingRequired: missingRequired.map((c) => c.name),
    },
  };
}

/**
 * Probe macOS Screen Recording + Accessibility permissions.
 */
export async function checkDesktopPermissions() {
  const [screenRecording, accessibility, automation] = await Promise.all([
    probeScreenRecording(),
    probeAccessibility(),
    probeAutomation(),
  ]);

  const blockers = [];
  if (screenRecording.granted === false) blockers.push("screen_recording");
  if (accessibility.granted === false) blockers.push("accessibility");
  if (automation.granted === false) blockers.push("automation");

  return {
    ok: true,
    data: {
      platform: process.platform,
      screenRecording,
      accessibility,
      automation,
      ready: blockers.length === 0,
      blockers,
    },
  };
}

export const SIDECAR_CAPABILITY_CATALOG = [
  { id: "fs", label: "Filesystem", tools: ["fs_list", "fs_read", "fs_write", "fs_search"] },
  { id: "terminal", label: "Terminal", tools: ["local_terminal_exec"] },
  { id: "desktop", label: "Desktop", tools: ["desktop_screenshot", "desktop_click"] },
  { id: "notify", label: "Notifications", tools: ["local_notify"] },
  { id: "browser", label: "Browser", tools: ["browser_open_url", "browser_snapshot"] },
];

export function listSidecarCapabilityCatalog() {
  return {
    ok: true,
    data: {
      capabilities: SIDECAR_CAPABILITY_CATALOG,
      defaultPairCapabilities: ["fs", "terminal", "desktop", "notify", "browser"],
    },
  };
}
