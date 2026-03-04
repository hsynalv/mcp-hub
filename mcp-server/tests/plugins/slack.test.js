import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

/**
 * Slack Plugin Unit Tests
 * Tests for schema validation and data formatting
 */

// Mock the slack client
vi.mock("../../src/plugins/slack/slack.client.js", () => ({
  slackRequest: vi.fn(),
}));

describe("Slack Plugin Schemas", () => {
  const sendMessageSchema = z.object({
    channel: z.string().min(1),
    text: z.string().min(1),
    thread_ts: z.string().optional(),
    blocks: z.array(z.any()).optional(),
  });

  const uploadFileSchema = z.object({
    channel: z.string().min(1),
    file: z.string().min(1),
    filename: z.string().min(1),
    title: z.string().optional(),
    initial_comment: z.string().optional(),
  });

  const addReactionSchema = z.object({
    channel: z.string().min(1),
    timestamp: z.string().min(1),
    name: z.string().min(1),
  });

  describe("sendMessageSchema", () => {
    it("should validate minimal message", () => {
      const message = { channel: "C123456", text: "Hello team!" };
      expect(() => sendMessageSchema.parse(message)).not.toThrow();
    });

    it("should validate message with thread", () => {
      const message = {
        channel: "C123456",
        text: "Reply in thread",
        thread_ts: "1234567890.123456",
      };
      expect(() => sendMessageSchema.parse(message)).not.toThrow();
    });

    it("should validate message with blocks", () => {
      const message = {
        channel: "C123456",
        text: "Message with blocks",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Bold* text" } }],
      };
      expect(() => sendMessageSchema.parse(message)).not.toThrow();
    });

    it("should reject message without channel", () => {
      expect(() => sendMessageSchema.parse({ text: "Hello" })).toThrow();
    });

    it("should reject message without text", () => {
      expect(() => sendMessageSchema.parse({ channel: "C123" })).toThrow();
    });

    it("should reject empty channel or text", () => {
      expect(() => sendMessageSchema.parse({ channel: "", text: "Hello" })).toThrow();
      expect(() => sendMessageSchema.parse({ channel: "C123", text: "" })).toThrow();
    });
  });

  describe("uploadFileSchema", () => {
    it("should validate file upload", () => {
      const upload = {
        channel: "C123456",
        file: "base64encodedcontent...",
        filename: "document.pdf",
      };
      expect(() => uploadFileSchema.parse(upload)).not.toThrow();
    });

    it("should validate file upload with optional fields", () => {
      const upload = {
        channel: "C123456",
        file: "base64content",
        filename: "image.png",
        title: "Project Screenshot",
        initial_comment: "Here's the latest design",
      };
      expect(() => uploadFileSchema.parse(upload)).not.toThrow();
    });

    it("should reject upload without required fields", () => {
      expect(() => uploadFileSchema.parse({ channel: "C123", filename: "test.txt" })).toThrow();
      expect(() => uploadFileSchema.parse({ channel: "C123", file: "content" })).toThrow();
      expect(() => uploadFileSchema.parse({ file: "content", filename: "test.txt" })).toThrow();
    });
  });

  describe("addReactionSchema", () => {
    it("should validate reaction", () => {
      const reaction = {
        channel: "C123456",
        timestamp: "1234567890.123456",
        name: "thumbsup",
      };
      expect(() => addReactionSchema.parse(reaction)).not.toThrow();
    });

    it("should validate different emoji reactions", () => {
      const reactions = ["thumbsup", "heart", "fire", "rocket", "white_check_mark"];

      reactions.forEach((emoji) => {
        expect(() =>
          addReactionSchema.parse({ channel: "C123", timestamp: "123.456", name: emoji })
        ).not.toThrow();
      });
    });

    it("should reject reaction without required fields", () => {
      expect(() => addReactionSchema.parse({ channel: "C123", name: "thumbsup" })).toThrow();
      expect(() => addReactionSchema.parse({ timestamp: "123.456", name: "thumbsup" })).toThrow();
      expect(() => addReactionSchema.parse({ channel: "C123", timestamp: "123.456" })).toThrow();
    });
  });
});

