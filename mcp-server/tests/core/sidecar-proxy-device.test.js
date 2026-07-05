/**
 * Sidecar proxy device routing tests
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
import { delegateToSidecar } from "../../src/core/sidecar/sidecar-proxy.js";

describe("sidecar proxy device routing", () => {
  beforeEach(() => {
    resetSidecarPairingForTests();
    resetSidecarPreferencesForTests();
    delete process.env.LOCAL_FS_ON_SERVER;
    process.env.LOCAL_FS_ON_SERVER = "false";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function pair(name, url) {
    const { code } = createPairingCode();
    const r = await consumePairingCode(code, { deviceName: name, baseUrl: url });
    expect(r.ok).toBe(true);
    return r.device;
  }

  it("returns ambiguous without routing fetch", async () => {
    await pair("mac-a", "http://127.0.0.1:9477");
    await pair("mac-b", "http://127.0.0.1:9478");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await delegateToSidecar("list", {
      path: ".",
      context: { actor: "user:1", channel: "chat" },
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("sidecar_ambiguous");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies to preferred device baseUrl", async () => {
    const a = await pair("mac-a", "http://127.0.0.1:9477");
    await pair("mac-b", "http://127.0.0.1:9478");
    await setSidecarPreference("user:1", { channel: "chat", deviceId: a.id });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { entries: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await delegateToSidecar("list", {
      path: ".",
      context: { actor: "user:1", channel: "chat" },
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^http:\/\/127\.0\.0\.1:9477\/fs\/list/);
  });

  it("uses explicit sidecarDeviceId over preference", async () => {
    const a = await pair("mac-a", "http://127.0.0.1:9477");
    const b = await pair("mac-b", "http://127.0.0.1:9478");
    await setSidecarPreference("user:1", { channel: "chat", deviceId: a.id });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { entries: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await delegateToSidecar("list", {
      path: ".",
      context: { actor: "user:1", channel: "chat", sidecarDeviceId: b.id },
    });
    expect(fetchMock.mock.calls[0][0]).toMatch(/^http:\/\/127\.0\.0\.1:9478\/fs\/list/);
  });
});
