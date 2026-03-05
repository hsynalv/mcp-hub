/**
 * Shell Plugin Tests
 */

import { describe, it, expect } from "vitest";
import * as shell from "../../src/plugins/shell/index.js";

describe("Shell Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(shell.name).toBe("shell");
      expect(shell.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(shell.name).toBeDefined();
      expect(shell.version).toBeDefined();
      expect(shell.description).toBeDefined();
      expect(shell.endpoints).toBeDefined();
      expect(shell.tools).toBeDefined();
      expect(shell.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = shell.endpoints.map(e => e.path);
      expect(paths).toContain("/shell/execute");
      expect(paths).toContain("/shell/history");
      expect(paths).toContain("/shell/safety");
    });
  });

  describe("MCP Tools", () => {
    it("should have shell_execute tool", () => {
      const tool = shell.tools.find(t => t.name === "shell_execute");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have shell_history tool", () => {
      const tool = shell.tools.find(t => t.name === "shell_history");
      expect(tool).toBeDefined();
    });

    it("should have shell_safety_check tool", () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      expect(tool).toBeDefined();
    });
  });

  describe("shell_safety_check", () => {
    it("should allow safe commands", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool.handler({ command: "ls -la" });

      expect(result.ok).toBe(true);
      expect(result.data.allowed).toBe(true);
      expect(result.data.blocked).toBe(false);
    });

    it("should block dangerous commands", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool.handler({ command: "rm -rf /" });

      expect(result.ok).toBe(true);
      expect(result.data.allowed).toBe(false);
      expect(result.data.blocked).toBe(true);
    });

    it("should validate working directory", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool.handler({
        command: "ls",
        cwd: "/etc"
      });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("cwdAllowed");
    });

    it("should return blocked patterns list", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool.handler({ command: "ls" });

      expect(result.ok).toBe(true);
      expect(result.data.blockedPatterns).toBeDefined();
      expect(Array.isArray(result.data.blockedPatterns)).toBe(true);
    });
  });

  describe("shell_history", () => {
    it("should return command history", async () => {
      const tool = shell.tools.find(t => t.name === "shell_history");
      const result = await tool.handler({ limit: 10 });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("history");
      expect(Array.isArray(result.data.history)).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const tool = shell.tools.find(t => t.name === "shell_history");
      const result = await tool.handler({ limit: 5 });

      expect(result.ok).toBe(true);
      expect(result.data.history.length).toBeLessThanOrEqual(5);
    });
  });
});
