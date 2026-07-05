/**
 * Sidecar preferences tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createPairingCode,
  consumePairingCode,
  resetSidecarPairingForTests,
} from "../../src/core/sidecar/pairing.service.js";
import {
  getSidecarPreference,
  setSidecarPreference,
  clearSidecarPreference,
  resetSidecarPreferencesForTests,
} from "../../src/core/sidecar/sidecar-preferences.service.js";

describe("sidecar preferences", () => {
  beforeEach(() => {
    resetSidecarPairingForTests();
    resetSidecarPreferencesForTests();
  });

  async function pair(name) {
    const { code } = createPairingCode();
    const r = await consumePairingCode(code, { deviceName: name, baseUrl: "http://127.0.0.1:9477" });
    expect(r.ok).toBe(true);
    return r.device;
  }

  it("returns empty preference when none set", async () => {
    const pref = await getSidecarPreference("user:1", "chat");
    expect(pref.deviceId).toBeNull();
    expect(pref.persisted).toBe(false);
  });

  it("sets and reads actor channel preference", async () => {
    const device = await pair("mac-a");
    const saved = await setSidecarPreference("user:1", { channel: "chat", deviceId: device.id });
    expect(saved.ok).toBe(true);
    expect(saved.device?.name).toBe("mac-a");

    const pref = await getSidecarPreference("user:1", "chat");
    expect(pref.deviceId).toBe(device.id);
    expect(pref.device?.name).toBe("mac-a");
  });

  it("isolates channels for same actor", async () => {
    const a = await pair("mac-a");
    const b = await pair("mac-b");
    await setSidecarPreference("user:1", { channel: "chat", deviceId: a.id });
    await setSidecarPreference("user:1", { channel: "telegram", deviceId: b.id });

    const chatPref = await getSidecarPreference("user:1", "chat");
    const tgPref = await getSidecarPreference("user:1", "telegram");
    expect(chatPref.deviceId).toBe(a.id);
    expect(tgPref.deviceId).toBe(b.id);
  });

  it("isolates actors on same channel", async () => {
    const a = await pair("mac-a");
    const b = await pair("mac-b");
    await setSidecarPreference("user:1", { channel: "chat", deviceId: a.id });
    await setSidecarPreference("user:2", { channel: "chat", deviceId: b.id });

    const p1 = await getSidecarPreference("user:1", "chat");
    const p2 = await getSidecarPreference("user:2", "chat");
    expect(p1.deviceId).toBe(a.id);
    expect(p2.deviceId).toBe(b.id);
  });

  it("clears preference", async () => {
    const device = await pair("mac-a");
    await setSidecarPreference("user:1", { channel: "chat", deviceId: device.id });
    await clearSidecarPreference("user:1", "chat");
    const pref = await getSidecarPreference("user:1", "chat");
    expect(pref.deviceId).toBeNull();
  });

  it("rejects unknown device id", async () => {
    const result = await setSidecarPreference("user:1", {
      channel: "chat",
      deviceId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("device_not_found");
  });
});
