/**
 * File Watcher Plugin Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fileWatcher from "../../src/plugins/file-watcher/index.js";

describe("File Watcher Plugin", () => {
  beforeEach(() => {
    // Clean up any existing watchers
    const watchers = fileWatcher.tools.find(t => t.name === "file_watcher_list");
  });

  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(fileWatcher.name).toBe("file-watcher");
      expect(fileWatcher.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(fileWatcher.name).toBeDefined();
      expect(fileWatcher.version).toBeDefined();
      expect(fileWatcher.description).toBeDefined();
      expect(fileWatcher.endpoints).toBeDefined();
      expect(fileWatcher.tools).toBeDefined();
      expect(fileWatcher.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = fileWatcher.endpoints.map(e => e.path);
      expect(paths).toContain("/file-watcher/watch");
      expect(paths).toContain("/file-watcher/:id");
      expect(paths).toContain("/file-watcher/:id/changes");
    });
  });

  describe("MCP Tools", () => {
    it("should have file_watcher_start tool", () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_start");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have file_watcher_stop tool", () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_stop");
      expect(tool).toBeDefined();
    });

    it("should have file_watcher_list tool", () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_list");
      expect(tool).toBeDefined();
    });

    it("should have file_watcher_changes tool", () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_changes");
      expect(tool).toBeDefined();
    });
  });

  describe("file_watcher_start", () => {
    it("should start watching a directory", async () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_start");
      const result = await tool.handler({ path: "./src" });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("watcherId");
      expect(result.data).toHaveProperty("path");
    });

    it("should accept recursive option", async () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_start");
      const result = await tool.handler({ path: "./src", recursive: false });

      expect(result.ok).toBe(true);
    });

    it("should accept ignore patterns", async () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_start");
      const result = await tool.handler({
        path: "./src",
        ignore: ["node_modules", ".git"]
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("file_watcher_list", () => {
    it("should list all watchers", async () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_list");
      const result = await tool.handler({});

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("watchers");
      expect(Array.isArray(result.data.watchers)).toBe(true);
    });
  });

  describe("file_watcher_stop", () => {
    it("should return error for non-existent watcher", async () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_stop");
      const result = await tool.handler({ watcherId: "non-existent" });

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("watcher_not_found");
    });
  });

  describe("file_watcher_changes", () => {
    it("should return error for non-existent watcher", async () => {
      const tool = fileWatcher.tools.find(t => t.name === "file_watcher_changes");
      const result = await tool.handler({ watcherId: "non-existent" });

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("watcher_not_found");
    });
  });
});
