/**
 * Video Generation Plugin
 *
 * AI video generation using Runway, Pika Labs, and other providers.
 * Creates demos, tutorials, and promotional videos.
 */

import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export const name = "video-gen";
export const version = "1.0.0";
export const description = "AI video generation for demos and content";

// Video generation providers
const PROVIDERS = {
  runway: {
    name: "Runway Gen-3",
    models: ["gen3", "gen2"],
    requiresKey: "RUNWAY_API_KEY",
    maxDuration: 10, // seconds
    supports: ["text-to-video", "image-to-video"],
  },
  pika: {
    name: "Pika Labs",
    models: ["pika-1.5"],
    requiresKey: "PIKA_API_KEY",
    maxDuration: 3,
    supports: ["text-to-video", "image-to-video"],
  },
  heygen: {
    name: "HeyGen",
    models: ["avatar"],
    requiresKey: "HEYGEN_API_KEY",
    supports: ["avatar-video"],
  },
};

// Track generated videos
const generatedVideos = new Map();

/**
 * Generate video with Runway
 */
async function generateWithRunway(prompt, options = {}) {
  const apiKey = process.env.RUNWAY_API_KEY;
  if (!apiKey) {
    throw new Error("RUNWAY_API_KEY not configured");
  }

  const response = await fetch("https://api.runwayml.com/v1/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      model: options.model || "gen3",
      duration: Math.min(options.duration || 5, 10),
      ratio: options.ratio || "16:9",
      ...(options.imageUrl && { image_url: options.imageUrl }),
    }),
  });

  if (!response.ok) {
    throw new Error(`Runway API error: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    provider: "runway",
    generationId: data.id,
    status: "pending",
    estimatedTime: 60,
  };
}

/**
 * Check Runway generation status
 */
async function checkRunwayStatus(generationId) {
  const apiKey = process.env.RUNWAY_API_KEY;
  const response = await fetch(`https://api.runwayml.com/v1/generations/${generationId}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to check status");
  }

  const data = await response.json();
  return {
    status: data.status,
    url: data.url,
    progress: data.progress,
  };
}

/**
 * Generate video with Pika Labs
 */
async function generateWithPika(prompt, options = {}) {
  const apiKey = process.env.PIKA_API_KEY;
  if (!apiKey) {
    throw new Error("PIKA_API_KEY not configured");
  }

  const response = await fetch("https://api.pika.art/v1/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      model: options.model || "pika-1.5",
      duration: Math.min(options.duration || 3, 3),
      aspect_ratio: options.ratio || "16:9",
      ...(options.image && { image: options.image }),
    }),
  });

  if (!response.ok) {
    throw new Error(`Pika API error: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    provider: "pika",
    generationId: data.id,
    status: "pending",
    estimatedTime: 45,
  };
}

/**
 * Generate avatar video with HeyGen
 */
async function generateWithHeygen(text, avatarId, options = {}) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error("HEYGEN_API_KEY not configured");
  }

  const response = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify({
      video_inputs: [{
        character: {
          type: "avatar",
          avatar_id: avatarId,
          avatar_style: "normal",
        },
        voice: {
          type: "text",
          input_text: text,
          voice_id: options.voiceId || "en-US-Standard",
        },
        background: {
          type: options.backgroundType || "color",
          value: options.backgroundValue || "#ffffff",
        },
      }],
      dimension: {
        width: options.width || 1920,
        height: options.height || 1080,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`HeyGen API error: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    provider: "heygen",
    videoId: data.data.video_id,
    status: "pending",
    estimatedTime: 120,
  };
}

/**
 * Generate video
 */
