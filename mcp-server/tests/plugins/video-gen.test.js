/**
 * Video Generation Plugin Tests
 */

import { describe, it, expect } from "vitest";
import * as videoGen from "../../src/plugins/video-gen/index.js";

describe("Video Generation Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(videoGen.name).toBe("video-gen");
      expect(videoGen.version).toBe("1.0.0");
    });

    it("should have required exports", () => {
      expect(videoGen.name).toBeDefined();
      expect(videoGen.version).toBeDefined();
      expect(videoGen.description).toBeDefined();
      expect(videoGen.endpoints).toBeDefined();
      expect(videoGen.tools).toBeDefined();
      expect(videoGen.register).toBeDefined();
    });

    it("should define required endpoints", () => {
      const paths = videoGen.endpoints.map(e => e.path);
      expect(paths).toContain("/video/generate");
      expect(paths).toContain("/video/status/:id");
      expect(paths).toContain("/video/avatar");
      expect(paths).toContain("/video/list");
    });
  });

  describe("MCP Tools", () => {
    it("should have video_generate tool", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate");
      expect(tool).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it("should have video_check_status tool", () => {
      const tool = videoGen.tools.find(t => t.name === "video_check_status");
      expect(tool).toBeDefined();
    });

    it("should have video_generate_avatar tool", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate_avatar");
      expect(tool).toBeDefined();
    });

    it("should have video_list tool", () => {
      const tool = videoGen.tools.find(t => t.name === "video_list");
      expect(tool).toBeDefined();
    });

    it("should have video_enhance_prompt tool", () => {
      const tool = videoGen.tools.find(t => t.name === "video_enhance_prompt");
      expect(tool).toBeDefined();
    });
  });

  describe("Prompt Enhancement", () => {
    it("should enhance demo prompts", () => {
      const tool = videoGen.tools.find(t => t.name === "video_enhance_prompt");
      const result = tool.handler({
        basePrompt: "app demo showing features",
        type: "demo",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("Product demo video");
      expect(result.data.enhanced).toContain("4K quality");
    });

    it("should enhance tutorial prompts", () => {
      const tool = videoGen.tools.find(t => t.name === "video_enhance_prompt");
      const result = tool.handler({
        basePrompt: "how to use the API",
        type: "tutorial",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("Tutorial video");
      expect(result.data.enhanced).toContain("educational");
    });

    it("should enhance promo prompts", () => {
      const tool = videoGen.tools.find(t => t.name === "video_enhance_prompt");
      const result = tool.handler({
        basePrompt: "new product launch",
        type: "promo",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("Promotional video");
      expect(result.data.enhanced).toContain("marketing");
    });

    it("should enhance intro prompts", () => {
      const tool = videoGen.tools.find(t => t.name === "video_enhance_prompt");
      const result = tool.handler({
        basePrompt: "brand logo reveal",
        type: "intro",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("Video intro");
      expect(result.data.enhanced).toContain("logo reveal");
    });

    it("should enhance social media prompts", () => {
      const tool = videoGen.tools.find(t => t.name === "video_enhance_prompt");
      const result = tool.handler({
        basePrompt: "viral content",
        type: "social",
      });

      expect(result.ok).toBe(true);
      expect(result.data.enhanced).toContain("Social media video");
      expect(result.data.enhanced).toContain("viral");
    });
  });

  describe("Video Generation Options", () => {
    it("should support multiple providers", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate");
      const schema = tool.parameters.properties;

      expect(schema.provider.enum).toContain("runway");
      expect(schema.provider.enum).toContain("pika");
    });

    it("should support multiple aspect ratios", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate");
      const schema = tool.parameters.properties;

      expect(schema.ratio.enum).toContain("16:9");
      expect(schema.ratio.enum).toContain("9:16");
      expect(schema.ratio.enum).toContain("1:1");
      expect(schema.ratio.enum).toContain("4:3");
    });

    it("should support duration option", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate");
      const schema = tool.parameters.properties;

      expect(schema.duration.type).toBe("number");
      expect(schema.duration.default).toBe(5);
    });

    it("should support image-to-video", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate");
      const schema = tool.parameters.properties;

      expect(schema).toHaveProperty("imageUrl");
    });
  });

  describe("Avatar Video", () => {
    it("should require text and avatarId", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate_avatar");
      const schema = tool.parameters;

      expect(schema.required).toContain("text");
      expect(schema.required).toContain("avatarId");
    });

    it("should support voice selection", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate_avatar");
      const schema = tool.parameters.properties;

      expect(schema).toHaveProperty("voiceId");
    });

    it("should support background customization", () => {
      const tool = videoGen.tools.find(t => t.name === "video_generate_avatar");
      const schema = tool.parameters.properties;

      expect(schema).toHaveProperty("backgroundType");
      expect(schema).toHaveProperty("backgroundValue");
      expect(schema.backgroundType.enum).toContain("color");
      expect(schema.backgroundType.enum).toContain("image");
    });
  });

  describe("Video List", () => {
    it("should return list of generated videos", () => {
      const tool = videoGen.tools.find(t => t.name === "video_list");
      const result = tool.handler({});

      expect(result.ok).toBe(true);
      expect(result.data).toHaveProperty("total");
      expect(result.data).toHaveProperty("videos");
      expect(Array.isArray(result.data.videos)).toBe(true);
    });
  });

  describe("Status Checking", () => {
    it("should check generation status", () => {
      const tool = videoGen.tools.find(t => t.name === "video_check_status");
      const schema = tool.parameters;

      expect(schema.required).toContain("id");
    });
  });
});
