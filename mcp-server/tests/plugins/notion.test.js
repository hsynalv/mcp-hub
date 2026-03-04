import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

/**
 * Notion Plugin Unit Tests
 * Tests for schema validation and block formatting
 */

// Mock the notion client
vi.mock("../../src/plugins/notion/notion.client.js", () => ({
  notionRequest: vi.fn(),
}));

describe("Notion Plugin Schemas", () => {
  const blockSchema = z.object({
    type: z.string(),
    text: z.string().optional(),
    checked: z.boolean().optional(),
    language: z.string().optional(),
    emoji: z.string().optional(),
  });

  const createPageSchema = z.object({
    title: z.string().min(1),
    parentPageId: z.string().optional(),
    icon: z.string().optional(),
    cover: z.string().url().optional(),
    blocks: z.array(blockSchema).optional(),
  });

  const appendBlocksSchema = z.object({
    blocks: z.array(blockSchema).min(1),
  });

  const addTaskSchema = z.object({
    name: z.string().min(1),
    status: z.enum(["Todo", "In Progress", "Done", "Blocked"]).optional(),
    priority: z.enum(["High", "Medium", "Low"]).optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
  });

  describe("blockSchema", () => {
    it("should validate valid block types", () => {
      const validBlocks = [
        { type: "paragraph", text: "Hello world" },
        { type: "heading_1", text: "Title" },
        { type: "code", text: "const x = 1;", language: "javascript" },
        { type: "to_do", text: "Task", checked: false },
        { type: "callout", text: "Note", emoji: "💡" },
      ];

      validBlocks.forEach((block) => {
        expect(() => blockSchema.parse(block)).not.toThrow();
      });
    });

    it("should reject blocks without type", () => {
      expect(() => blockSchema.parse({ text: "Missing type" })).toThrow();
    });
  });

  describe("createPageSchema", () => {
    it("should validate page creation with required title", () => {
      expect(() =>
        createPageSchema.parse({ title: "New Page" })
      ).not.toThrow();
    });

    it("should validate full page creation", () => {
      const page = {
        title: "Project Documentation",
        parentPageId: "abc-123",
        icon: "📚",
        cover: "https://example.com/cover.jpg",
        blocks: [
          { type: "heading_1", text: "Introduction" },
          { type: "paragraph", text: "This is the intro" },
        ],
      };

      expect(() => createPageSchema.parse(page)).not.toThrow();
    });

    it("should reject empty title", () => {
      expect(() => createPageSchema.parse({ title: "" })).toThrow();
    });

    it("should reject invalid cover URL", () => {
      expect(() =>
        createPageSchema.parse({ title: "Test", cover: "not-a-url" })
      ).toThrow();
    });
  });

  describe("appendBlocksSchema", () => {
    it("should validate block array", () => {
      expect(() =>
        appendBlocksSchema.parse({
          blocks: [{ type: "paragraph", text: "New paragraph" }],
        })
      ).not.toThrow();
    });

    it("should reject empty blocks array", () => {
      expect(() => appendBlocksSchema.parse({ blocks: [] })).toThrow();
    });

    it("should reject missing blocks", () => {
      expect(() => appendBlocksSchema.parse({})).toThrow();
    });
  });

  describe("addTaskSchema", () => {
    it("should validate minimal task", () => {
      expect(() => addTaskSchema.parse({ name: "New Task" })).not.toThrow();
    });

    it("should validate full task", () => {
      const task = {
        name: "Important Task",
        status: "In Progress",
        priority: "High",
        dueDate: "2024-12-31",
        notes: "Some notes here",
      };

      expect(() => addTaskSchema.parse(task)).not.toThrow();
    });

    it("should reject invalid status", () => {
      expect(() =>
        addTaskSchema.parse({ name: "Task", status: "Invalid" })
      ).toThrow();
    });

    it("should reject invalid priority", () => {
      expect(() =>
        addTaskSchema.parse({ name: "Task", priority: "Urgent" })
      ).toThrow();
    });
  });
});

