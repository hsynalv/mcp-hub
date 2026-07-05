/**
 * Desktop control — observe (screenshot, active window, OCR) + assisted actions (click, type).
 * Local-only; invoked via sidecar daemon on 127.0.0.1.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { assertDesktopActionAllowed, detectSensitiveContext } from "./desktop-guard.js";
import * as win32Desktop from "./desktop.win32.js";

const execFileAsync = promisify(execFile);

function imageDimensionsFromBuffer(buf, ext) {
  if (!buf || buf.length < 24) return null;
  if (ext === "png" && buf.toString("ascii", 1, 4) === "PNG") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

async function captureScreencaptureToBase64(args, format = "png") {
  const platform = process.platform;
  const ext = format === "jpg" ? "jpg" : "png";
  const outPath = join(tmpdir(), `mcp-hub-screenshot-${randomUUID()}.${ext}`);

  try {
    await execFileAsync("screencapture", [...args, "-x", `-t${ext}`, outPath], { timeout: 15_000 });
    const buf = await readFile(outPath);
    const dims = imageDimensionsFromBuffer(buf, ext);
    return {
      ok: true,
      data: {
        platform,
        format: ext,
        imageBase64: buf.toString("base64"),
        byteLength: buf.length,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        capturedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const msg = String(err.message || err);
    const needsScreenRecording =
      /could not create image from display|screen capture|not authorized/i.test(msg);
    return {
      ok: false,
      error: {
        code: "screenshot_failed",
        message: msg,
        hint: needsScreenRecording
          ? "macOS: Sistem Ayarları → Gizlilik ve Güvenlik → Ekran Kaydı → node izni verin"
          : "Grant Screen Recording permission to the sidecar process",
      },
    };
  } finally {
    await unlink(outPath).catch(() => {});
  }
}

async function getFrontWindowBounds() {
  if (process.platform !== "darwin") return null;
  try {
    const script = `
      tell application "System Events"
        tell (first application process whose frontmost is true)
          tell front window
            set p to position
            set s to size
            return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
          end tell
        end tell
      end tell
    `;
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 8000 });
    const [x, y, width, height] = String(stdout)
      .trim()
      .split(",")
      .map((n) => parseInt(n, 10));
    if ([x, y, width, height].some((n) => Number.isNaN(n) || n < 0)) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

async function runOsascript(script) {
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 10_000 });
  return stdout.trim();
}

async function currentWindowContext() {
  const win = await getActiveWindow();
  if (!win.ok) return { app: "", title: "" };
  return { app: win.data?.app || "", title: win.data?.title || "" };
}

export async function captureScreenshot({ format = "png" } = {}) {
  const platform = process.platform;
  if (platform === "win32") return win32Desktop.captureScreenshot({ format });
  if (platform !== "darwin") {
    return {
      ok: true,
      data: {
        platform,
        stub: true,
        message: "Screenshot capture requires macOS sidecar with Screen Recording permission",
        imageBase64: null,
        width: null,
        height: null,
      },
    };
  }
  return captureScreencaptureToBase64([], format);
}

/** Capture a rectangular screen region (macOS screencapture -R). */
export async function captureRegionScreenshot({ x, y, width, height, format = "png" } = {}) {
  const platform = process.platform;
  if (platform === "win32") return win32Desktop.captureRegionScreenshot({ x, y, width, height, format });
  if (platform !== "darwin") {
    return {
      ok: true,
      data: {
        platform,
        stub: true,
        message: "Region screenshot requires macOS sidecar",
        imageBase64: null,
      },
    };
  }
  if ([x, y, width, height].some((n) => typeof n !== "number" || Number.isNaN(n))) {
    return {
      ok: false,
      error: { code: "invalid_region", message: "x, y, width, height (numbers) required" },
    };
  }
  const result = await captureScreencaptureToBase64(
    ["-R", `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`],
    format
  );
  if (result.ok) {
    result.data.region = { x, y, width, height };
  }
  return result;
}

/** Capture the frontmost application window bounds. */
export async function captureWindowScreenshot({ format = "png" } = {}) {
  const platform = process.platform;
  if (platform === "win32") return win32Desktop.captureWindowScreenshot({ format });
  if (platform !== "darwin") {
    return {
      ok: true,
      data: {
        platform,
        stub: true,
        message: "Window screenshot requires macOS sidecar",
        imageBase64: null,
      },
    };
  }

  const win = await getActiveWindow();
  const bounds = await getFrontWindowBounds();
  if (!bounds) {
    return {
      ok: false,
      error: {
        code: "window_bounds_failed",
        message: "Could not read front window bounds",
        hint: "Grant Accessibility permission to the sidecar process",
      },
    };
  }

  const result = await captureRegionScreenshot({ ...bounds, format });
  if (result.ok) {
    result.data.window = {
      app: win.data?.app || null,
      title: win.data?.title || null,
      bounds,
    };
  }
  return result;
}

