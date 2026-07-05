/**
 * Clipboard read/write via local sidecar (macOS pbpaste/pbcopy).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { assertDesktopActionAllowed, detectSensitiveContext } from "./desktop-guard.js";

const execFileAsync = promisify(execFile);

async function currentWindowContext() {
  try {
    const { stdout } = await execFileAsync(
      "osascript",
      [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ],
      { timeout: 5000 }
    );
    return { app: stdout.trim(), title: "" };
  } catch {
    return { app: "", title: "" };
  }
}

async function readClipboardRaw() {
  const { stdout } = await execFileAsync("pbpaste", [], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

async function writeClipboardRaw(text) {
  await execFileAsync("pbcopy", [], { timeout: 5000, input: text });
}

/**
 * @param {{ maxLength?: number }} [opts]
 */
export async function clipboardRead({ maxLength = 32_000 } = {}) {
  const platform = process.platform;
  if (platform === "win32") {
    const { clipboardReadWin32 } = await import("./clipboard.win32.js");
    return clipboardReadWin32({ maxLength });
  }
  if (platform !== "darwin") {
    return {
      ok: true,
      data: {
        platform,
        stub: true,
        text: "",
        message: "Clipboard requires macOS sidecar",
      },
    };
  }

  try {
    const { app, title } = await currentWindowContext();
    const guard = assertDesktopActionAllowed({ action: "clipboard_read", app, title });
    if (!guard.ok) return guard;

    const text = await readClipboardRaw();
    const sensitivity = detectSensitiveContext({ ocrText: text.slice(0, 500) });
    if (sensitivity.sensitive) {
      return {
        ok: false,
        error: {
          code: "clipboard_sensitive",
          message: "Clipboard content appears sensitive (password/login/payment)",
          reasons: sensitivity.reasons,
        },
      };
    }

    const clipped = text.length > maxLength ? text.slice(0, maxLength) : text;
    return {
      ok: true,
      data: {
        platform,
        text: clipped,
        length: text.length,
        truncated: text.length > maxLength,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: "clipboard_read_failed", message: err.message },
    };
  }
}

/**
 * @param {{ text: string, app?: string, title?: string }} params
 */
export async function clipboardWrite({ text } = {}) {
  if (text == null) {
    return { ok: false, error: { code: "empty_text", message: "text required" } };
  }

  const platform = process.platform;
  if (platform === "win32") {
    const { clipboardWriteWin32 } = await import("./clipboard.win32.js");
    return clipboardWriteWin32({ text });
  }
  if (platform !== "darwin") {
    return {
      ok: true,
      data: { platform, stub: true, message: "Clipboard requires macOS sidecar" },
    };
  }

  const { app, title } = await currentWindowContext();
  const guard = assertDesktopActionAllowed({ action: "clipboard_write", app, title });
  if (!guard.ok) return guard;

  try {
    let previousText = "";
    try {
      previousText = await readClipboardRaw();
    } catch {
      /* empty clipboard */
    }

    await writeClipboardRaw(String(text));

    return {
      ok: true,
      data: {
        platform,
        length: String(text).length,
        preview: guard.data?.preview,
        undo: {
          type: "clipboard_restore",
          previousText,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: "clipboard_write_failed", message: err.message },
    };
  }
}
