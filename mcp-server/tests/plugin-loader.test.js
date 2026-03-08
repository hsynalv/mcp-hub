/**
 * Plugin Loader Tests
 *
 * Tests for the plugin loading system including:
 * - Plugin loads successfully
 * - Plugin fails to load
 * - Plugin missing index.js
 * - Async plugin registration
 * - Duplicate load protection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";

// Mock the dependencies before importing the module under test
vi.mock("fs", () => ({
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../core/config.js", () => ({
  config: {
    plugins: {
      enableN8n: true,
      enableN8nCredentials: true,
      enableN8nWorkflows: true,
      strictLoading: false,
    },
  },
}));

vi.mock("../core/tool-registry.js", () => ({
  registerTool: vi.fn(),
}));

import { readdirSync, existsSync } from "fs";
import { loadPlugins, getPlugins, getFailedPlugins } from "../src/core/plugins.js";

describe("Plugin Loader", () => {
  let app;
  let consoleSpy;

  beforeEach(() => {
    app = express();
    // Reset mocks
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should load a valid plugin", async () => {
    // Mock directory listing
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "test-plugin" },
    ]);

    // Mock index.js exists
    existsSync.mockReturnValue(true);

    // Mock successful plugin import
    const mockPlugin = {
      name: "test-plugin",
      version: "1.0.0",
      description: "Test plugin",
      register: vi.fn(),
    };

    vi.doMock("../src/plugins/test-plugin/index.js", () => mockPlugin);

    await loadPlugins(app);

    const plugins = getPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("test-plugin");
    expect(plugins[0].version).toBe("1.0.0");
  });

  it("should track plugin failures when import fails", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "broken-plugin" },
    ]);

    existsSync.mockReturnValue(true);

    // Mock failed plugin import
    vi.doMock(
      "../src/plugins/broken-plugin/index.js",
      () => {
        throw new Error("Import failed");
      }
    );

    await loadPlugins(app);

    const failed = getFailedPlugins();
    expect(failed).toHaveLength(1);
    expect(failed[0].name).toBe("broken-plugin");
    expect(failed[0].reason).toContain("failed to load");
  });

  it("should skip plugin when index.js is missing", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "empty-plugin" },
    ]);

    // Mock index.js does not exist
    existsSync.mockReturnValue(false);

    await loadPlugins(app);

    const plugins = getPlugins();
    expect(plugins).toHaveLength(0);

    const failed = getFailedPlugins();
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("missing index.js");
  });

  it("should skip plugin when register function is missing", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "no-register-plugin" },
    ]);

    existsSync.mockReturnValue(true);

    // Mock plugin without register function
    vi.doMock("../src/plugins/no-register-plugin/index.js", () => ({
      name: "no-register-plugin",
      version: "1.0.0",
      // No register function
    }));

    await loadPlugins(app);

    const plugins = getPlugins();
    expect(plugins).toHaveLength(0);

    const failed = getFailedPlugins();
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("has no register(app) export");
  });

  it("should handle async plugin registration", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "async-plugin" },
    ]);

    existsSync.mockReturnValue(true);

    // Mock async plugin
    const asyncRegister = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../src/plugins/async-plugin/index.js", () => ({
      name: "async-plugin",
      version: "1.0.0",
      register: asyncRegister,
    }));

    await loadPlugins(app);

    expect(asyncRegister).toHaveBeenCalledWith(app);

    const plugins = getPlugins();
    expect(plugins).toHaveLength(1);
  });

  it("should track failed plugins when register throws", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "error-plugin" },
    ]);

    existsSync.mockReturnValue(true);

    // Mock plugin that throws during register
    vi.doMock("../src/plugins/error-plugin/index.js", () => ({
      name: "error-plugin",
      version: "1.0.0",
      register: vi.fn().mockRejectedValue(new Error("Registration failed")),
    }));

    await loadPlugins(app);

    const plugins = getPlugins();
    expect(plugins).toHaveLength(0);

    const failed = getFailedPlugins();
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("register() failed");
  });

  it("should clear loaded array on reload (duplicate protection)", async () => {
    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "test-plugin" },
    ]);

    existsSync.mockReturnValue(true);

    vi.doMock("../src/plugins/test-plugin/index.js", () => ({
      name: "test-plugin",
      version: "1.0.0",
      register: vi.fn(),
    }));

    // First load
    await loadPlugins(app);
    expect(getPlugins()).toHaveLength(1);

    // Second load should reset and reload
    await loadPlugins(app);
    expect(getPlugins()).toHaveLength(1); // Still 1, not 2
  });

  it("should throw in STRICT mode when plugin fails", async () => {
    // Override config for this test
    const { config } = await import("../src/core/config.js");
    config.plugins.strictLoading = true;

    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "broken-plugin" },
    ]);

    existsSync.mockReturnValue(false); // Missing index.js

    await expect(loadPlugins(app)).rejects.toThrow("STRICT mode");

    // Reset config
    config.plugins.strictLoading = false;
  });

  it("should skip disabled n8n plugins", async () => {
    const { config } = await import("../src/core/config.js");
    config.plugins.enableN8n = false;

    readdirSync.mockReturnValue([
      { isDirectory: () => true, name: "n8n" },
      { isDirectory: () => true, name: "other-plugin" },
    ]);

    existsSync.mockImplementation((path) => {
      return path.includes("other-plugin");
    });

    vi.doMock("../src/plugins/other-plugin/index.js", () => ({
      name: "other-plugin",
      version: "1.0.0",
      register: vi.fn(),
    }));

    await loadPlugins(app);

    const plugins = getPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("other-plugin");

    // Reset config
    config.plugins.enableN8n = true;
  });
});