/** Attach sensitive-context metadata; blocks delivery when login/payment UI detected. */
export async function screenshotWithContextGuard(shotResult) {
  if (!shotResult?.ok) return shotResult;
  const { app, title } = await currentWindowContext();
  const sensitivity = detectSensitiveContext({ app, title });
  if (sensitivity.sensitive) {
    return {
      ...shotResult,
      data: {
        ...shotResult.data,
        sensitiveContext: true,
        sensitiveReasons: sensitivity.reasons,
        deliveryBlocked: true,
      },
    };
  }
  return shotResult;
}

export async function getActiveWindow() {
  const platform = process.platform;

  if (platform === "win32") return win32Desktop.getActiveWindow();

  if (platform === "darwin") {
    try {
      const app = await runOsascript(
        'tell application "System Events" to get name of first application process whose frontmost is true'
      );
      const title = await runOsascript(
        'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'
      ).catch(() => "");
      return {
        ok: true,
        data: { platform, app, title, capturedAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "active_window_failed",
          message: err.message,
          hint: "Grant Accessibility permission to the sidecar process",
        },
      };
    }
  }

  return {
    ok: true,
    data: {
      platform,
      stub: true,
      app: "unknown",
      title: "",
      message: "Active window detection not implemented for this platform",
    },
  };
}

async function ocrWithTesseract(imageBase64) {
  const inPath = join(tmpdir(), `mcp-hub-ocr-in-${randomUUID()}.png`);
  const outBase = join(tmpdir(), `mcp-hub-ocr-out-${randomUUID()}`);
  try {
    await writeFile(inPath, Buffer.from(imageBase64, "base64"));
    await execFileAsync("tesseract", [inPath, outBase, "-l", "eng"], { timeout: 30_000 });
    const text = await readFile(`${outBase}.txt`, "utf8");
    return text.trim();
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(`${outBase}.txt`).catch(() => {});
  }
}

/** OCR via tesseract when installed; otherwise returns stub hint. */
export async function ocrScreenRegion({ imageBase64 } = {}) {
  if (!imageBase64) {
    return { ok: false, error: { code: "missing_image", message: "imageBase64 required (from desktop_screenshot)" } };
  }

  const byteLength = Buffer.from(imageBase64, "base64").length;
  const platform = process.platform;

  if (platform === "win32") {
    return win32Desktop.ocrScreenRegion({ imageBase64 });
  }

  try {
    const { stdout } = await execFileAsync("which", ["tesseract"], { timeout: 3000 });
    if (stdout.trim()) {
      const text = await ocrWithTesseract(imageBase64);
      return {
        ok: true,
        data: {
          stub: false,
          text,
          engine: "tesseract",
          byteLength,
        },
      };
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      return {
        ok: false,
        error: { code: "ocr_failed", message: err.message, byteLength },
      };
    }
  }

  return {
    ok: true,
    data: {
      stub: true,
      text: "",
      hint: "Install tesseract (brew install tesseract) or pass screenshot to a vision model for OCR",
      byteLength,
    },
  };
}

async function ocrPreflightCheck() {
  if (process.env.DESKTOP_OCR_REQUIRED !== "true") return { ok: true };

  const shot = await captureScreenshot();
  if (!shot.ok || !shot.data?.imageBase64) {
    return {
      ok: false,
      error: {
        code: "ocr_required_failed",
        message: "DESKTOP_OCR_REQUIRED=true but screenshot capture failed",
      },
    };
  }

  const ocr = await ocrScreenRegion({ imageBase64: shot.data.imageBase64 });
  const text = ocr.data?.text || "";
  const { app, title } = await currentWindowContext();
  const sensitivity = detectSensitiveContext({ app, title, ocrText: text });
  if (sensitivity.sensitive) {
    return {
      ok: false,
      error: {
        code: "ocr_sensitive_context",
        message: "OCR preflight blocked action on sensitive screen content",
        reasons: sensitivity.reasons,
      },
    };
  }

  return { ok: true, ocrPreview: text.slice(0, 200) };
}

