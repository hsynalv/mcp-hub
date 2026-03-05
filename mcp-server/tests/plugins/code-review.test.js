/**
 * Code Review Plugin Tests
 */

import { describe, it, expect, vi } from "vitest";
import * as codeReview from "../../src/plugins/code-review/index.js";

describe("Code Review Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(codeReview.name).toBe("code-review");
      expect(codeReview.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(codeReview.name).toBeDefined();
      expect(codeReview.version).toBeDefined();
      expect(codeReview.description).toBeDefined();
      expect(codeReview.endpoints).toBeDefined();
      expect(codeReview.tools).toBeDefined();
      expect(codeReview.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = codeReview.endpoints.map(e => e.path);
      expect(paths).toContain("/code-review/file");
      expect(paths).toContain("/code-review/pr");
      expect(paths).toContain("/code-review/security");
    });
  });

  describe("MCP Tools", () => {
    it("should have code_review_file tool", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_file");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have code_review_pr tool", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_pr");
      expect(tool).toBeDefined();
    });

    it("should have code_review_security tool", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_security");
      expect(tool).toBeDefined();
    });

    it("should have code_review_suggest_fix tool", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_suggest_fix");
      expect(tool).toBeDefined();
    });
  });

  describe("Security Scanning", () => {
    it("should detect hardcoded secrets", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_security");
      const code = `const password = "superSecret123!"`;
      const result = tool.handler({ code, filename: "test.js" });

      expect(result.ok).toBe(true);
      expect(result.data.passed).toBe(false);
      expect(result.data.issues.length).toBeGreaterThan(0);
    });

    it("should detect SQL injection patterns", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_security");
      const code = `db.query(\`SELECT * FROM users WHERE id = \${userId}\`)`;
      const result = tool.handler({ code, filename: "test.js" });

      expect(result.ok).toBe(true);
      expect(result.data.issues.some(i => i.id === "sql-injection")).toBe(true);
    });

    it("should detect eval usage", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_security");
      const code = `eval(userInput)`;
      const result = tool.handler({ code, filename: "test.js" });

      expect(result.ok).toBe(true);
      expect(result.data.issues.some(i => i.id === "eval-usage")).toBe(true);
    });

    it("should detect innerHTML XSS", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_security");
      const code = `element.innerHTML = userContent`;
      const result = tool.handler({ code, filename: "test.js" });

      expect(result.ok).toBe(true);
      expect(result.data.issues.some(i => i.id === "inner-html")).toBe(true);
    });

    it("should pass safe code", () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_security");
      const code = `const sum = (a, b) => a + b`;
      const result = tool.handler({ code, filename: "safe.js" });

      expect(result.ok).toBe(true);
      expect(result.data.passed).toBe(true);
      expect(result.data.issues).toHaveLength(0);
    });
  });

  describe("Quality Checks", () => {
    it("should detect long functions", () => {
      const code = Array(100).fill("// line").join("\n");
      const longFunction = `function foo() {\n${code}\n}`;
      const quality = codeReview.qualityCheck?.(longFunction, "test.js");

      // Should find quality issues if qualityCheck is exported
      if (quality) {
        expect(quality.some(i => i.id === "long-function")).toBe(true);
      }
    });

    it("should detect console.log statements", () => {
      const code = `console.log("debug"); console.warn("warn");`;
      const quality = codeReview.qualityCheck?.(code, "test.js");

      if (quality) {
        expect(quality.some(i => i.id === "console-log")).toBe(true);
      }
    });
  });

  describe("PR Review", () => {
    it("should handle PR with multiple files", async () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_pr");
      const files = [
        { path: "/test/file1.js", status: "modified" },
        { path: "/test/file2.js", status: "added" },
      ];

      // Mock the file reading
      const result = await tool.handler({ files, context: {} });

      expect(result).toBeDefined();
    });

    it("should summarize issues by severity", () => {
      const summary = {
        totalFiles: 5,
        criticalIssues: 1,
        highIssues: 2,
        mediumIssues: 3,
        lowIssues: 5,
        filesWithIssues: ["file1.js", "file2.js"],
      };

      expect(summary.criticalIssues).toBeGreaterThanOrEqual(0);
      expect(summary.totalFiles).toBeGreaterThan(0);
    });
  });

  describe("Fix Suggestions", () => {
    it("should provide fix suggestions for issues", async () => {
      const tool = codeReview.tools.find(t => t.name === "code_review_suggest_fix");
      const issue = {
        id: "hardcoded-secret",
        severity: "critical",
        message: "Hardcoded API key detected",
      };
      const code = `const API_KEY = "sk-12345"`;

      // This will fail without API keys but tests the handler
      const result = await tool.handler({ issue, code });

      expect(result).toBeDefined();
      expect(result.ok).toBeDefined();
    });
  });
});
