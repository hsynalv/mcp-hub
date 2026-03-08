import { describe, it, expect } from "vitest";
import { 
  analyzeToolChain, 
  sanitizeToolArgs, 
  hasToolScope, 
  assessPluginSecurity 
} from "../../src/core/security-guard.js";

describe("security-guard - Tool Chain Analysis", () => {
  it("should detect dangerous shell → file write chain", () => {
    const chain = [
      { tool: "shell_execute", args: { command: "whoami" } },
      { tool: "file_write", args: { path: "/tmp/malware.sh", content: "evil" } },
    ];
    
    const result = analyzeToolChain(chain);
    expect(result.safe).toBe(false);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.type === "dangerous_chain")).toBe(true);
  });

  it("should detect shell → http chain", () => {
    const chain = [
      { tool: "shell_execute", args: {} },
      { tool: "http_request", args: { url: "http://evil.com" } },
    ];
    
    const result = analyzeToolChain(chain);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("should flag repeated sensitive operations", () => {
    const chain = Array(6).fill({ tool: "shell_execute", args: {} });
    
    const result = analyzeToolChain(chain);
    expect(result.warnings.some(w => w.type === "repeated_operation")).toBe(true);
  });

  it("should allow safe tool chains", () => {
    const chain = [
      { tool: "github_list_repos", args: {} },
      { tool: "notion_search", args: {} },
    ];
    
    const result = analyzeToolChain(chain);
    expect(result.safe).toBe(true);
    expect(result.riskScore).toBe(0);
  });
});

describe("security-guard - Parameter Sanitization", () => {
  it("should detect SQL injection attempts", () => {
    const args = { query: "SELECT * FROM users WHERE id = 1 OR 1=1" };
    const result = sanitizeToolArgs("database_query", args);
    
    expect(result.safe).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.issues.some(i => i.type === "sql_injection")).toBe(true);
  });

  it("should detect path traversal attempts", () => {
    const args = { path: "../../../etc/passwd" };
    const result = sanitizeToolArgs("file_read", args);
    
    expect(result.issues.some(i => i.type === "path_traversal")).toBe(true);
  });

  it("should detect command injection in shell", () => {
    const args = { command: "ls; rm -rf /" };
    const result = sanitizeToolArgs("shell_execute", args);
    
    expect(result.issues.some(i => i.type === "command_injection")).toBe(true);
  });

  it("should allow safe parameters", () => {
    const args = { query: "SELECT * FROM users WHERE id = ?", id: "123" };
    const result = sanitizeToolArgs("database_query", args);
    
    expect(result.safe).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe("security-guard - Scope Checking", () => {
  it("should validate scope hierarchy", () => {
    expect(hasToolScope("generic_tool", ["read"], "read")).toBe(true);
    expect(hasToolScope("generic_tool", ["write"], "read")).toBe(true);
    expect(hasToolScope("generic_tool", ["admin"], "write")).toBe(true);
  });

  it("should deny insufficient scope", () => {
    expect(hasToolScope("admin_tool", ["read"], "admin")).toBe(false);
    expect(hasToolScope("write_tool", ["read"], "write")).toBe(false);
  });
});

describe("security-guard - Plugin Security Assessment", () => {
  it("should assess gold tier plugin", () => {
    const meta = {
      requiresAuth: true,
      security: { scope: "write", requiresApproval: false },
      resilience: { retry: true, circuitBreaker: true },
      testLevel: "unit",
      documentation: { readme: true, examples: true },
    };
    
    const result = assessPluginSecurity(meta);
    expect(result.tier).toBe("gold");
    expect(result.percentage).toBeGreaterThanOrEqual(80);
  });

  it("should flag plugin needing work", () => {
    const meta = {
      requiresAuth: false,
      security: {},
      resilience: {},
      testLevel: "none",
      documentation: { readme: false, examples: false },
    };
    
    const result = assessPluginSecurity(meta);
    expect(result.tier).toBe("needs-work");
  });
});
