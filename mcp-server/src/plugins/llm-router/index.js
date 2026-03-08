/**
 * Multi-LLM Router Plugin
 *
 * Routes tasks to specialized LLM providers based on capability, cost, and task type.
 * Supports multiple providers: OpenAI, Anthropic, Google, Mistral, Ollama
 */

import OpenAI from "openai";
import { withResilience } from "../core/resilience.js";
import { createPluginErrorHandler } from "../core/error-standard.js";

const pluginError = createPluginErrorHandler("llm-router");

export const name = "llm-router";
export const version = "1.0.0";
export const description = "Route tasks to specialized LLM providers";

// Provider configurations
const PROVIDERS = {
  openai: {
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    strengths: ["general", "coding", "analysis", "image-generation"],
    costTier: "medium",
    requiresKey: "OPENAI_API_KEY",
  },
  anthropic: {
    name: "Anthropic",
    models: ["claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"],
    strengths: ["reasoning", "coding", "long-context", "analysis"],
    costTier: "high",
    requiresKey: "ANTHROPIC_API_KEY",
  },
  google: {
    name: "Google",
    models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"],
    strengths: ["multilingual", "summarization", "general"],
    costTier: "low",
    requiresKey: "GOOGLE_API_KEY",
  },
  mistral: {
    name: "Mistral",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    strengths: ["cost-effective", "general", "coding"],
    costTier: "low",
    requiresKey: "MISTRAL_API_KEY",
  },
  ollama: {
    name: "Ollama",
    models: ["llama3", "codellama", "mistral", "phi3"],
    strengths: ["local", "privacy", "cost-free"],
    costTier: "free",
    requiresKey: null, // Local, no API key needed
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  },
};

// Task routing rules - Maps task types to optimal providers
const ROUTING_RULES = [
  {
    task: "coding",
    description: "Programming, code generation, debugging",
    primary: { provider: "anthropic", model: "claude-3-opus-20240229" },
    fallback: { provider: "openai", model: "gpt-4o" },
    priority: 1,
  },
  {
    task: "analysis",
    description: "Data analysis, reasoning, complex problem solving",
    primary: { provider: "openai", model: "gpt-4o" },
    fallback: { provider: "anthropic", model: "claude-3-sonnet-20240229" },
    priority: 1,
  },
  {
    task: "documentation",
    description: "Write docs, comments, explanations",
    primary: { provider: "openai", model: "gpt-4o-mini" },
    fallback: { provider: "mistral", model: "mistral-small-latest" },
    priority: 2,
  },
  {
    task: "fast",
    description: "Quick responses, simple queries",
    primary: { provider: "google", model: "gemini-1.5-flash" },
    fallback: { provider: "openai", model: "gpt-4o-mini" },
    priority: 3,
  },
  {
    task: "local",
    description: "Local/self-hosted models via Ollama",
    primary: { provider: "ollama", model: "llama3" },
    fallback: null,
    priority: 3,
  },
  {
    task: "backend_api",
    description: "Backend API development, database schemas, server logic",
    primary: { provider: "anthropic", model: "claude-3-opus-20240229" },
    fallback: { provider: "openai", model: "gpt-4o" },
    priority: 1,
  },
  {
    task: "frontend_component",
    description: "React/Vue components, UI implementation",
    primary: { provider: "openai", model: "gpt-4o" },
    fallback: { provider: "anthropic", model: "claude-3-sonnet-20240229" },
    priority: 1,
  },
  {
    task: "image_generation",
    description: "Generate images, logos, mockups",
    primary: { provider: "openai", model: "dall-e-3" },
    fallback: null,
    priority: 1,
  },
  {
    task: "code_review",
    description: "Review code for bugs, security, best practices",
    primary: { provider: "anthropic", model: "claude-3-sonnet-20240229" },
    fallback: { provider: "openai", model: "gpt-4o" },
    priority: 1,
  },
  {
    task: "debugging",
    description: "Debug errors, analyze stack traces",
    primary: { provider: "anthropic", model: "claude-3-opus-20240229" },
    fallback: { provider: "openai", model: "gpt-4o" },
    priority: 1,
  },
  {
    task: "refactoring",
    description: "Code refactoring, optimization",
    primary: { provider: "anthropic", model: "claude-3-sonnet-20240229" },
    fallback: { provider: "openai", model: "gpt-4o" },
    priority: 2,
  },
  {
    task: "testing",
    description: "Write unit tests, test scenarios",
    primary: { provider: "openai", model: "gpt-4o" },
    fallback: { provider: "anthropic", model: "claude-3-haiku-20240307" },
    priority: 2,
  },
  {
    task: "general",
    description: "General questions, explanations",
    primary: { provider: "openai", model: "gpt-4o-mini" },
    fallback: { provider: "mistral", model: "mistral-small-latest" },
    priority: 3,
  },
  {
    task: "complex_reasoning",
    description: "Complex analysis, architecture decisions",
    primary: { provider: "anthropic", model: "claude-3-opus-20240229" },
    fallback: { provider: "openai", model: "gpt-4o" },
    priority: 1,
  },
  {
    task: "multilingual",
    description: "Tasks requiring non-English language support",
    primary: { provider: "google", model: "gemini-1.5-pro" },
    fallback: { provider: "openai", model: "gpt-4o" },
    priority: 2,
  },
];