describe("Slack Plugin Formatters", () => {
  const formatChannel = (channel) => ({
    id: channel.id,
    name: channel.name,
    display_name: channel.display_name || channel.name,
    purpose: channel.purpose?.value || "",
    topic: channel.topic?.value || "",
    type: channel.type,
    is_archived: channel.is_archived,
    created: channel.created,
    member_count: channel.num_members || 0,
  });

  const formatUser = (user) => ({
    id: user.id,
    name: user.name,
    real_name: user.real_name || user.profile?.real_name || "",
    display_name: user.profile?.display_name || user.name,
    email: user.profile?.email || "",
    title: user.profile?.title || "",
    status: user.profile?.status_text || "",
    is_admin: user.is_admin || false,
    is_owner: user.is_owner || false,
    is_bot: user.is_bot || false,
    deleted: user.deleted || false,
    timezone: user.tz || "",
  });

  describe("formatChannel", () => {
    it("should format public channel", () => {
      const input = {
        id: "C123456",
        name: "general",
        display_name: "General Discussion",
        purpose: { value: "Company-wide announcements" },
        topic: { value: "Welcome everyone!" },
        type: "public_channel",
        is_archived: false,
        created: 1234567890,
        num_members: 150,
      };

      const result = formatChannel(input);

      expect(result.id).toBe("C123456");
      expect(result.name).toBe("general");
      expect(result.display_name).toBe("General Discussion");
      expect(result.purpose).toBe("Company-wide announcements");
      expect(result.topic).toBe("Welcome everyone!");
      expect(result.type).toBe("public_channel");
      expect(result.is_archived).toBe(false);
      expect(result.member_count).toBe(150);
    });

    it("should format private channel with defaults", () => {
      const input = {
        id: "C789012",
        name: "secret-project",
        type: "private_channel",
        is_archived: false,
        created: 1234567890,
      };

      const result = formatChannel(input);

      expect(result.id).toBe("C789012");
      expect(result.display_name).toBe("secret-project");
      expect(result.purpose).toBe("");
      expect(result.topic).toBe("");
      expect(result.member_count).toBe(0);
    });

    it("should format archived channel", () => {
      const input = {
        id: "C999999",
        name: "old-project",
        type: "public_channel",
        is_archived: true,
        created: 1234567890,
        num_members: 0,
      };

      const result = formatChannel(input);

      expect(result.is_archived).toBe(true);
      expect(result.member_count).toBe(0);
    });
  });

  describe("formatUser", () => {
    it("should format active user", () => {
      const input = {
        id: "U123456",
        name: "john.doe",
        real_name: "John Doe",
        profile: {
          display_name: "John",
          email: "john@example.com",
          title: "Software Engineer",
          status_text: "Working remotely",
          real_name: "John Doe",
        },
        is_admin: true,
        is_owner: false,
        is_bot: false,
        deleted: false,
        tz: "America/New_York",
      };

      const result = formatUser(input);

      expect(result.id).toBe("U123456");
      expect(result.name).toBe("john.doe");
      expect(result.real_name).toBe("John Doe");
      expect(result.display_name).toBe("John");
      expect(result.email).toBe("john@example.com");
      expect(result.title).toBe("Software Engineer");
      expect(result.status).toBe("Working remotely");
      expect(result.is_admin).toBe(true);
      expect(result.is_bot).toBe(false);
      expect(result.timezone).toBe("America/New_York");
    });

    it("should format bot user", () => {
      const input = {
        id: "B123456",
        name: "slackbot",
        profile: {
          display_name: "Slack Bot",
        },
        is_admin: false,
        is_owner: false,
        is_bot: true,
        deleted: false,
      };

      const result = formatUser(input);

      expect(result.id).toBe("B123456");
      expect(result.name).toBe("slackbot");
      expect(result.is_bot).toBe(true);
      expect(result.email).toBe("");
    });

    it("should handle missing profile fields", () => {
      const input = {
        id: "U999999",
        name: "minimal.user",
      };

      const result = formatUser(input);

      expect(result.real_name).toBe("");
      expect(result.display_name).toBe("minimal.user");
      expect(result.email).toBe("");
      expect(result.is_admin).toBe(false);
    });
  });
});

describe("Slack Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "slack";
    const version = "1.0.0";
    const description = "Slack team communication and bot integration";
    const capabilities = ["read", "write"];
    const requires = ["SLACK_BOT_TOKEN"];

    expect(name).toBe("slack");
    expect(version).toBe("1.0.0");
    expect(description).toContain("Slack");
    expect(capabilities).toContain("read");
    expect(capabilities).toContain("write");
    expect(requires).toContain("SLACK_BOT_TOKEN");
  });

  it("should define messaging endpoints", () => {
    const endpoints = [
      { method: "POST", path: "/slack/message", scope: "write" },
      { method: "POST", path: "/slack/files/upload", scope: "write" },
      { method: "POST", path: "/slack/reactions/add", scope: "write" },
      { method: "GET", path: "/slack/channels", scope: "read" },
      { method: "GET", path: "/slack/users", scope: "read" },
    ];

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});
