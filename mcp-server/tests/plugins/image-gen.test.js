/**
 * Image Generation Plugin Tests
 */

import { describe, it, expect } from "vitest";
import * as imageGen from "../../src/plugins/image-gen/index.js";

describe("Image Generation Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(imageGen.name).toBe("image-gen");
      expect(imageGen.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(imageGen.name).toBeDefined();
      expect(imageGen.version).toBeDefined();
      expect(imageGen.description).toBeDefined();
      expect(imageGen.endpoints).toBeDefined();
      expect(imageGen.tools).toBeDefined();
      expect(imageGen.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = imageGen.endpoints.map(e => e.path);
      expect(paths).toContain("/image/generate");
      expect(paths).toContain("/image/variations");
      expect(paths).toContain("/image/list");
    });
  });

  describe("MCP Tools", () => {
    it("should have image_generate tool", () => {
      const tool = imageGen.tools.find(t => t.name === "image_generate");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have image_generate_variations tool", () => {
      const tool = imageGen.tools.find(t => t.name === "image_generate_variations");
      expect(tool).toBeDefined();
    });

    it("should have image_enhance_prompt tool", () => {
      const tool = imageGen.tools.find(t => t.name === "image_enhance_prompt");
      expect(tool).toBeDefined();
    });

    it("should have image_list tool", () => {
      const tool = imageGen.tools.find(t => t.name === "image_list");
      expect(tool).toBeDefined();
    });
  });

  describe("Prompt Enhancement", () => {
    it("should enhance logo prompts", () => {
      const tool = imageGen.tools.find(t => t.name === "image_enhance_prompt");
      const result = tool.handler({
        basePrompt: "fintech company logo",
        type: "logo",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("Professional logo design");
      expect(result.data.enhanced).toContain("fintech company logo");
    });

    it("should enhance mockup prompts", () => {
      const tool = imageGen.tools.find(t => t.name === "image_enhance_prompt");
      const result = tool.handler({
        basePrompt: "dashboard interface",
        type: "mockup",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("UI/UX mockup");
    });

    it("should enhance icon prompts", () => {
      const tool = imageGen.tools.find(t => t.name === "image_enhance_prompt");
      const result = tool.handler({
        basePrompt: "settings gear",
        type: "icon",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("App icon design");
    });

    it("should enhance banner prompts", () => {
      const tool = imageGen.tools.find(t => t.name === "image_enhance_prompt");
      const result = tool.handler({
        basePrompt: "product launch banner",
        type: "banner",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("Marketing banner");
    });

    it("should preserve original prompt", () => {
      const tool = imageGen.tools.find(t => t.name === "image_enhance_prompt");
      const original = "my original prompt";
      const result = tool.handler({
        basePrompt: original,
        type: "logo",
      });

      expect(result.data.original).toBe(original);
    });
  });

  describe("Image Generation Options", () => {
    it("should support multiple sizes", () => {
      const tool = imageGen.tools.find(t => t.name === "image_generate");
      const schema = tool.parameters.properties;

      expect(schema.size.enum).toContain("1024x1024");
      expect(schema.size.enum).toContain("1792x1024");
      expect(schema.size.enum).toContain("1024x1792");
    });

    it("should support multiple providers", () => {
      const tool = imageGen.tools.find(t => t.name === "image_generate");
      const schema = tool.parameters.properties;

      expect(schema.provider.enum).toContain("openai");
      expect(schema.provider.enum).toContain("stability");
    });

    it("should support quality options for DALL-E", () => {
      const tool = imageGen.tools.find(t => t.name === "image_generate");
      const schema = tool.parameters.properties;

      expect(schema.quality.enum).toContain("standard");
      expect(schema.quality.enum).toContain("hd");
    });

    it("should support style options for DALL-E", () => {
      const tool = imageGen.tools.find(t => t.name === "image_generate");
      const schema = tool.parameters.properties;

      expect(schema.style.enum).toContain("vivid");
      expect(schema.style.enum).toContain("natural");
    });
  });

  describe("Image List", () => {
    it("should return list of generated images", () => {
      const tool = imageGen.tools.find(t => t.name === "image_list");
      const result = tool.handler({});

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("total");
      expect(result.data).toHaveProperty("images");
      expect(Array.isArray(result.data.images)).toBe(true);
    });
  });

  describe("Variations", () => {
    it("should support image variations", () => {
      const tool = imageGen.tools.find(t => t.name === "image_generate_variations");
      const schema = tool.parameters.properties;

      expect(schema).toHaveProperty("imagePath");
      expect(schema).toHaveProperty("n");
      expect(schema).toHaveProperty("size");
    });
  });
});