async function guardedDesktopAction(action, extra = {}, run) {
  const ocrGate = await ocrPreflightCheck();
  if (!ocrGate.ok) return ocrGate;

  const { app, title } = await currentWindowContext();
  const guard = assertDesktopActionAllowed({ action, app, title, ...extra });
  if (!guard.ok) return guard;

  return run(guard, { app, title });
}

const HOTKEY_MODIFIERS = {
  command: "command down",
  cmd: "command down",
  control: "control down",
  ctrl: "control down",
  option: "option down",
  alt: "option down",
  shift: "shift down",
};

function parseHotkeyKeys(keys) {
  const parts = Array.isArray(keys)
    ? keys.map((k) => String(k).trim().toLowerCase())
    : String(keys)
        .split("+")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);

  const modifiers = [];
  let key = null;
  for (const part of parts) {
    if (HOTKEY_MODIFIERS[part]) modifiers.push(HOTKEY_MODIFIERS[part]);
    else key = part;
  }
  if (!key) {
    return { ok: false, error: { code: "invalid_hotkey", message: "Hotkey must include a key (e.g. cmd+c)" } };
  }
  return { ok: true, key, modifiers };
}

export async function desktopScroll({ direction = "down", amount = 3, x, y } = {}) {
  return guardedDesktopAction("scroll", { x, y }, async (guard) => {
    const platform = process.platform;
    if (platform === "win32") {
      const r = await win32Desktop.desktopScroll({ direction, amount, x, y });
      return r.ok ? { ...r, data: { ...r.data, preview: guard.data.preview } } : r;
    }
    if (platform !== "darwin") {
      return {
        ok: false,
        error: { code: "unsupported_platform", message: `desktop_scroll not supported on ${platform}` },
      };
    }

    const notches = Math.min(Math.max(Number(amount) || 3, 1), 20);
    const wheel =
      direction === "up" ? notches : direction === "down" ? -notches : direction === "left" ? notches : -notches;

    try {
      const args = [];
      if (x != null && y != null) args.push(`m:${Math.round(x)},${Math.round(y)}`);
      args.push(`w:${wheel}`);
      await execFileAsync("cliclick", args, { timeout: 5000 });
      return {
        ok: true,
        data: { direction, amount: notches, x, y, platform, preview: guard.data.preview },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "scroll_failed",
          message: err.message,
          hint: "Install cliclick (brew install cliclick) or grant Accessibility permission",
        },
      };
    }
  });
}

export async function desktopHotkey({ keys } = {}) {
  if (!keys || (Array.isArray(keys) && keys.length === 0)) {
    return { ok: false, error: { code: "invalid_hotkey", message: "keys required (e.g. cmd+c or ['command','c'])" } };
  }

  const parsed = parseHotkeyKeys(keys);
  if (!parsed.ok) return parsed;

  return guardedDesktopAction("hotkey", {}, async (guard) => {
    const platform = process.platform;
    if (platform === "win32") {
      const r = await win32Desktop.desktopHotkey({ keys });
      return r.ok ? { ...r, data: { ...r.data, preview: guard.data.preview } } : r;
    }
    if (platform !== "darwin") {
      return {
        ok: false,
        error: { code: "unsupported_platform", message: `desktop_hotkey not supported on ${platform}` },
      };
    }

    try {
      const modClause =
        parsed.modifiers.length > 0
          ? ` using {${parsed.modifiers.join(", ")}}`
          : "";
      const keyLiteral =
        parsed.key.length === 1
          ? `"${parsed.key}"`
          : parsed.key === "return" || parsed.key === "enter"
            ? "return"
            : `"${parsed.key}"`;
      await runOsascript(`tell application "System Events" to keystroke ${keyLiteral}${modClause}`);
      return {
        ok: true,
        data: { keys, platform, preview: guard.data.preview },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "hotkey_failed",
          message: err.message,
          hint: "Grant Accessibility permission to the sidecar process",
        },
      };
    }
  });
}

