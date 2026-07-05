/**
 * Windows desktop module tests (mocked PowerShell)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("@nut-tree-fork/nut-js", () => ({
  default: {
    screen: {},
    mouse: {},
    keyboard: {},
  },
}));

describe("desktop.win32", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    execFileMock.mockImplementation((...args) => {
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb(null, { stdout: "" });
    });
  });

  it("getActiveWindow parses PowerShell output", async () => {
    execFileMock.mockImplementation((...args) => {
      const cb = args[args.length - 1];
      cb(null, { stdout: "Cursor|Felix Hub - Chat\r\n" });
    });

    const { getActiveWindow } = await import("../../src/plugins/local-sidecar/desktop.win32.js");
    const result = await getActiveWindow();
    expect(result.ok).toBe(true);
    expect(result.data.app).toBe("Cursor");
    expect(result.data.title).toContain("Felix Hub");
    expect(result.data.platform).toBe("win32");
  });

  it("captureScreenshot returns base64 from PowerShell fallback", async () => {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    execFileMock.mockImplementation((_cmd, args, ...rest) => {
      const cb = typeof rest[rest.length - 1] === "function" ? rest[rest.length - 1] : rest[0];
      const script = String(Array.isArray(args) ? args[args.length - 1] : "");
      if (script.includes("Get-Process")) {
        cb(null, { stdout: "explorer|Desktop" });
        return;
      }
      cb(null, { stdout: tinyPng.toString("base64") });
    });

    vi.resetModules();
    const { captureScreenshot } = await import("../../src/plugins/local-sidecar/desktop.win32.js");
    const result = await captureScreenshot();
    expect(result.ok).toBe(true);
    expect(result.data.platform).toBe("win32");
    expect(result.data.imageBase64).toBeTruthy();
    expect(result.data.method).toBe("powershell");
  });

  it("desktopClick returns ok with powershell fallback", async () => {
    execFileMock.mockImplementation((_cmd, _args, ...rest) => {
      const cb = typeof rest[rest.length - 1] === "function" ? rest[rest.length - 1] : rest[0];
      cb(null, { stdout: "" });
    });

    vi.resetModules();
    const { desktopClick } = await import("../../src/plugins/local-sidecar/desktop.win32.js");
    const result = await desktopClick({ x: 10, y: 20 });
    expect(result.ok).toBe(true);
    expect(result.data.platform).toBe("win32");
  });
});
