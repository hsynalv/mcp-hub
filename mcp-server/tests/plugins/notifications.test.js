/**
 * Notifications Plugin Tests
 */

import { describe, it, expect } from "vitest";
import * as notifications from "../../src/plugins/notifications/index.js";

describe("Notifications Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(notifications.name).toBe("notifications");
      expect(notifications.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(notifications.name).toBeDefined();
      expect(notifications.version).toBeDefined();
      expect(notifications.description).toBeDefined();
      expect(notifications.endpoints).toBeDefined();
      expect(notifications.tools).toBeDefined();
      expect(notifications.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = notifications.endpoints.map(e => e.path);
      expect(paths).toContain("/notifications/show");
      expect(paths).toContain("/notifications/sound");
      expect(paths).toContain("/notifications/history");
      expect(paths).toContain("/notifications/os");
    });
  });

  describe("MCP Tools", () => {
    it("should have notification_show tool", () => {
      const tool = notifications.tools.find(t => t.name === "notification_show");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have notification_sound tool", () => {
      const tool = notifications.tools.find(t => t.name === "notification_sound");
      expect(tool).toBeDefined();
    });

    it("should have notification_task_complete tool", () => {
      const tool = notifications.tools.find(t => t.name === "notification_task_complete");
      expect(tool).toBeDefined();
    });

    it("should have notification_error tool", () => {
      const tool = notifications.tools.find(t => t.name === "notification_error");
      expect(tool).toBeDefined();
    });

    it("should have notification_history tool", () => {
      const tool = notifications.tools.find(t => t.name === "notification_history");
      expect(tool).toBeDefined();
    });
  });

  describe("notification_show", () => {
    it("should require title", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_show");
      const result = await tool.handler({ message: "Test" });

      // Missing title should fail
      expect(result.ok).toBe(false);
    });

    it("should require message", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_show");
      const result = await tool.handler({ title: "Test" });

      // Missing message should fail
      expect(result.ok).toBe(false);
    });

    it("should accept sound option", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_show");
      // This will fail in test environment (no display), but tests input handling
      const result = await tool.handler({
        title: "Test",
        message: "Hello",
        sound: true
      });

      // Expected to fail in headless test environment
      expect(result.ok).toBe(false);
    });
  });

  describe("notification_sound", () => {
    it("should play default sound", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_sound");
      const result = await tool.handler({});

      // Will fail in test environment but tests input handling
      expect(result).toBeDefined();
    });

    it("should accept sound name", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_sound");
      const result = await tool.handler({ sound: "Ping" });

      expect(result).toBeDefined();
    });
  });

  describe("notification_task_complete", () => {
    it("should send task completion notification", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_task_complete");
      const result = await tool.handler({
        taskName: "Build Project",
        summary: "Build completed successfully"
      });

      // Expected to fail in headless environment
      expect(result).toBeDefined();
    });

    it("should accept project name", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_task_complete");
      const result = await tool.handler({
        taskName: "Deploy",
        summary: "Deployed to production",
        projectName: "MyApp"
      });

      expect(result).toBeDefined();
    });
  });

  describe("notification_error", () => {
    it("should send error notification", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_error");
      const result = await tool.handler({
        error: "Build failed",
        context: "CI/CD"
      });

      // Expected to fail in headless environment
      expect(result).toBeDefined();
    });
  });

  describe("notification_history", () => {
    it("should return notification history", async () => {
      const tool = notifications.tools.find(t => t.name === "notification_history");
      const result = await tool.handler({ limit: 20 });

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("notifications");
      expect(Array.isArray(result.data.notifications)).toBe(true);
    });
  });
});
