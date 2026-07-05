/**
 * Telegram /desktop sidecar command tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createPairingCode,
  consumePairingCode,
  resetSidecarPairingForTests,
} from "../../src/core/sidecar/pairing.service.js";
import {
  setSidecarPreference,
  resetSidecarPreferencesForTests,
} from "../../src/core/sidecar/sidecar-preferences.service.js";
import {
  handleTelegramV7Command,
  handleTelegramCallbackQuery,
  buildSidecarDeviceInlineKeyboard,
} from "../../src/core/v7/telegram-commands.js";

describe("telegram sidecar commands", () => {
  beforeEach(() => {
    resetSidecarPairingForTests();
    resetSidecarPreferencesForTests();
    delete process.env.LOCAL_FS_ON_SERVER;
    process.env.LOCAL_FS_ON_SERVER = "false";
    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    process.env.TELEGRAM_CHAT_ID = "1";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  async function pair(name, platform = "darwin") {
    const { code } = createPairingCode();
    const r = await consumePairingCode(code, {
      deviceName: name,
      baseUrl: "http://127.0.0.1:9477",
      platform,
    });
    expect(r.ok).toBe(true);
    return r.device;
  }

  it("buildSidecarDeviceInlineKeyboard maps devices to callback_data", () => {
    const kb = buildSidecarDeviceInlineKeyboard([
      { id: "dev-1", name: "MacBook", platform: "darwin", online: true },
      { id: "dev-2", name: "PC", platform: "win32", online: false },
    ]);
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0][0].callback_data).toBe("sidecar:dev-1");
  });

  it("/desktop devices lists paired devices", async () => {
    await pair("mac-a");
    await pair("win-pc", "win32");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      })
    );
    const messages = [];
    const result = await handleTelegramV7Command("42", "/desktop devices", {
      reply: async (msg) => {
        messages.push(msg);
      },
    });
    expect(result.handled).toBe(true);
    expect(messages[0]).toContain("mac-a");
    expect(messages[0]).toContain("win-pc");
  });

  it("/desktop use sets telegram preference", async () => {
    await pair("work-mac");
    const messages = [];
    await handleTelegramV7Command("42", "/desktop use work", {
      reply: async (msg) => messages.push(msg),
    });
    expect(messages[0]).toContain("work-mac");

    const current = [];
    await handleTelegramV7Command("42", "/desktop current", {
      reply: async (msg) => current.push(msg),
    });
    expect(current[0]).toContain("work-mac");
  });

  it("callback sidecar: sets preference and confirms", async () => {
    const device = await pair("picker-mac");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      })
    );

    const result = await handleTelegramCallbackQuery({
      id: "q1",
      data: `sidecar:${device.id}`,
      message: { chat: { id: "42" } },
    });
    expect(result.ok).toBe(true);

    const current = [];
    await handleTelegramV7Command("42", "/desktop current", {
      reply: async (msg) => current.push(msg),
    });
    expect(current[0]).toContain("picker-mac");
  });
});
