/**
 * Windows desktop automation for Felix Desktop sidecar.
 * Uses @nut-tree-fork/nut-js when available; PowerShell/.NET fallbacks otherwise.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

/** @type {Promise<any>|null} */
let nutLoadPromise = null;

async function loadNut() {
  if (!nutLoadPromise) {
    nutLoadPromise = import("@nut-tree-fork/nut-js")
      .then((m) => m.default || m)
      .catch(() => null);
  }
  return nutLoadPromise;
}

async function runPowerShell(script, timeout = 30_000) {
  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout, maxBuffer: 8 * 1024 * 1024 }
  );
  return stdout.trim();
}

function imageDimensionsFromBuffer(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.toString("ascii", 1, 4) === "PNG") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

async function captureScreenBase64PowerShell({ x, y, width, height } = {}) {
  const regionScript =
    x != null && y != null && width != null && height != null
      ? `$bounds = New-Object System.Drawing.Rectangle(${x}, ${y}, ${width}, ${height})`
      : `$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds`;

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
${regionScript}
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
`;
  return runPowerShell(script, 20_000);
}

export async function captureScreenshot({ format = "png" } = {}) {
  try {
    const nut = await loadNut();
    if (nut?.screen?.grab) {
      const img = await nut.screen.grab();
      const w = img.width;
      const h = img.height;
      const rgba = img.data;
      const pngBuf = await rgbaToPngBuffer(rgba, w, h).catch(() => null);
      if (pngBuf) {
        return {
          ok: true,
          data: {
            platform: "win32",
            format: "png",
            imageBase64: pngBuf.toString("base64"),
            byteLength: pngBuf.length,
            width: w,
            height: h,
            capturedAt: new Date().toISOString(),
            method: "nut-js",
          },
        };
      }
    }
    const b64 = await captureScreenBase64PowerShell();
    const buf = Buffer.from(b64, "base64");
    const dims = imageDimensionsFromBuffer(buf);
    return {
      ok: true,
      data: {
        platform: "win32",
        format: format === "jpg" ? "jpg" : "png",
        imageBase64: b64,
        byteLength: buf.length,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        capturedAt: new Date().toISOString(),
        method: "powershell",
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "screenshot_failed",
        message: err.message,
        hint: "Windows: Ekran yakalama izni veya oturum açık olmalı. @nut-tree-fork/nut-js kurulu mu kontrol edin.",
      },
    };
  }
}

async function rgbaToPngBuffer(_rgba, _w, _h) {
  return null;
}

export async function captureRegionScreenshot({ x, y, width, height, format = "png" } = {}) {
  try {
    const b64 = await captureScreenBase64PowerShell({ x, y, width, height });
    const buf = Buffer.from(b64, "base64");
    const dims = imageDimensionsFromBuffer(buf);
    return {
      ok: true,
      data: {
        platform: "win32",
        format: format === "jpg" ? "jpg" : "png",
        imageBase64: b64,
        byteLength: buf.length,
        width: dims?.width ?? width,
        height: dims?.height ?? height,
        capturedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "region_screenshot_failed", message: err.message } };
  }
}

export async function captureWindowScreenshot({ format = "png" } = {}) {
  const win = await getActiveWindow();
  if (!win.ok) return win;
  return captureScreenshot({ format });
}

export async function getActiveWindow() {
  try {
    const ps = `(Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Sort-Object -Property MainWindowHandle -Descending | Select-Object -First 1 | ForEach-Object { $_.ProcessName + '|' + $_.MainWindowTitle })`;
    const { stdout } = await execFileAsync("powershell", ["-Command", ps], { timeout: 8000 });
    const [app, title] = String(stdout).trim().split("|");
    return {
      ok: true,
      data: { platform: "win32", app: app || "unknown", title: title || "", capturedAt: new Date().toISOString() },
    };
  } catch (err) {
    return { ok: false, error: { code: "active_window_failed", message: err.message } };
  }
}

export async function desktopFocusApp({ appName } = {}) {
  if (!appName) {
    return { ok: false, error: { code: "missing_app", message: "appName required" } };
  }
  try {
    const nut = await loadNut();
    if (nut?.getWindows && nut?.focusWindow) {
      const windows = await nut.getWindows();
      const match = windows.find((w) =>
        String(w.title || "").toLowerCase().includes(String(appName).toLowerCase())
      );
      if (match) {
        await nut.focusWindow(match);
        return { ok: true, data: { appName, platform: "win32", focusedAt: new Date().toISOString(), method: "nut-js" } };
      }
    }
    const escaped = String(appName).replace(/'/g, "''");
    await runPowerShell(
      `$p = Get-Process | Where-Object { $_.ProcessName -like '*${escaped}*' -or $_.MainWindowTitle -like '*${escaped}*' } | Select-Object -First 1; if (-not $p) { throw 'Process not found' }; (New-Object -ComObject WScript.Shell).AppActivate($p.Id)`,
      10_000
    );
    return { ok: true, data: { appName, platform: "win32", focusedAt: new Date().toISOString(), method: "powershell" } };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "focus_failed",
        message: err.message,
        hint: "Uygulama adını kontrol edin (ör. explorer, chrome, Cursor)",
      },
    };
  }
}

export async function desktopClick({ x, y, button = "left" } = {}) {
  try {
    const nut = await loadNut();
    if (nut?.mouse?.setPosition && nut?.mouse?.click) {
      const btn = nut.Button?.LEFT || nut.Button?.left || 0;
      await nut.mouse.setPosition({ x, y });
      await nut.mouse.click(btn);
      return { ok: true, data: { x, y, button, platform: "win32", method: "nut-js" } };
    }
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y}); Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
'@; Mouse::mouse_event(${button === "right" ? 0x0008 : 0x0002}, 0, 0, 0, 0)`,
      8000
    );
    return { ok: true, data: { x, y, button, platform: "win32", method: "powershell" } };
  } catch (err) {
    return { ok: false, error: { code: "click_failed", message: err.message } };
  }
}

