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
      expect(paths).toContain("/shell/audit");
      expect(paths).toContain("/shell/safety");
    });
  });

  describe("MCP Tools", () => {
    it("should have shell_execute tool", () => {
      const tool = shell.tools.find(t => t.name === "shell_execute");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have shell_audit tool", async () => {
      const tool = shell.tools.find(t => t.name === "shell_audit");
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
      expect(result.data.allowedCommand).toBe(true);
    });

    it("should block dangerous commands", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool.handler({ command: "rm -rf /" });

      expect(result.ok).toBe(true);
      expect(result.data.allowed).toBe(false);
      expect(result.data.allowedCommand).toBe(false);
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

    it("should return allowlist patterns", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool.handler({ command: "ls" });

      expect(result.ok).toBe(true);
      expect(result.data.allowlist).toBeDefined();
      expect(Array.isArray(result.data.allowlist)).toBe(true);
    });
  });

  describe("shell_audit", () => {
    it("should return audit log", async () => {
      const tool = shell.tools.find(t => t.name === "shell_audit");
      const result = await tool.handler({ limit: 10 });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("audit");
      expect(Array.isArray(result.data.audit)).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const tool = shell.tools.find(t => t.name === "shell_audit");
      const result = await tool.handler({ limit: 5 });
      expect(result.data.audit.length).toBeLessThanOrEqual(5);
    });
  });
});
