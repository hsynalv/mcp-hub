/**
 * Shell Plugin Tests (Hardened)
 * 
 * Tests covering allowlist, dangerous patterns, timeout, audit logging, 
 * policy integration, and standardized error handling.
 */

import { describe, it, expect, vi } from "vitest";
import * as shell from "../../src/plugins/shell/index.js";

// Mock policy hooks
vi.mock("../../src/core/policy-hooks.js", () => ({
  getPolicyEvaluator: vi.fn(() => null),
}));

describe("Shell Plugin (Hardened)", () => {
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
      expect(shell.register).toBeTypeOf("function");
    });

    it("should define required endpoints", () => {
      const paths = shell.endpoints.map(e => e.path);
      expect(paths).toContain("/shell/execute");
      expect(paths).toContain("/shell/execute/stream");
      expect(paths).toContain("/shell/audit");
      expect(paths).toContain("/shell/safety");
    });

    it("should require write scope for execute endpoints", () => {
      const execute = shell.endpoints.find(e => e.path === "/shell/execute");
      const stream = shell.endpoints.find(e => e.path === "/shell/execute/stream");
      expect(execute?.scope).toBe("write");
      expect(stream?.scope).toBe("write");
    });

    it("should require read scope for audit and safety endpoints", () => {
      const audit = shell.endpoints.find(e => e.path === "/shell/audit");
      const safety = shell.endpoints.find(e => e.path === "/shell/safety");
      expect(audit?.scope).toBe("read");
      expect(safety?.scope).toBe("read");
    });
  });

  describe("MCP Tools", () => {
    it("should have shell_execute tool", () => {
      const tool = shell.tools.find(t => t.name === "shell_execute");
      expect(tool).toBeDefined();
      expect(tool?.handler).toBeTypeOf("function");
    });

    it("should have shell_audit tool (not shell_history)", () => {
      const tool = shell.tools.find(t => t.name === "shell_audit");
      expect(tool).toBeDefined();
      expect(tool?.tags).toContain("read_only");
    });

    it("should have shell_safety_check tool", () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      expect(tool).toBeDefined();
    });

    it("shell_execute should require command parameter", () => {
      const tool = shell.tools.find(t => t.name === "shell_execute");
      expect(tool?.inputSchema.required).toContain("command");
    });
  });

  describe("shell_safety_check - Allowlist Validation", () => {
    it("should allow allowlisted commands", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "ls -la" });
      expect(result?.ok).toBe(true);
      expect(result?.data.allowedCommand).toBe(true);
    });

    it("should deny non-allowlisted commands", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "rm -rf /" });
      expect(result?.ok).toBe(true);
      expect(result?.data.allowedCommand).toBe(false);
      expect(result?.data.reason).toContain("not in allowlist");
    });

    it("should include allowlist in response", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "ls" });
      expect(result?.data.allowlist).toBeDefined();
      expect(Array.isArray(result?.data.allowlist)).toBe(true);
      expect(result?.data.allowlist).toContain("ls");
    });
  });

  describe("shell_safety_check - Dangerous Pattern Blocking", () => {
    it("should detect shell chaining operators", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result1 = await tool?.handler({ command: "ls && rm -rf /" });
      expect(result1?.data.allowedCommand).toBe(false);
      expect(result1?.data.reason).toContain("Dangerous pattern");

      const result2 = await tool?.handler({ command: "ls || cat /etc/passwd" });
      expect(result2?.data.allowedCommand).toBe(false);

      const result3 = await tool?.handler({ command: "ls; rm -rf /" });
      expect(result3?.data.allowedCommand).toBe(false);
    });

    it("should detect pipes", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "cat /etc/passwd | grep root" });
      expect(result?.data.allowedCommand).toBe(false);
      expect(result?.data.reason).toContain("Dangerous pattern");
    });

    it("should detect redirections", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result1 = await tool?.handler({ command: "echo test > /etc/passwd" });
      expect(result1?.data.allowedCommand).toBe(false);

      const result2 = await tool?.handler({ command: "cat < /etc/passwd" });
      expect(result2?.data.allowedCommand).toBe(false);
    });

    it("should detect subshell patterns", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result1 = await tool?.handler({ command: "ls $(cat /etc/passwd)" });
      expect(result1?.data.allowedCommand).toBe(false);

      const result2 = await tool?.handler({ command: "ls `cat /etc/passwd`" });
      expect(result2?.data.allowedCommand).toBe(false);
    });

    it("should include dangerous patterns list", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "ls" });
      expect(result?.data.dangerousPatterns).toBeDefined();
      expect(Array.isArray(result?.data.dangerousPatterns)).toBe(true);
    });
  });

  describe("shell_safety_check - Working Directory Validation", () => {
    it("should validate working directory", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({
        command: "ls",
        cwd: "/etc"
      });
      expect(result?.ok).toBe(true);
      expect(result?.data).toHaveProperty("cwdAllowed");
    });

    it("should include allowed directories list", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "ls" });
      expect(result?.data.allowedDirs).toBeDefined();
      expect(Array.isArray(result?.data.allowedDirs)).toBe(true);
    });
  });

  describe("shell_safety_check - Timeout Configuration", () => {
    it("should include default timeout in response", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "ls" });
      expect(result?.data.defaultTimeout).toBeDefined();
      expect(typeof result?.data.defaultTimeout).toBe("number");
    });

    it("should include max timeout in response", async () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      const result = await tool?.handler({ command: "ls" });
      expect(result?.data.maxTimeout).toBeDefined();
      expect(typeof result?.data.maxTimeout).toBe("number");
    });
  });

  describe("shell_audit", () => {
    it("should return audit log", async () => {
      const tool = shell.tools.find(t => t.name === "shell_audit");
      const result = await tool?.handler({ limit: 10 });

      expect(result?.ok).toBe(true);
      expect(result?.data).toHaveProperty("audit");
      expect(Array.isArray(result?.data.audit)).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const tool = shell.tools.find(t => t.name === "shell_audit");
      const result = await tool?.handler({ limit: 5 });
      expect(result?.data.audit.length).toBeLessThanOrEqual(5);
    });
  });

  describe("shell_execute - Error Handling", () => {
    it("should return standardized error for non-allowlisted command", async () => {
      const tool = shell.tools.find(t => t.name === "shell_execute");
      const result = await tool?.handler({ command: "hack" });

      expect(result?.ok).toBe(false);
      expect(result?.error).toHaveProperty("code");
      expect(result?.error).toHaveProperty("category");
      expect(result?.error).toHaveProperty("message");
      expect(result?.error).toHaveProperty("retryable");
    });

    it("should return correlation_id in successful response", async () => {
      const tool = shell.tools.find(t => t.name === "shell_execute");
      const result = await tool?.handler({ command: "echo hello" });

      expect(result?.ok).toBe(true);
      expect(result?.data).toHaveProperty("correlationId");
      expect(typeof result?.data.correlationId).toBe("string");
      expect(result?.data.correlationId.length).toBe(16); // 8 bytes hex = 16 chars
    });
  });

  describe("Tool Tags", () => {
    it("shell_execute should have write, destructive, local_fs tags", () => {
      const tool = shell.tools.find(t => t.name === "shell_execute");
      expect(tool?.tags).toContain("write");
      expect(tool?.tags).toContain("destructive");
      expect(tool?.tags).toContain("LOCAL_FS");
    });

    it("shell_audit should have read tag", () => {
      const tool = shell.tools.find(t => t.name === "shell_audit");
      expect(tool?.tags).toContain("read_only");
    });

    it("shell_safety_check should have read tag", () => {
      const tool = shell.tools.find(t => t.name === "shell_safety_check");
      expect(tool?.tags).toContain("read_only");
    });
  });
});
