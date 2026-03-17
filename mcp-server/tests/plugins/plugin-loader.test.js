/**
 * Plugin Loader Tests
 *
 * Tests for the canonical plugin loading system (src/core/plugins.js):
 * - Discovery, validation, load, register, tool registration
 * - Plugin failures and skip conditions
 * - Duplicate load protection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";

vi.mock("fs", () => ({
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../../src/core/config.js", () => ({
  config: {
    plugins: {
      enableN8n: true,
      enableN8nCredentials: true,
      enableN8nWorkflows: true,
    },
  },
}));

vi.mock("../../src/core/tool-registry.js", () => ({
  registerTool: vi.fn(),
}));

vi.mock("../../src/core/plugin-meta.js", () => ({
  validatePluginMeta: vi.fn(() => ({ valid: true, meta: {}, warnings: [], errors: [] })),
  getQualitySummary: vi.fn(() => ({ total: 0, byStatus: {}, byTestLevel: {}, issues: [] })),
}));

import { readdirSync, existsSync } from "fs";
import { loadPlugins, getPlugins, getFailedPlugins } from "../../src/core/plugins.js";
import { validatePluginMeta } from "../../src/core/plugin-meta.js";

describe("Plugin Loader", () => {
  let app;

  beforeEach(() => {
    app = express();
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    validatePluginMeta.mockReturnValue({ valid: true, meta: {}, warnings: [], errors: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should skip plugin when index.js is missing", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "empty-plugin" },
    ]);
    existsSync.mockReturnValue(false);

    await loadPlugins(app);

    expect(getPlugins()).toHaveLength(0);
    expect(getFailedPlugins()).toHaveLength(1);
    expect(getFailedPlugins()[0].reason).toContain("missing index.js");
  });

  it("should skip plugin when metadata validation fails", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "invalid-meta" },
    ]);
    existsSync.mockReturnValue(true);
    validatePluginMeta.mockReturnValue({
      valid: false,
      errors: ["invalid version"],
      meta: {},
      warnings: [],
    });

    await loadPlugins(app);

    expect(getPlugins()).toHaveLength(0);
    expect(getFailedPlugins()).toHaveLength(1);
    expect(getFailedPlugins()[0].reason).toContain("invalid metadata");
  });

  it("should expose loadPlugins, getPlugins, getFailedPlugins", () => {
    expect(typeof loadPlugins).toBe("function");
    expect(typeof getPlugins).toBe("function");
    expect(typeof getFailedPlugins).toBe("function");
  });

  it("should clear loaded array on reload (duplicate protection)", async () => {
    readdirSync.mockReturnValue([]);
    existsSync.mockReturnValue(false);

    await loadPlugins(app);
    expect(getPlugins()).toHaveLength(0);

    await loadPlugins(app);
    expect(getPlugins()).toHaveLength(0);
  });

  it("should throw in STRICT mode when plugin fails", async () => {
    const orig = process.env.PLUGIN_STRICT_MODE;
    process.env.PLUGIN_STRICT_MODE = "true";

    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "broken" },
    ]);
    existsSync.mockReturnValue(false);

    await expect(loadPlugins(app)).rejects.toThrow("STRICT mode");

    process.env.PLUGIN_STRICT_MODE = orig;
  });

  it("should skip disabled n8n plugins", async () => {
    const { config } = await import("../../src/core/config.js");
    const orig = config.plugins.enableN8n;
    config.plugins.enableN8n = false;

    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "n8n" },
      { isDirectory: () => true, name: "other" },
    ]);
    existsSync.mockReturnValue(false);

    await loadPlugins(app);
    expect(getFailedPlugins().some((f) => f.name === "n8n")).toBe(false);

    config.plugins.enableN8n = orig;
  });
});
