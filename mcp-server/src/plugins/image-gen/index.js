/**
 * Image Generation Plugin
 *
 * Generate images using DALL-E, Stable Diffusion, and other providers.
 * Supports logos, mockups, diagrams, and UI assets.
 */

/* eslint-disable no-undef */

import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import OpenAI from "openai";

export const name = "image-gen";
export const version = "1.0.0";
export const description = "AI image generation for logos, mockups, and assets";

// Image generation providers
const PROVIDERS = {
  openai: {
    name: "OpenAI DALL-E",
    models: ["dall-e-3", "dall-e-2"],
    sizes: {
      "dall-e-3": ["1024x1024", "1792x1024", "1024x1792"],
      "dall-e-2": ["256x256", "512x512", "1024x1024"],
    },
    requiresKey: "OPENAI_API_KEY",
  },
  stability: {
    name: "Stability AI",
    models: ["stable-diffusion-xl-1024-v1-0", "stable-diffusion-v1-6"],
    sizes: ["1024x1024", "512x512", "768x768"],
    requiresKey: "STABILITY_API_KEY",
  },
};

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Track generated images
const generatedImages = new Map();

/**
 * Generate image with DALL-E
 */
async function generateWithDalle(prompt, options = {}) {
  const model = options.model || "dall-e-3";
  const size = options.size || "1024x1024";
  const quality = options.quality || "standard";
  const style = options.style || "vivid";

  const response = await openai.images.generate({
    model,
    prompt,
    size,
    quality,
    style,
    n: 1,
    response_format: "b64_json",
  });

  return {
    provider: "openai",
    model,
    data: response.data[0].b64_json,
    revisedPrompt: response.data[0].revised_prompt,
  };
}

/**
 * Generate image with Stability AI
 */