export async function generateVideo(prompt, options = {}) {
  const provider = options.provider || "runway";

  let result;
  if (provider === "runway") {
    result = await generateWithRunway(prompt, options);
  } else if (provider === "pika") {
    result = await generateWithPika(prompt, options);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Track the generation
  const id = `vid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const record = {
    id,
    prompt,
    provider: result.provider,
    generationId: result.generationId,
    status: result.status,
    createdAt: new Date().toISOString(),
    estimatedTime: result.estimatedTime,
  };
  generatedVideos.set(id, record);

  return {
    id,
    ...record,
    message: `Video generation started. Use video_check_status with id "${id}" to check progress.`,
  };
}

/**
 * Check video generation status
 */
export async function checkStatus(id) {
  const record = generatedVideos.get(id);
  if (!record) {
    throw new Error("Video generation not found");
  }

  let status;
  if (record.provider === "runway") {
    status = await checkRunwayStatus(record.generationId);
  } else if (record.provider === "pika") {
    // Similar implementation for Pika
    status = { status: "unknown", url: null };
  } else {
    throw new Error("Provider status check not implemented");
  }

  // Update record
  record.status = status.status;
  record.url = status.url;
  record.progress = status.progress;

  return {
    id,
    ...record,
  };
}

/**
 * Generate avatar/presentation video
 */
export async function generateAvatarVideo(text, avatarId, options = {}) {
  const result = await generateWithHeygen(text, avatarId, options);

  const id = `avatar-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const record = {
    id,
    type: "avatar",
    text: text.slice(0, 100) + "...",
    provider: "heygen",
    videoId: result.videoId,
    status: result.status,
    createdAt: new Date().toISOString(),
  };
  generatedVideos.set(id, record);

  return {
    id,
    ...record,
  };
}

/**
 * List generated videos
 */
export function listVideos() {
  return Array.from(generatedVideos.values());
}

/**
 * Enhance video prompt
 */
export function enhancePrompt(basePrompt, type) {
  const enhancements = {
    demo: `Product demo video: ${basePrompt}. Smooth camera movements, professional lighting, modern tech aesthetic, 4K quality.`,
    tutorial: `Tutorial video: ${basePrompt}. Clear and educational, step-by-step visualization, helpful annotations, clean background.`,
    promo: `Promotional video: ${basePrompt}. Dynamic and engaging, marketing style, eye-catching visuals, professional quality.`,
    intro: `Video intro: ${basePrompt}. Short and impactful, logo reveal, brand identity, memorable opening.`,
    social: `Social media video: ${basePrompt}. Attention-grabbing, vertical format optimized, trendy style, viral-worthy.`,
  };

  return enhancements[type] || basePrompt;
}

// MCP Tools
export const tools = [
  {
    name: "video_generate",
    description: "Generate a video from text prompt",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the video to generate",
        },
        type: {
          type: "string",
          enum: ["demo", "tutorial", "promo", "intro", "social", "general"],
          description: "Video type for prompt enhancement",
          default: "general",
        },
        provider: {
          type: "string",
          enum: ["runway", "pika"],
          description: "Video generation provider",
          default: "runway",
        },
        duration: {
          type: "number",
          description: "Video duration in seconds (max 10 for Runway, 3 for Pika)",
          default: 5,
        },
        ratio: {
          type: "string",
          enum: ["16:9", "9:16", "1:1", "4:3"],
          description: "Aspect ratio",
          default: "16:9",
        },
        imageUrl: {
          type: "string",
          description: "Optional image URL for image-to-video (Runway only)",
        },
      },
      required: ["prompt"],
    },
    handler: async ({ prompt, type, ...options }) => {
      try {
        const enhancedPrompt = enhancePrompt(prompt, type);
        const result = await generateVideo(enhancedPrompt, options);
        return {
          ok: true,
          data: result,
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
    name: "video_check_status",
    description: "Check video generation status",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Video generation ID",
        },
      },
      required: ["id"],
    },
    handler: async ({ id }) => {
      try {
        const status = await checkStatus(id);
        return {
          ok: true,
          data: status,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "status_error",
            message: error.message,
          },
        };
      }
    },
  },
  {
    name: "video_generate_avatar",
    description: "Generate avatar/presentation video with HeyGen",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text for avatar to speak",
        },
        avatarId: {
          type: "string",
          description: "HeyGen avatar ID",
        },
        voiceId: {
          type: "string",
          description: "Voice ID",
        },
        backgroundType: {
          type: "string",
          enum: ["color", "image"],
          default: "color",
        },
        backgroundValue: {
          type: "string",
          description: "Background color (hex) or image URL",
          default: "#ffffff",
        },
      },
      required: ["text", "avatarId"],
    },
    handler: async ({ text, avatarId, voiceId, backgroundType, backgroundValue }) => {
      try {
        const result = await generateAvatarVideo(text, avatarId, {
          voiceId,
          backgroundType,
          backgroundValue,
        });
        return {
          ok: true,
          data: result,
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "avatar_error",
            message: error.message,
          },
        };
      }
    },
  },
  {
    name: "video_list",
    description: "List generated videos",
    parameters: {
      type: "object",
      properties: {},
    },
    handler: () => {
      const videos = listVideos();
      return {
        ok: true,
        data: {
          total: videos.length,
          videos: videos.map(v => ({
            id: v.id,
            type: v.type || "text-to-video",
            provider: v.provider,
            status: v.status,
            createdAt: v.createdAt,
            url: v.url,
          })),
        },
      };
    },
  },
  {
    name: "video_enhance_prompt",
    description: "Get enhanced video prompt suggestions",
    parameters: {
      type: "object",
      properties: {
        basePrompt: {
          type: "string",
          description: "Base description",
        },
        type: {
          type: "string",
          enum: ["demo", "tutorial", "promo", "intro", "social"],
          description: "Video type",
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
];

// REST API Endpoints
export const endpoints = [
  {
    path: "/video/generate",
    method: "POST",
    handler: async (req, res) => {
      try {
        const { prompt, type, ...options } = req.body;
        const enhancedPrompt = enhancePrompt(prompt, type);
        const result = await generateVideo(enhancedPrompt, options);
        res.json({ ok: true, data: result });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  },
  {
    path: "/video/status/:id",
    method: "GET",
    handler: async (req, res) => {
      try {
        const status = await checkStatus(req.params.id);
        res.json({ ok: true, data: status });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  },
  {
    path: "/video/avatar",
    method: "POST",
    handler: async (req, res) => {
      try {
        const result = await generateAvatarVideo(
          req.body.text,
          req.body.avatarId,
          req.body.options
        );
        res.json({ ok: true, data: result });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  },
  {
    path: "/video/list",
    method: "GET",
    handler: (req, res) => {
      res.json({ ok: true, data: listVideos() });
    },
  },
];

// Plugin registration
export function register(app, dependencies) {
  console.log("[Video Gen] Registered with providers:", Object.keys(PROVIDERS).join(", "));
}
