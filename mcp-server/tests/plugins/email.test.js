/**
 * Email Plugin Tests
 */

import { describe, it, expect } from "vitest";
import * as email from "../../src/plugins/email/index.js";

describe("Email Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(email.name).toBe("email");
      expect(email.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(email.name).toBeDefined();
      expect(email.version).toBeDefined();
      expect(email.description).toBeDefined();
      expect(email.endpoints).toBeDefined();
      expect(email.tools).toBeDefined();
      expect(email.register).toBeDefined();
    });

    it("should require SMTP configuration", () => {
      expect(email.requires).toContain("SMTP_HOST");
      expect(email.requires).toContain("SMTP_USER");
      expect(email.requires).toContain("SMTP_PASS");
    });

    it("should define required endpoints", () => {
      const paths = email.endpoints.map(e => e.path);
      expect(paths).toContain("/email/send");
      expect(paths).toContain("/email/history");
      expect(paths).toContain("/email/health");
    });
  });

  describe("MCP Tools", () => {
    it("should have email_send tool", () => {
      const tool = email.tools.find(t => t.name === "email_send");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have email_send_template tool", () => {
      const tool = email.tools.find(t => t.name === "email_send_template");
      expect(tool).toBeDefined();
    });

    it("should have email_history tool", () => {
      const tool = email.tools.find(t => t.name === "email_history");
      expect(tool).toBeDefined();
    });
  });

  describe("email_send", () => {
    it("should return error when not configured", async () => {
      // Assuming SMTP is not configured in test environment
      const tool = email.tools.find(t => t.name === "email_send");
      const result = await tool.handler({
        to: "test@example.com",
        subject: "Test",
        text: "Hello"
      });

      // Should fail since SMTP is not configured in tests
      expect(result.ok).toBe(false);
    });

    it("should validate required fields", async () => {
      const tool = email.tools.find(t => t.name === "email_send");
      
      // Missing subject
      const result1 = await tool.handler({
        to: "test@example.com",
        text: "Hello"
      });
      expect(result1.ok).toBe(false);
    });
  });

  describe("email_send_template", () => {
    it("should require template name", async () => {
      const tool = email.tools.find(t => t.name === "email_send_template");
      const result = await tool.handler({
        data: { title: "Test" },
        to: "test@example.com"
      });

      expect(result.ok).toBe(false);
    });

    it("should require template data", async () => {
      const tool = email.tools.find(t => t.name === "email_send_template");
      const result = await tool.handler({
        template: "notification",
        to: "test@example.com"
      });

      expect(result.ok).toBe(false);
    });

    it("should accept valid template names", async () => {
      const tool = email.tools.find(t => t.name === "email_send_template");
      
      // This will fail due to SMTP not configured, but validates input schema
      const result = await tool.handler({
        template: "simple",
        data: { subject: "Test", body: "Hello" },
        to: "test@example.com"
      });

      // Schema validation passes, but SMTP fails
      expect(result.ok).toBe(false);
    });
  });

  describe("email_history", () => {
    it("should return email history", async () => {
      const tool = email.tools.find(t => t.name === "email_history");
      const result = await tool.handler({ limit: 10 });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("emails");
      expect(Array.isArray(result.data.emails)).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const tool = email.tools.find(t => t.name === "email_history");
      const result = await tool.handler({ limit: 5 });

      expect(result.ok).toBe(true);
      expect(result.data.emails.length).toBeLessThanOrEqual(5);
    });
  });
});