async function generateWithStability(prompt, options = {}) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) {
    throw new Error("STABILITY_API_KEY not configured");
  }

  const model = options.model || "stable-diffusion-xl-1024-v1-0";
  const size = options.size || "1024x1024";
  const [width, height] = size.split("x").map(Number);

  const response = await fetch("https://api.stability.ai/v1/generation/" + model + "/text-to-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
    body: JSON.stringify({
      text_prompts: [{ text: prompt }],
      cfg_scale: options.cfgScale || 7,
      samples: 1,
      steps: options.steps || 30,
      width,
      height,
    }),
  });

  if (!response.ok) {
    throw new Error(`Stability API error: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    provider: "stability",
    model,
    data: data.artifacts[0].base64,
    seed: data.artifacts[0].seed,
  };
}

/**
 * Save base64 image to file
 */
async function saveImage(base64Data, filepath) {
  const buffer = Buffer.from(base64Data, "base64");
  await mkdir(dirname(filepath), { recursive: true });
  await writeFile(filepath, buffer);
  return filepath;
}

/**
 * Generate image
 */
export async function generateImage(prompt, options = {}) {
  const provider = options.provider || "openai";

  let result;
  if (provider === "openai") {
    result = await generateWithDalle(prompt, options);
  } else if (provider === "stability") {
    result = await generateWithStability(prompt, options);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Save to file if path provided
  let savedPath = null;
  if (options.outputPath) {
    savedPath = await saveImage(result.data, options.outputPath);
  }

  // Track the generation
  const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const record = {
    id,
    prompt,
    provider: result.provider,
    model: result.model,
    createdAt: new Date().toISOString(),
    path: savedPath,
    size: options.size || "1024x1024",
  };
  generatedImages.set(id, record);

  return {
    id,
    ...record,
    base64: !options.outputPath ? result.data : undefined,
    revisedPrompt: result.revisedPrompt,
  };
}

/**
 * Generate variations of an image
 */
export async function generateVariations(imagePath, options = {}) {
  // DALL-E 2 supports variations
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  // Read image file and convert to base64
  const fs = await import("fs/promises");
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const response = await fetch("https://api.openai.com/v1/images/variations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
    body: new URLSearchParams({
      image: `data:image/png;base64,${base64Image}`,
      n: options.n || 4,
      size: options.size || "1024x1024",
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    throw new Error(`Variation generation failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data.map((img, i) => ({
    id: `var-${Date.now()}-${i}`,
    base64: img.b64_json,
    createdAt: new Date().toISOString(),
  }));
}

/**
 * Enhance prompt for better results
 */
export function enhancePrompt(basePrompt, type) {
  const enhancements = {
    logo: `Professional logo design: ${basePrompt}. Clean, minimalist, vector style, suitable for branding. White or transparent background.`,
    mockup: `UI/UX mockup: ${basePrompt}. Modern interface design, clean layout, professional color scheme. High fidelity.`,
    icon: `App icon design: ${basePrompt}. Simple, recognizable, scalable icon. Flat design style.`,
    diagram: `Technical diagram: ${basePrompt}. Clean infographic style, clear labels, professional presentation.`,
    banner: `Marketing banner: ${basePrompt}. Eye-catching, modern design, suitable for web header. 16:9 aspect ratio.`,
    avatar: `Character avatar: ${basePrompt}. Friendly, professional portrait style. Centered composition.`,
  };

  return enhancements[type] || basePrompt;
}

/**
 * List generated images
 */
export function listImages() {
  return Array.from(generatedImages.values());
}

// MCP Tools
export const tools = [
  {
    name: "image_generate",
    description: "Generate an image from text prompt",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the image to generate",
        },
        type: {
          type: "string",
          enum: ["logo", "mockup", "icon", "diagram", "banner", "avatar", "general"],
          description: "Type of image to enhance the prompt",
          default: "general",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1792x1024", "1024x1792", "512x512", "256x256"],
          description: "Image dimensions",
          default: "1024x1024",
        },
        provider: {
          type: "string",
          enum: ["openai", "stability"],
          description: "Image generation provider",
          default: "openai",
        },
        quality: {
          type: "string",
          enum: ["standard", "hd"],
          description: "Image quality (DALL-E 3 only)",
          default: "standard",
        },
        style: {
          type: "string",
          enum: ["vivid", "natural"],
          description: "Image style (DALL-E 3 only)",
          default: "vivid",
        },
        outputPath: {
          type: "string",
          description: "Path to save the image (optional, returns base64 if not provided)",
        },
      },
      required: ["prompt"],
    },
    handler: async ({ prompt, type, ...options }) => {
      try {
        const enhancedPrompt = enhancePrompt(prompt, type);
        const result = await generateImage(enhancedPrompt, options);
        return {
          ok: true,
          data: {
            id: result.id,
            path: result.path,
            provider: result.provider,
            model: result.model,
            createdAt: result.createdAt,
            size: result.size,
            revisedPrompt: result.revisedPrompt,
            base64: result.base64 ? `${result.base64.slice(0, 50)}... (truncated)` : undefined,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "generation_error",
            message: error.message,
          },
        };
      }
    },
  },
  {
    name: "image_generate_variations",
    description: "Generate variations of an existing image (DALL-E 2 only)",
    parameters: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "Path to the source image",
        },
        n: {
          type: "number",
          description: "Number of variations (1-4)",
          default: 4,
        },
        size: {
          type: "string",
          enum: ["256x256", "512x512", "1024x1024"],
          default: "1024x1024",
        },
      },
      required: ["imagePath"],
    },
    handler: async ({ imagePath, n, size }) => {
      try {
        const variations = await generateVariations(imagePath, { n, size });
        return {
          ok: true,
          data: {
            variations: variations.length,
            images: variations.map(v => ({
              id: v.id,
              createdAt: v.createdAt,
            })),
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "variation_error",
            message: error.message,
          },
        };
      }
    },
  },
  {
    name: "image_enhance_prompt",
    description: "Get enhanced prompt suggestions for better results",
    parameters: {
      type: "object",
      properties: {
        basePrompt: {
          type: "string",
          description: "Base description",
        },
        type: {
          type: "string",
          enum: ["logo", "mockup", "icon", "diagram", "banner", "avatar"],
          description: "Image type",
        },
      },
      required: ["basePrompt", "type"],
    },
    handler: ({ basePrompt, type }) => {
      const enhanced = enhancePrompt(basePrompt, type);
      return {
        ok: true,
        data: {
          original: basePrompt,
          enhanced,
          type,
        },
      };
    },
  },
  {
    name: "image_list",
    description: "List generated images",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: () => {
      const images = listImages();
      return {
        ok: true,
        data: {
          total: images.length,
          images: images.map(img => ({
            id: img.id,
            prompt: img.prompt.slice(0, 50) + "...",
            provider: img.provider,
            createdAt: img.createdAt,
            path: img.path,
          })),
        },
      };
    },
  },
];

// REST API Endpoints
export const endpoints = [
  {
    path: "/image/generate",
    method: "POST",
    handler: async (req, res) => {
      try {
        const { prompt, type, ...options } = req.body;
        const enhancedPrompt = enhancePrompt(prompt, type);
        const result = await generateImage(enhancedPrompt, options);
        res.json({ ok: true, data: result });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  },
  {
    path: "/image/variations",
    method: "POST",
    handler: async (req, res) => {
      try {
        const variations = await generateVariations(req.body.imagePath, req.body);
        res.json({ ok: true, data: variations });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  },
  {
    path: "/image/list",
    method: "GET",
    handler: (req, res) => {
      res.json({ ok: true, data: listImages() });
    },
  },
];

// Plugin registration
export function register(app, dependencies) {
  console.log("[Image Gen] Registered with providers:", Object.keys(PROVIDERS).join(", "));
}
