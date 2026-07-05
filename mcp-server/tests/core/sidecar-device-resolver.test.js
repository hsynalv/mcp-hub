/**
 * Sidecar device resolver tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createPairingCode,
  consumePairingCode,
  resetSidecarPairingForTests,
} from "../../src/core/sidecar/pairing.service.js";
import {
  setSidecarPreference,
  resetSidecarPreferencesForTests,
} from "../../src/core/sidecar/sidecar-preferences.service.js";
import { resolveSidecarDevice } from "../../src/core/sidecar/sidecar-device-resolver.service.js";

describe("sidecar device resolver", () => {
  beforeEach(() => {
    resetSidecarPairingForTests();
    resetSidecarPreferencesForTests();
    delete process.env.LOCAL_FS_ON_SERVER;
  });

  async function pair(name, url = "http://127.0.0.1:9477") {
    const { code } = createPairingCode();
    const r = await consumePairingCode(code, { deviceName: name, baseUrl: url, platform: "darwin" });
    expect(r.ok).toBe(true);
    return r.device;
  }

  it("returns sidecar_required when no devices", async () => {
    const r = await resolveSidecarDevice({ channel: "chat" });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("sidecar_required");
  });

  it("uses single paired device automatically", async () => {
    const d = await pair("only-mac");
    const r = await resolveSidecarDevice({ channel: "chat", actor: "user:1" });
    expect(r.ok).toBe(true);
    expect(r.device.id).toBe(d.id);
    expect(r.resolution).toBe("single_device");
  });

  it("returns ambiguous when multiple devices and no preference", async () => {
    await pair("mac-a");
    await pair("mac-b");
    const r = await resolveSidecarDevice({ channel: "chat", actor: "user:1" });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("sidecar_ambiguous");
    expect(r.error.devices.length).toBe(2);
  });

  it("respects actor channel preference", async () => {
    const a = await pair("mac-a");
    await pair("mac-b");
    await setSidecarPreference("user:1", { channel: "chat", deviceId: a.id });
    const r = await resolveSidecarDevice({ channel: "chat", actor: "user:1" });
    expect(r.ok).toBe(true);
    expect(r.device.id).toBe(a.id);
    expect(r.resolution).toBe("preference_channel");
  });

  it("respects explicit sidecarDeviceId", async () => {
    await pair("mac-a");
    const b = await pair("mac-b");
    const r = await resolveSidecarDevice({ sidecarDeviceId: b.id });
    expect(r.ok).toBe(true);
    expect(r.device.id).toBe(b.id);
    expect(r.resolution).toBe("explicit_id");
  });
});