export async function desktopType({ text, delayMs = 0 } = {}) {
  if (!text) return { ok: false, error: { code: "empty_text", message: "text required" } };
  try {
    const nut = await loadNut();
    if (nut?.keyboard?.type) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      await nut.keyboard.type(text);
      return { ok: true, data: { length: text.length, platform: "win32", method: "nut-js" } };
    }
    const escaped = String(text).replace(/'/g, "''");
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
      15_000
    );
    return { ok: true, data: { length: text.length, platform: "win32", method: "sendkeys" } };
  } catch (err) {
    return { ok: false, error: { code: "type_failed", message: err.message } };
  }
}

export async function desktopScroll({ direction = "down", amount = 3, x, y } = {}) {
  try {
    const nut = await loadNut();
    const delta = direction === "up" ? -amount : amount;
    if (nut?.mouse?.scrollDown && nut?.mouse?.scrollUp) {
      if (x != null && y != null && nut.mouse.setPosition) await nut.mouse.setPosition({ x, y });
      if (direction === "up") await nut.mouse.scrollUp(delta);
      else await nut.mouse.scrollDown(delta);
      return { ok: true, data: { direction, amount, platform: "win32", method: "nut-js" } };
    }
    const wheel = direction === "up" ? 120 * amount : -120 * amount;
    await runPowerShell(
      `Add-Type @'
using System.Runtime.InteropServices;
public class Mouse { [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e); }
'@; Mouse::mouse_event(0x0800,0,0,${wheel},0)`,
      5000
    );
    return { ok: true, data: { direction, amount, platform: "win32", method: "powershell" } };
  } catch (err) {
    return { ok: false, error: { code: "scroll_failed", message: err.message } };
  }
}

export async function desktopHotkey({ keys } = {}) {
  if (!keys) return { ok: false, error: { code: "missing_keys", message: "keys required" } };
  const parts = Array.isArray(keys) ? keys : String(keys).split("+").map((k) => k.trim());
  try {
    const nut = await loadNut();
    if (nut?.keyboard?.pressKey && nut?.Key) {
      for (const k of parts) {
        const key = nut.Key[k.toUpperCase()] || nut.Key[k];
        if (key != null) await nut.keyboard.pressKey(key);
      }
      return { ok: true, data: { keys: parts, platform: "win32", method: "nut-js" } };
    }
    const sendKeys = parts
      .map((k) => {
        const lower = k.toLowerCase();
        if (lower === "ctrl" || lower === "control") return "^";
        if (lower === "alt") return "%";
        if (lower === "shift") return "+";
        if (lower === "cmd" || lower === "win" || lower === "super") return "^{ESC}";
        return k.length === 1 ? k : `{${k.toUpperCase()}}`;
      })
      .join("");
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKeys.replace(/'/g, "''")}')`,
      8000
    );
    return { ok: true, data: { keys: parts, platform: "win32", method: "sendkeys" } };
  } catch (err) {
    return { ok: false, error: { code: "hotkey_failed", message: err.message } };
  }
}

export async function desktopDrag({ fromX, fromY, toX, toY } = {}) {
  try {
    const nut = await loadNut();
    if (nut?.mouse?.setPosition && nut?.mouse?.pressButton && nut?.mouse?.releaseButton) {
      const btn = nut.Button?.LEFT || nut.Button?.left || 0;
      await nut.mouse.setPosition({ x: fromX, y: fromY });
      await nut.mouse.pressButton(btn);
      await nut.mouse.setPosition({ x: toX, y: toY });
      await nut.mouse.releaseButton(btn);
      return { ok: true, data: { fromX, fromY, toX, toY, platform: "win32", method: "nut-js" } };
    }
    return {
      ok: false,
      error: {
        code: "drag_failed",
        message: "Drag requires @nut-tree-fork/nut-js on Windows",
        hint: "pnpm install @nut-tree-fork/nut-js",
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "drag_failed", message: err.message } };
  }
}

export async function ocrScreenRegion({ imageBase64 } = {}) {
  if (!imageBase64) {
    return { ok: false, error: { code: "missing_image", message: "imageBase64 required" } };
  }
  const byteLength = Buffer.from(imageBase64, "base64").length;
  try {
    const { createWorker } = await import("tesseract.js");
    const inPath = join(tmpdir(), `felix-ocr-${randomUUID()}.png`);
    await writeFile(inPath, Buffer.from(imageBase64, "base64"));
    const worker = await createWorker("eng");
    const { data } = await worker.recognize(inPath);
    await worker.terminate();
    await unlink(inPath).catch(() => {});
    return {
      ok: true,
      data: { stub: false, text: (data.text || "").trim(), engine: "tesseract.js", byteLength, platform: "win32" },
    };
  } catch (err) {
    return { ok: false, error: { code: "ocr_failed", message: err.message, byteLength } };
  }
}