export async function desktopDrag({ fromX, fromY, toX, toY } = {}) {
  const coordCheck = validateCoordinates({ x: fromX, y: fromY });
  if (!coordCheck.ok) return coordCheck;
  const toCheck = validateCoordinates({ x: toX, y: toY });
  if (!toCheck.ok) return toCheck;

  return guardedDesktopAction("drag", { fromX, fromY, toX, toY }, async (guard) => {
    const platform = process.platform;
    if (platform === "win32") {
      const r = await win32Desktop.desktopDrag({ fromX, fromY, toX, toY });
      return r.ok ? { ...r, data: { ...r.data, preview: guard.data.preview } } : r;
    }
    if (platform !== "darwin") {
      return {
        ok: false,
        error: { code: "unsupported_platform", message: `desktop_drag not supported on ${platform}` },
      };
    }

    try {
      await execFileAsync(
        "cliclick",
        [`dd:${Math.round(fromX)},${Math.round(fromY)}`, `dm:${Math.round(toX)},${Math.round(toY)}`, `du:${Math.round(toX)},${Math.round(toY)}`],
        { timeout: 8000 }
      );
      return {
        ok: true,
        data: { fromX, fromY, toX, toY, platform, preview: guard.data.preview },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "drag_failed",
          message: err.message,
          hint: "Install cliclick (brew install cliclick)",
        },
      };
    }
  });
}

export async function desktopFocusApp({ appName } = {}) {
  if (!appName) {
    return { ok: false, error: { code: "missing_app", message: "appName required" } };
  }

  const platform = process.platform;
  if (platform === "win32") return win32Desktop.desktopFocusApp({ appName });
  if (platform !== "darwin") {
    return {
      ok: false,
      error: { code: "unsupported_platform", message: `desktop_focus_app not supported on ${platform}` },
    };
  }

  try {
    const escaped = String(appName).replace(/"/g, '\\"');
    await runOsascript(`tell application "${escaped}" to activate`);
    return {
      ok: true,
      data: { appName, platform, focusedAt: new Date().toISOString() },
    };
  } catch (err) {
    const msg = String(err.message || err);
    const needsAutomation = /not authorized to send apple events|apple event/i.test(msg);
    return {
      ok: false,
      error: {
        code: "focus_failed",
        message: msg,
        hint: needsAutomation
          ? "macOS: Sistem Ayarları → Gizlilik ve Güvenlik → Otomasyon → node → Finder izni verin"
          : "Uygulama adını kontrol edin (ör. Finder, Safari, Cursor)",
      },
    };
  }
}

export async function desktopClick({ x, y, button = "left" } = {}) {
  const ocrGate = await ocrPreflightCheck();
  if (!ocrGate.ok) return ocrGate;

  const { app, title } = await currentWindowContext();
  const guard = assertDesktopActionAllowed({ action: "click", app, title, x, y });
  if (!guard.ok) return guard;

  const platform = process.platform;
  if (platform === "win32") {
    const r = await win32Desktop.desktopClick({ x, y, button });
    return r.ok ? { ...r, data: { ...r.data, preview: guard.data.preview } } : r;
  }
  if (platform === "darwin") {
    try {
      await execFileAsync("cliclick", [`${button}:${x},${y}`], { timeout: 5000 });
      return { ok: true, data: { x, y, button, platform, preview: guard.data.preview } };
    } catch {
      try {
        await runOsascript(`tell application "System Events" to click at {${x}, ${y}}`);
        return {
          ok: true,
          data: { x, y, button, platform, method: "osascript", preview: guard.data.preview },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "click_failed",
            message: err.message,
            hint: "Install cliclick (brew install cliclick) or grant Accessibility permission",
            preview: guard.data?.preview,
          },
        };
      }
    }
  }

  return {
    ok: false,
    error: { code: "unsupported_platform", message: `desktop_click not supported on ${platform}` },
  };
}

export async function desktopType({ text, delayMs = 0 } = {}) {
  if (!text) {
    return { ok: false, error: { code: "empty_text", message: "text required" } };
  }

  const ocrGate = await ocrPreflightCheck();
  if (!ocrGate.ok) return ocrGate;

  const { app, title } = await currentWindowContext();
  const guard = assertDesktopActionAllowed({ action: "type", app, title });
  if (!guard.ok) return guard;

  const platform = process.platform;
  if (platform === "win32") {
    const r = await win32Desktop.desktopType({ text, delayMs });
    return r.ok ? { ...r, data: { ...r.data, preview: guard.data.preview } } : r;
  }
  if (platform === "darwin") {
    try {
      const escaped = String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await runOsascript(`tell application "System Events" to keystroke "${escaped}"`);
      return {
        ok: true,
        data: { length: text.length, platform, delayMs, preview: guard.data.preview },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "type_failed",
          message: err.message,
          hint: "Grant Accessibility permission to the sidecar process",
          preview: guard.data?.preview,
        },
      };
    }
  }

  return {
    ok: false,
    error: { code: "unsupported_platform", message: `desktop_type not supported on ${platform}` },
  };
}