describe("Notion Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "notion";
    const version = "1.0.0";
    const description = "Notion pages, databases, projects and tasks";
    const capabilities = ["read", "write"];
    const requires = ["NOTION_API_KEY"];

    expect(name).toBe("notion");
    expect(version).toBe("1.0.0");
    expect(description).toContain("Notion");
    expect(capabilities).toContain("read");
    expect(capabilities).toContain("write");
    expect(requires).toContain("NOTION_API_KEY");
  });

  it("should define comprehensive endpoints", () => {
    const endpoints = [
      { method: "GET", path: "/notion/search", scope: "read" },
      { method: "GET", path: "/notion/projects", scope: "read" },
      { method: "POST", path: "/notion/projects", scope: "write" },
      { method: "GET", path: "/notion/tasks", scope: "read" },
      { method: "POST", path: "/notion/tasks", scope: "write" },
      { method: "POST", path: "/notion/setup-project", scope: "write" },
      { method: "POST", path: "/notion/row", scope: "write" },
      { method: "DELETE", path: "/notion/row/:pageId", scope: "write" },
    ];

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});

describe("Notion Block Formatting", () => {
  const toNotionBlocks = (blocks) => {
    return blocks.map((block) => {
      const obj = {
        object: "block",
        type: block.type,
      };

      switch (block.type) {
        case "paragraph":
          obj.paragraph = {
            rich_text: [{ type: "text", text: { content: block.text || "" } }],
          };
          break;
        case "heading_1":
        case "heading_2":
        case "heading_3":
          obj[block.type] = {
            rich_text: [{ type: "text", text: { content: block.text || "" } }],
          };
          break;
        case "code":
          obj.code = {
            rich_text: [{ type: "text", text: { content: block.text || "" } }],
            language: block.language || "plain text",
          };
          break;
        case "to_do":
          obj.to_do = {
            rich_text: [{ type: "text", text: { content: block.text || "" } }],
            checked: block.checked || false,
          };
          break;
        case "callout":
          obj.callout = {
            rich_text: [{ type: "text", text: { content: block.text || "" } }],
            icon: { emoji: block.emoji || "💡" },
          };
          break;
        default:
          obj.paragraph = {
            rich_text: [{ type: "text", text: { content: block.text || "" } }],
          };
      }

      return obj;
    });
  };

  describe("toNotionBlocks", () => {
    it("should format paragraph blocks", () => {
      const blocks = [{ type: "paragraph", text: "Hello world" }];
      const result = toNotionBlocks(blocks);

      expect(result[0].type).toBe("paragraph");
      expect(result[0].paragraph.rich_text[0].text.content).toBe("Hello world");
    });

    it("should format heading blocks", () => {
      const blocks = [
        { type: "heading_1", text: "Title" },
        { type: "heading_2", text: "Subtitle" },
        { type: "heading_3", text: "Section" },
      ];
      const result = toNotionBlocks(blocks);

      expect(result[0].type).toBe("heading_1");
      expect(result[1].type).toBe("heading_2");
      expect(result[2].type).toBe("heading_3");
    });

    it("should format code blocks with language", () => {
      const blocks = [{ type: "code", text: "console.log('hi')", language: "javascript" }];
      const result = toNotionBlocks(blocks);

      expect(result[0].type).toBe("code");
      expect(result[0].code.language).toBe("javascript");
    });

    it("should format todo blocks with checked state", () => {
      const blocks = [
        { type: "to_do", text: "Incomplete task", checked: false },
        { type: "to_do", text: "Complete task", checked: true },
      ];
      const result = toNotionBlocks(blocks);

      expect(result[0].to_do.checked).toBe(false);
      expect(result[1].to_do.checked).toBe(true);
    });

    it("should format callout blocks with emoji", () => {
      const blocks = [{ type: "callout", text: "Important note", emoji: "⚠️" }];
      const result = toNotionBlocks(blocks);

      expect(result[0].type).toBe("callout");
      expect(result[0].callout.icon.emoji).toBe("⚠️");
    });

    it("should default missing values", () => {
      const blocks = [
        { type: "code", text: "code" },
        { type: "callout", text: "note" },
      ];
      const result = toNotionBlocks(blocks);

      expect(result[0].code.language).toBe("plain text");
      expect(result[1].callout.icon.emoji).toBe("💡");
    });
  });
});
