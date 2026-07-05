/**
 * Windows clipboard read/write via PowerShell.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { assertDesktopActionAllowed, detectSensitiveContext } from "./desktop-guard.js";

const execFileAsync = promisify(execFile);

async function currentWindowContext() {
  try {
    const ps = `(Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1 -ExpandProperty ProcessName)`;
    const { stdout } = await execFileAsync("powershell", ["-Command", ps], { timeout: 5000 });
    return { app: stdout.trim(), title: "" };
  } catch {
    return { app: "", title: "" };
  }
}

async function readClipboardRaw() {
  const script = "[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Get-Clipboard -Raw";
  const { stdout } = await execFileAsync("powershell", ["-Command", script], {
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

async function writeClipboardRaw(text) {
  const b64 = Buffer.from(String(text), "utf8").toString("base64");
  await execFileAsync(
    "powershell",
    [
      "-Command",
      `$bytes = [Convert]::FromBase64String('${b64}'); $s = [Text.Encoding]::UTF8.GetString($bytes); Set-Clipboard -Value $s`,
    ],
    { timeout: 5000 }
  );
}

export async function clipboardReadWin32({ maxLength = 32_000 } = {}) {
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
          code: "sensitive_context",
          message: sensitivity.reason || "Clipboard may contain sensitive data",
          preview: text.slice(0, 120),
        },
      };
    }
    return {
      ok: true,
      data: {
        platform: "win32",
        text: text.slice(0, maxLength),
        truncated: text.length > maxLength,
        length: text.length,
        app,
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "clipboard_read_failed", message: err.message } };
  }
}

export async function clipboardWriteWin32({ text } = {}) {
  if (text == null) {
    return { ok: false, error: { code: "missing_text", message: "text required" } };
  }
  try {
    const { app, title } = await currentWindowContext();
    const guard = assertDesktopActionAllowed({ action: "clipboard_write", app, title });
    if (!guard.ok) return guard;

    await writeClipboardRaw(String(text));
    return {
      ok: true,
      data: {
        platform: "win32",
        length: String(text).length,
        writtenAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { ok: false, error: { code: "clipboard_write_failed", message: err.message } };
  }
}
