/**
 * Registry Tests
 *
 * Test suite for the plugin registry system.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginRegistry, createRegistry, getRegistry, setRegistry } from "./plugin.registry.js";
import { discoverPlugins, pluginExists, DEFAULT_PLUGINS_DIR } from "./plugin.discovery.js";
import { loadPlugin } from "./plugin.loader.js";
import {
  enablePlugin,
  disablePlugin,
  getPlugin,
  getPlugins,
  getEnabledPlugins,
} from "./plugin.lifecycle.js";

// Mock Express app
const createMockApp = () => ({
  use: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
});

describe("Plugin Registry", () => {
  describe("PluginRegistry class", () => {
    let registry;

    beforeEach(() => {
      registry = new PluginRegistry({ autoDiscover: false });
    });

    it("should create registry with defaults", () => {
      expect(registry.registry).toBeInstanceOf(Map);
      expect(registry.initialized).toBe(false);
      expect(registry.autoDiscover).toBe(false);
    });

    it("should initialize without errors", async () => {
      const app = createMockApp();
      await registry.init(app);
      expect(registry.initialized).toBe(true);
      expect(registry.app).toBe(app);
    });

    it("should get empty status initially", () => {
      const status = registry.getStatus();
      expect(status.total).toBe(0);
      expect(status.enabled).toBe(0);
      expect(status.healthy).toBe(0);
      expect(status.pluginNames).toEqual([]);
    });
  });

  describe("Plugin Discovery", () => {
    it("should discover plugins in directory", async () => {
      const results = await discoverPlugins(DEFAULT_PLUGINS_DIR, { validate: false });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should validate discovered plugins", async () => {
      const results = await discoverPlugins(DEFAULT_PLUGINS_DIR, { validate: true });
      const validPlugins = results.filter(r => r.valid);
      expect(validPlugins.length).toBeGreaterThan(0);
    });

    it("should check plugin existence", async () => {
      const exists = await pluginExists("shell", DEFAULT_PLUGINS_DIR);
      expect(exists).toBe(true);

      const notExists = await pluginExists("nonexistent", DEFAULT_PLUGINS_DIR);
      expect(notExists).toBe(false);
    });
  });

  describe("Plugin Loader", () => {
    it("should load valid plugin", async () => {
      const result = await loadPlugin("shell", DEFAULT_PLUGINS_DIR);
      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry.name).toBe("shell");
      expect(result.entry.metadata).toBeDefined();
    });

    it("should fail to load invalid plugin", async () => {
      const result = await loadPlugin("nonexistent", DEFAULT_PLUGINS_DIR);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Plugin Lifecycle", () => {
    let registry;

    beforeEach(async () => {
      registry = new PluginRegistry({ autoDiscover: false });
      await registry.load("shell");
    });

    it("should enable plugin", async () => {
      const result = await enablePlugin(registry.registry, "shell");
      expect(result.success).toBe(true);

      const entry = registry.registry.get("shell");
      expect(entry.enabled).toBe(true);
    });

    it("should disable plugin", async () => {
      await enablePlugin(registry.registry, "shell");
      const result = await disablePlugin(registry.registry, "shell");
      expect(result.success).toBe(true);

      const entry = registry.registry.get("shell");
      expect(entry.enabled).toBe(false);
    });

    it("should get plugin", () => {
      const entry = getPlugin(registry.registry, "shell");
      expect(entry).toBeDefined();
      expect(entry.name).toBe("shell");
    });

    it("should get all plugins", () => {
      const plugins = getPlugins(registry.registry);
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("shell");
    });

    it("should get enabled plugins", async () => {
      await enablePlugin(registry.registry, "shell");
      const enabled = getEnabledPlugins(registry.registry);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe("shell");
    });
  });

  describe("Tool Aggregation", () => {
    let registry;

    beforeEach(async () => {
      registry = new PluginRegistry({ autoDiscover: false });
      await registry.load("shell");
      await registry.enable("shell");
    });

    it("should get all tools", () => {
      const tools = registry.getAllTools();
      expect(Array.isArray(tools)).toBe(true);

      if (tools.length > 0) {
        expect(tools[0]).toHaveProperty("name");
        expect(tools[0]).toHaveProperty("plugin");
        expect(tools[0]).toHaveProperty("tool");
      }
    });

    it("should get plugin tools", () => {
      const tools = registry.getPluginTools("shell");
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe("Health Checks", () => {
    let registry;

    beforeEach(async () => {
      registry = new PluginRegistry({ autoDiscover: false });
      await registry.load("shell");
    });

    it("should check health of existing plugin", async () => {
      const result = await registry.checkHealth("shell");
      expect(result).toHaveProperty("name", "shell");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("timestamp");
    });

    it("should fail health check for non-existent plugin", async () => {
      const result = await registry.checkHealth("nonexistent");
      expect(result.status).toBe("failed");
      expect(result.message).toContain("not found");
    });

    it("should check all health", async () => {
      await registry.enable("shell");
      const results = await registry.checkAllHealth();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("Plugin Queries", () => {
    let registry;

    beforeEach(async () => {
      registry = new PluginRegistry({ autoDiscover: false });
      await registry.load("shell");
      await registry.load("database");
      await registry.enable("shell");
      await registry.enable("database");
    });

    it("should get plugins by capability", () => {
      const plugins = registry.getByCapability("execute");
      expect(Array.isArray(plugins)).toBe(true);
    });

    it("should get plugins by scope", () => {
      const plugins = registry.getByScope("admin");
      expect(Array.isArray(plugins)).toBe(true);
    });

    it("should check if plugin is enabled", () => {
      expect(registry.isEnabled("shell")).toBe(true);
      expect(registry.isEnabled("nonexistent")).toBe(false);
    });
  });

  describe("Global Registry", () => {
    it("should create and get global registry", () => {
      setRegistry(null); // Reset
      const registry1 = getRegistry();
      const registry2 = getRegistry();
      expect(registry1).toBe(registry2);
    });

    it("should set custom registry", () => {
      const custom = createRegistry();
      setRegistry(custom);
      expect(getRegistry()).toBe(custom);
    });
  });
});