// Provider clients cache
const clients = new Map();

/**
 * Get or create provider client
 */
function getClient(provider) {
  if (clients.has(provider)) {
    return clients.get(provider);
  }

  const config = PROVIDERS[provider];
  if (!config) {
    throw pluginError.validation(`Unknown provider: ${provider}`);
  }

  let client;

  if (provider === "openai") {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  } else if (provider === "anthropic") {
    // Anthropic uses fetch API
    client = {
      chat: {
        completions: {
          create: async (params) => {
            const response = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: params.model,
                max_tokens: params.max_tokens || 4096,
                messages: params.messages.map(m => ({
                  role: m.role === "assistant" ? "assistant" : "user",
                  content: m.content,
                })),
              }),
            });
            const data = await response.json();
            return {
              choices: [{
                message: {
                  role: "assistant",
                  content: data.content?.[0]?.text || "",
                },
              }],
            };
          },
        },
      },
    };
  } else if (provider === "google") {
    // Google Gemini API
    client = {
      chat: {
        completions: {
          create: async (params) => {
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: params.messages.map(m => ({
                    role: m.role === "assistant" ? "model" : "user",
                    parts: [{ text: m.content }],
                  })),
                }),
              }
            );
            const data = await response.json();
            return {
              choices: [{
                message: {
                  role: "assistant",
                  content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
                },
              }],
            };
          },
        },
      },
    };
  } else if (provider === "mistral") {
    // Mistral uses OpenAI-compatible API
    client = new OpenAI({
      apiKey: process.env.MISTRAL_API_KEY,
      baseURL: "https://api.mistral.ai/v1",
    });
  } else if (provider === "ollama") {
    // Ollama local API
    client = {
      chat: {
        completions: {
          create: async (params) => {
            const response = await fetch(`${config.baseUrl}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: params.model,
                messages: params.messages,
                stream: false,
              }),
            });
            const data = await response.json();
            return {
              choices: [{
                message: {
                  role: "assistant",
                  content: data.message?.content || "",
                },
              }],
            };
          },
        },
      },
    };
  }

  clients.set(provider, client);
  return client;
}

/**
 * Route a task to the appropriate LLM
 */
export async function routeTask(task, prompt, options = {}) {
  // Find routing rule
  const rule = ROUTING_RULES.find(r => r.task === task) || ROUTING_RULES.find(r => r.task === "general");

  // Determine which provider to use (primary or fallback)
  const useFallback = options.useFallback || false;
  const providerConfig = useFallback && rule.fallback ? rule.fallback : rule.primary;
  const { provider, model } = providerConfig;
  const config = PROVIDERS[provider];

  // Check if provider is available
  if (config.requiresKey && !process.env[config.requiresKey]) {
    // Try fallback if not already using it
    if (!useFallback && rule.fallback) {
      console.log(`[llm-router] Provider ${provider} unavailable (no API key), trying fallback...`);
      return routeTask(task, prompt, { ...options, useFallback: true });
    }
    throw pluginError.validation(`Provider ${provider} requires ${config.requiresKey}`);
  }

  const client = getClient(provider);

  // Special handling for image generation
  if (task === "image_generation") {
    if (provider !== "openai") {
      throw pluginError.validation("Image generation currently only supported with OpenAI provider");
    }
    
    try {
      const result = await withResilience(`llm-${provider}-image`, async () => {
        // Use OpenAI images API
        const response = await client.images.generate({
          model: model || "dall-e-3",
          prompt: prompt,
          n: options.n || 1,
          size: options.size || "1024x1024",
          quality: options.quality || "standard",
        });
        
        return {
          url: response.data?.[0]?.url,
          revised_prompt: response.data?.[0]?.revised_prompt,
        };
      }, {
        circuit: { failureThreshold: 3, resetTimeoutMs: 30000 },
        retry: { maxAttempts: 2, backoffMs: 1000 },
      });

      return {
        content: result.url || result.revised_prompt || "Image generated",
        url: result.url,
        revised_prompt: result.revised_prompt,
        provider,
        model,
        task,
        usedFallback: useFallback,
        type: "image",
      };
    } catch (error) {
      throw error;
    }
  }

  // Call LLM with resilience (for chat/text tasks)
  try {
    const result = await withResilience(`llm-${provider}`, async () => {
      const response = await client.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: getSystemPrompt(task) },
          { role: "user", content: prompt },
        ],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      });

      return response.choices[0].message.content;
    }, {
      circuit: { failureThreshold: 3, resetTimeoutMs: 30000 },
      retry: { maxAttempts: 2, backoffMs: 1000 },
    });

    return {
      content: result,
      provider,
      model,
      task,
      usedFallback: useFallback,
    };
  } catch (error) {
    // If primary fails and fallback exists, try fallback
    if (!useFallback && rule.fallback) {
      console.log(`[llm-router] Provider ${provider} failed: ${error.message}, trying fallback...`);
      return routeTask(task, prompt, { ...options, useFallback: true });
    }
    // No fallback available, re-throw
    throw error;
  }
}

/**
 * Get system prompt for task type
 */
function getSystemPrompt(task) {
  const prompts = {
    backend_api: "You are an expert backend developer. Write clean, efficient, well-documented code following best practices. Include error handling and type safety.",
    frontend_component: "You are an expert frontend developer specializing in React and modern CSS. Write clean, accessible, responsive components with TypeScript.",
    code_review: "You are a senior code reviewer. Focus on bugs, security issues, performance, and best practices. Be specific and constructive.",
    debugging: "You are an expert debugger. Analyze the problem systematically and provide clear, actionable solutions.",
    refactoring: "You are a refactoring expert. Improve code quality, maintainability, and performance while preserving functionality.",
    documentation: "You are a technical writer. Write clear, concise documentation with examples.",
    testing: "You are a testing expert. Write comprehensive tests covering edge cases and happy paths.",
    complex_reasoning: "You are an expert systems architect. Think deeply about trade-offs, scalability, and maintainability.",
    multilingual: "You are a helpful assistant fluent in multiple languages. Adapt to the user's language naturally.",
    general: "You are a helpful AI assistant. Be concise and accurate.",
  };

  return prompts[task] || prompts.general;
}

/**
 * Compare responses from multiple LLMs
 */
export async function compareLLMs(task, prompt, providers = ["openai", "anthropic"]) {
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const config = PROVIDERS[provider];
      if (config.requiresKey && !process.env[config.requiresKey]) {
        return { provider, error: "API key not configured" };
      }

      const startTime = Date.now();
      const result = await routeTask(task, prompt, { targetProvider: provider });
      const duration = Date.now() - startTime;

      return {
        provider,
        model: result.model,
        content: result.content,
        duration,
      };
    })
  );

  return results.map(r =>
    r.status === "fulfilled" ? r.value : { error: r.reason.message }
  );
}

/**
 * List available models
 */
export function listModels() {
  const available = [];

  for (const [key, config] of Object.entries(PROVIDERS)) {
    const isAvailable = !config.requiresKey || process.env[config.requiresKey];
    available.push({
      provider: key,
      name: config.name,
      models: config.models,
      strengths: config.strengths,
      costTier: config.costTier,
      available: isAvailable,
    });
  }

  return available;
}

/**
 * Estimate cost for a task
 */
export function estimateCost(task, promptTokens = 1000, responseTokens = 2000) {
  const pricing = {
    "gpt-4o": { input: 5, output: 15 }, // per 1M tokens
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "claude-3-opus": { input: 15, output: 75 },
    "claude-3-sonnet": { input: 3, output: 15 },
    "claude-3-haiku": { input: 0.25, output: 1.25 },
    "gemini-1.5-pro": { input: 3.5, output: 10.5 },
    "gemini-1.5-flash": { input: 0.35, output: 1.05 },
    "mistral-large": { input: 2, output: 6 },
    "mistral-small": { input: 0.2, output: 0.6 },
  };

  const rule = ROUTING_RULES.find(r => r.task === task);
  if (!rule) return null;

  const model = rule.primary.model;
  const price = pricing[model];
  if (!price) return null;

  const inputCost = (promptTokens / 1000000) * price.input;
  const outputCost = (responseTokens / 1000000) * price.output;

  return {
    model,
    provider: rule.primary.provider,
    estimatedCost: inputCost + outputCost,
    currency: "USD",
    inputTokens: promptTokens,
    outputTokens: responseTokens,
  };
}

// MCP Tools
export const tools = [
  {
    name: "llm_route",
    description: "Route prompts to the best LLM provider based on task type",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          enum: ROUTING_RULES.map(r => r.task),
          description: "Type of task to route (coding, analysis, documentation, fast, local, etc.)",
        },
        prompt: {
          type: "string",
          description: "The prompt to send to the LLM",
        },
        explanation: {
          type: "string",
          description: "Explain why you selected this task type and provider",
        },
        temperature: {
          type: "number",
          description: "Temperature (0-1)",
          default: 0.7,
        },
        maxTokens: {
          type: "number",
          description: "Maximum tokens to generate",
          default: 4096,
        },
      },
      required: ["task", "prompt", "explanation"],
    },
    handler: async ({ task, prompt, explanation, temperature, maxTokens }) => {
      try {
        const result = await routeTask(task, prompt, { temperature, maxTokens });
        return {
          ok: true,
          data: {
            ...result,
            explanation,
            routing_reason: `Selected ${result.provider} (${result.model}) for ${task} task`,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "llm_error",
            message: error.message,
          },
        };
      }
    },
  },
  {
    name: "llm_compare",
    description: "Compare responses from multiple LLM providers",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          enum: ROUTING_RULES.map(r => r.task),
          description: "Type of task",
        },
        prompt: {
          type: "string",
          description: "The prompt to send",
        },
        explanation: {
          type: "string",
          description: "Explain why you want to compare these providers",
        },
        providers: {
          type: "array",
          items: { type: "string" },
          description: "Providers to compare (e.g., ['openai', 'anthropic'])",
          default: ["openai", "anthropic"],
        },
      },
      required: ["task", "prompt", "explanation"],
    },
    handler: async ({ task, prompt, explanation, providers }) => {
      try {
        const results = await compareLLMs(task, prompt, providers);
        return {
          ok: true,
          data: {
            comparison: results,
            explanation,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "comparison_error",
            message: error.message,
          },
        };
      }
    },
  },
  {
    name: "llm_list_models",
    description: "List available LLM models and providers",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: () => {
      return {
        ok: true,
        data: listModels(),
      };
    },
  },
  {
    name: "llm_estimate_cost",
    description: "Estimate cost for a task before running it",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          enum: ROUTING_RULES.map(r => r.task),
          description: "Task type",
        },
        explanation: {
          type: "string",
          description: "Explain why you need this cost estimate",
        },
        promptTokens: {
          type: "number",
          description: "Estimated input tokens",
          default: 1000,
        },
        responseTokens: {
          type: "number",
          description: "Estimated output tokens",
          default: 2000,
        },
      },
      required: ["task", "explanation"],
    },
    handler: ({ task, explanation, promptTokens, responseTokens }) => {
      const estimate = estimateCost(task, promptTokens, responseTokens);
      return {
        ok: true,
        data: {
          ...estimate,
          explanation,
        },
      };
    },
  },
];

// REST API Endpoints
export const endpoints = [
  {
    path: "/llm/route",
    method: "POST",
    handler: async (req, res) => {
      try {
        const result = await routeTask(req.body.task, req.body.prompt, req.body.options);
        res.json({ ok: true, data: result });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  },
  {
    path: "/llm/compare",
    method: "POST",
    handler: async (req, res) => {
      try {
        const results = await compareLLMs(req.body.task, req.body.prompt, req.body.providers);
        res.json({ ok: true, data: results });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  },
  {
    path: "/llm/models",
    method: "GET",
    handler: (req, res) => {
      res.json({ ok: true, data: listModels() });
    },
  },
  {
    path: "/llm/estimate-cost",
    method: "POST",
    handler: (req, res) => {
      const estimate = estimateCost(req.body.task, req.body.promptTokens, req.body.responseTokens);
      res.json({ ok: true, data: estimate });
    },
  },
];

// Plugin registration
export function register(app, dependencies) {
  console.log("[LLM Router] Registered with providers:", listModels().filter(m => m.available).map(m => m.provider).join(", "));
}
