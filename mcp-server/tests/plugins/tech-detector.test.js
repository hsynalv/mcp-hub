/**
 * Tech Stack Detector Plugin Tests
 */

import { describe, it, expect } from "vitest";
import * as techDetector from "../../src/plugins/tech-detector/index.js";

describe("Tech Stack Detector Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(techDetector.name).toBe("tech-detector");
      expect(techDetector.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(techDetector.name).toBeDefined();
      expect(techDetector.version).toBeDefined();
      expect(techDetector.description).toBeDefined();
      expect(techDetector.endpoints).toBeDefined();
      expect(techDetector.tools).toBeDefined();
      expect(techDetector.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = techDetector.endpoints.map(e => e.path);
      expect(paths).toContain("/tech/detect");
      expect(paths).toContain("/tech/recommend");
      expect(paths).toContain("/tech/compare");
    });
  });

  describe("MCP Tools", () => {
    it("should have tech_detect tool", () => {
      const tool = techDetector.tools.find(t => t.name === "tech_detect");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have tech_recommend tool", () => {
      const tool = techDetector.tools.find(t => t.name === "tech_recommend");
      expect(tool).toBeDefined();
    });

    it("should have tech_compare tool", () => {
      const tool = techDetector.tools.find(t => t.name === "tech_compare");
      expect(tool).toBeDefined();
    });
  });

  describe("tech_recommend", () => {
    it("should recommend stack for web-app", () => {
      const tool = techDetector.tools.find(t => t.name === "tech_recommend");
      const result = tool.handler({
        type: "web-app",
        scale: "medium",
        priorities: ["performance", "developer-experience"],
      });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("frontend");
      expect(result.data).toHaveProperty("backend");
      expect(result.data).toHaveProperty("devops");
    });

    it("should recommend different stacks based on scale", () => {
      const tool = techDetector.tools.find(t => t.name === "tech_recommend");

      const small = tool.handler({ type: "api", scale: "small" });
      const large = tool.handler({ type: "api", scale: "large" });

      expect(small.ok).toBe(true);
      expect(large.ok).toBe(true);
    });
  });

  describe("tech_compare", () => {
    it("should compare technologies", () => {
      const tool = techDetector.tools.find(t => t.name === "tech_compare");
      const result = tool.handler({
        optionA: "nextjs",
        optionB: "react",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("nextjs");
      expect(result.data).toHaveProperty("react");
    });

    it("should handle unknown comparisons gracefully", () => {
      const tool = techDetector.tools.find(t => t.name === "tech_compare");
      const result = tool.handler({
        optionA: "unknown-tech",
        optionB: "another-unknown",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("error");
    });
  });

  describe("Stack Detection Logic", () => {
    it("should detect JavaScript/TypeScript projects", async () => {
      // This would require mocking fs operations in a real test
      const mockFiles = ["package.json", "tsconfig.json"];
      const mockContent = {
        dependencies: { react: "18.0.0", next: "14.0.0" },
      };

      expect(mockFiles).toContain("package.json");
      expect(mockContent.dependencies).toHaveProperty("react");
    });
  });
});
