import { describe, it, expect, beforeEach } from "vitest";
import { enrichSidecarToolContext } from "../../src/core/sidecar/sidecar-context.js";
import {
  consumePairingCode,
  createPairingCode,
  resetSidecarPairingForTests,
} from "../../src/core/sidecar/pairing.service.js";

describe("v10 sidecar context", () => {
  beforeEach(() => {
    resetSidecarPairingForTests();
    delete process.env.LOCAL_FS_ON_SERVER;
  });

  it("injects sidecarCapabilities from paired device", async () => {
    process.env.LOCAL_FS_ON_SERVER = "false";
    const { code } = createPairingCode();
    await consumePairingCode(code, {
      deviceName: "mac",
      baseUrl: "http://127.0.0.1:9477",
      capabilities: ["fs", "browser"],
    });

    const ctx = await enrichSidecarToolContext({ actor: "test" });
    expect(ctx.sidecarCapabilities).toEqual(["fs", "browser"]);
    expect(ctx.sidecarDeviceId).toBeDefined();
  });

  it("marks ambiguous when multiple devices and no preference", async () => {
    process.env.LOCAL_FS_ON_SERVER = "false";
    const { code: c1 } = createPairingCode();
    await consumePairingCode(c1, { deviceName: "mac-a", baseUrl: "http://127.0.0.1:9477" });
    const { code: c2 } = createPairingCode();
    await consumePairingCode(c2, { deviceName: "mac-b", baseUrl: "http://127.0.0.1:9478" });

    const ctx = await enrichSidecarToolContext({ actor: "user:1", channel: "chat" });
    expect(ctx.sidecarResolution).toBe("ambiguous");
    expect(ctx.availableSidecars?.length).toBe(2);
  });
});
