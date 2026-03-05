/**
 * Brain Service Plugin (Semantic Kernel-inspired)
 * AI/LLM integration with skills, memory, and task orchestration.
 */

import { Router } from "express";
import { z } from "zod";
import { ToolTags } from "../../core/tool-registry.js";
import { createJob } from "../../core/jobs.js";
import { withRetry, getCircuitBreaker } from "../../core/resilience.js";
import { isRetryableError } from "../../core/error-categories.js";

// ── Configuration ────────────────────────────────────────────────────────────

const LLM_API_KEY = process.env.OPENAI_API_KEY || process.env.BRAIN_LLM_API_KEY || null;
const LLM_BASE_URL = process.env.BRAIN_LLM_URL || "https://api.openai.com/v1";
const DEFAULT_MODEL = process.env.BRAIN_LLM_MODEL || "gpt-4o-mini";

// ── Skills registry ──────────────────────────────────────────────────────────

const skills = new Map();

function registerSkill(name, definition) {
  skills.set(name, {
    name,
    description: definition.description,
    inputs: definition.inputs || [],
    outputs: definition.outputs || [],
    handler: definition.handler,
  });
}

// ── Memory / Context ─────────────────────────────────────────────────────────

const contexts = new Map(); // sessionId → { messages, facts, createdAt }
const facts = new Map(); // key → { value, source, timestamp }

function getOrCreateContext(sessionId) {
  if (!contexts.has(sessionId)) {
    contexts.set(sessionId, {
      messages: [],
      facts: [],
      createdAt: new Date().toISOString(),
    });
  }
  return contexts.get(sessionId);
}

// ── LLM Client ───────────────────────────────────────────────────────────────

const llmCircuit = getCircuitBreaker("openai", {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 1 minute for OpenAI (rate limits)
});

async function callLLM(messages, options = {}) {
  if (!LLM_API_KEY) {
    return { ok: false, error: { code: "llm_not_configured", message: "LLM API key not configured" } };
  }

  return llmCircuit.execute(async () => {
    return withRetry(
      async () => {
        const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LLM_API_KEY}`,
          },
          body: JSON.stringify({
            model: options.model || DEFAULT_MODEL,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 2000,
            ...(options.functions && { functions: options.functions }),
            ...(options.function_call && { function_call: options.function_call }),
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          const error = new Error(err);
          error.status = response.status;
          throw error;
        }

        const data = await response.json();
        return { ok: true, data: data.choices[0] };
      },
      {
        maxAttempts: 3,
        backoffMs: 2000, // 2 second base for rate limits
        retryableError: (err) => {
          // Don't retry auth errors
          if (err.status === 401) return false;
          // Retry rate limits (429) and server errors (5xx)
          if (err.status === 429 || (err.status >= 500 && err.status < 600)) return true;
          return isRetryableError(err);
        },
        onRetry: ({ attempt, error, delay }) => {
          console.error(`[Brain] LLM call attempt ${attempt} failed: ${error.message}. Retrying in ${Math.round(delay)}ms...`);
        },
      }
    );
  }).catch((err) => {
    // Convert circuit/retry errors to our error format
    return {
      ok: false,
      error: {
        code: err.name === "CircuitBreakerError" ? "llm_circuit_open" : "llm_error",
        message: err.message,
        retryable: false,
      },
    };
  });
}

// ── Built-in Skills ──────────────────────────────────────────────────────────

registerSkill("summarize", {
  description: "Summarize text content",
  inputs: ["text", "maxLength"],
  outputs: ["summary"],
  handler: async (inputs) => {
    const messages = [
      { role: "system", content: "You are a helpful summarizer. Create concise summaries." },
      { role: "user", content: `Summarize this in ${inputs.maxLength || 3} sentences:\n\n${inputs.text}` },
    ];
    const result = await callLLM(messages);
    if (!result.ok) return result;
    return { ok: true, data: { summary: result.data.message.content } };
  },
});

registerSkill("classify", {
  description: "Classify text into categories",
  inputs: ["text", "categories"],
  outputs: ["classification", "confidence"],
  handler: async (inputs) => {
    const cats = Array.isArray(inputs.categories) ? inputs.categories.join(", ") : inputs.categories;
    const messages = [
      { role: "system", content: "Classify the user text into exactly one of the provided categories. Respond with only the category name." },
      { role: "user", content: `Categories: ${cats}\n\nText: ${inputs.text}` },
    ];
    const result = await callLLM(messages);
    if (!result.ok) return result;
    return { ok: true, data: { classification: result.data.message.content.trim(), confidence: 0.9 } };
  },
});

registerSkill("extract_entities", {
  description: "Extract named entities from text",
  inputs: ["text"],
  outputs: ["entities"],
  handler: async (inputs) => {
    const messages = [
      { role: "system", content: "Extract named entities (person, organization, location, date, email) from the text. Return JSON array: [{type, value, context}]" },
      { role: "user", content: inputs.text },
    ];
    const result = await callLLM(messages, { temperature: 0.3 });
    if (!result.ok) return result;
    try {
      const entities = JSON.parse(result.data.message.content);
      return { ok: true, data: { entities } };
    } catch {
      return { ok: true, data: { entities: [], raw: result.data.message.content } };
    }
  },
});

registerSkill("ask", {
  description: "Ask a question based on context",
  inputs: ["question", "context"],
  outputs: ["answer"],
  handler: async (inputs) => {
    const messages = [
      { role: "system", content: "Answer the question using only the provided context. If not found, say 'Not in context'." },
      { role: "user", content: `Context:\n${inputs.context || "No context provided"}\n\nQuestion: ${inputs.question}` },
    ];
    const result = await callLLM(messages);
    if (!result.ok) return result;
    return { ok: true, data: { answer: result.data.message.content } };
  },
});

registerSkill("plan", {
  description: "Create a plan to achieve a goal",
  inputs: ["goal", "constraints"],
  outputs: ["steps"],
  handler: async (inputs) => {
    const messages = [
      { role: "system", content: "Create a step-by-step plan to achieve the goal. Return as numbered list." },
      { role: "user", content: `Goal: ${inputs.goal}\n\nConstraints: ${inputs.constraints || "None"}` },
    ];
    const result = await callLLM(messages);
    if (!result.ok) return result;
    const steps = result.data.message.content
      .split("\n")
      .filter(s => s.match(/^\d+\.|^\-/))
      .map(s => s.replace(/^\d+\.\s*|^\-\s*/, ""));
    return { ok: true, data: { steps, raw: result.data.message.content } };
  },
});

// ── Plugin exports ───────────────────────────────────────────────────────────

export const name = "brain";
export const version = "1.0.0";
export const description = "Semantic Kernel-inspired AI service with skills, memory, and task orchestration";
export const capabilities = ["read", "write"];
export const requires = ["OPENAI_API_KEY or BRAIN_LLM_API_KEY"];
export const endpoints = [
  { method: "GET",  path: "/brain/skills",           description: "List available skills",       scope: "read"   },
  { method: "POST", path: "/brain/skills/:name/invoke", description: "Invoke a skill",           scope: "write"  },
  { method: "POST", path: "/brain/chat",             description: "Chat with context",           scope: "write"  },
  { method: "POST", path: "/brain/facts",            description: "Store a fact",                scope: "write"  },
  { method: "GET",  path: "/brain/facts",            description: "Query stored facts",          scope: "read"   },
  { method: "GET",  path: "/brain/contexts/:id",    description: "Get conversation context",    scope: "read"   },
  { method: "POST", path: "/brain/planner",          description: "Create an execution plan",    scope: "write"  },
  { method: "POST", path: "/brain/generate",        description: "Raw LLM generation",          scope: "write"  },
  { method: "GET",  path: "/brain/health",           description: "Plugin health",               scope: "read"   },
];
export const examples = [
  'POST /brain/skills/summarize/invoke  body: {"text":"Long article...","maxLength":3}',
  'POST /brain/chat  body: {"sessionId":"s1","message":"Hello"}',
  'POST /brain/facts  body: {"key":"api_url","value":"https://api.example.com"}',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "brain_invoke_skill",
    description: "Invoke a brain skill (summarize, classify, extract_entities, ask, plan)",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", enum: ["summarize", "classify", "extract_entities", "ask", "plan"], description: "Skill name" },
        inputs: { type: "object", description: "Skill inputs" },
        options: { type: "object", description: "LLM options (model, temperature)" },
      },
      required: ["skill", "inputs"],
    },
    handler: async (args) => {
      const skill = skills.get(args.skill);
      if (!skill) return { ok: false, error: { code: "skill_not_found", message: `Skill '${args.skill}' not found` } };

      // Override LLM settings temporarily if provided
      const originalDefault = DEFAULT_MODEL;
      if (args.options?.model) process.env.BRAIN_LLM_MODEL = args.options.model;

      const result = await skill.handler(args.inputs);

      if (args.options?.model) process.env.BRAIN_LLM_MODEL = originalDefault;
      return result;
    },
  },
  {
    name: "brain_chat",
    description: "Chat with context and memory",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID for context continuity" },
        message: { type: "string", description: "User message" },
        systemPrompt: { type: "string", description: "Custom system prompt" },
      },
      required: ["sessionId", "message"],
    },
    handler: async (args) => {
      const ctx = getOrCreateContext(args.sessionId);
      const messages = [];

      if (args.systemPrompt) {
        messages.push({ role: "system", content: args.systemPrompt });
      } else if (ctx.facts.length > 0) {
        const factContext = ctx.facts.map(f => `${f.key}: ${f.value}`).join("\n");
        messages.push({ role: "system", content: `Facts:\n${factContext}` });
      }

      messages.push(...ctx.messages);
      messages.push({ role: "user", content: args.message });

      const result = await callLLM(messages);
      if (!result.ok) return result;

      const response = result.data.message.content;
      ctx.messages.push({ role: "user", content: args.message });
      ctx.messages.push({ role: "assistant", content: response });

      // Keep only last 20 messages
      if (ctx.messages.length > 20) {
        ctx.messages = ctx.messages.slice(-20);
      }

      return { ok: true, data: { response, sessionId: args.sessionId, turns: ctx.messages.length / 2 } };
    },
  },
  {
    name: "brain_store_fact",
    description: "Store a fact in brain memory",
    tags: [ToolTags.WRITE, ToolTags.LOCAL_FS],
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Fact key" },
        value: { type: "string", description: "Fact value" },
        sessionId: { type: "string", description: "Optional session to associate with" },
      },
      required: ["key", "value"],
    },
    handler: async (args) => {
      facts.set(args.key, {
        value: args.value,
        source: "manual",
        timestamp: new Date().toISOString(),
      });

      if (args.sessionId) {
        const ctx = getOrCreateContext(args.sessionId);
        ctx.facts.push({ key: args.key, value: args.value });
      }

      return { ok: true, data: { stored: args.key } };
    },
  },
  {
    name: "brain_recall_facts",
    description: "Query stored facts by key prefix or pattern",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Key prefix filter" },
      },
    },
    handler: async (args) => {
      const prefix = args.prefix || "";
      const matched = [];
      for (const [key, data] of facts.entries()) {
        if (key.startsWith(prefix)) {
          matched.push({ key, ...data });
        }
      }
      return { ok: true, data: { count: matched.length, facts: matched } };
    },
  },
  {
    name: "brain_list_skills",
    description: "List available brain skills",
    tags: [ToolTags.READ],
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const list = Array.from(skills.values()).map(s => ({
        name: s.name,
        description: s.description,
        inputs: s.inputs,
        outputs: s.outputs,
      }));
      return { ok: true, data: { skills: list } };
    },
  },
  {
    name: "brain_generate",
    description: "Raw LLM text generation",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "User prompt" },
        system: { type: "string", description: "System prompt" },
        model: { type: "string", description: "Model override" },
        temperature: { type: "number", description: "Temperature (0-2)" },
        maxTokens: { type: "number", description: "Max tokens" },
      },
      required: ["prompt"],
    },
    handler: async (args) => {
      const messages = [];
      if (args.system) messages.push({ role: "system", content: args.system });
      messages.push({ role: "user", content: args.prompt });

      const result = await callLLM(messages, {
        model: args.model,
        temperature: args.temperature,
        maxTokens: args.maxTokens,
      });

      if (!result.ok) return result;
      return { ok: true, data: { text: result.data.message.content } };
    },
  },
];

// ── Zod schemas ───────────────────────────────────────────────────────────────

const invokeSkillSchema = z.object({
  inputs: z.record(z.any()),
  options: z.object({ model: z.string().optional(), temperature: z.number().optional() }).optional(),
});

const chatSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  systemPrompt: z.string().optional(),
});

const factSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  sessionId: z.string().optional(),
});

const plannerSchema = z.object({
  goal: z.string().min(1),
  constraints: z.string().optional(),
  async: z.boolean().default(false),
});

const generateSchema = z.object({
  prompt: z.string().min(1),
  system: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  router.get("/health", (_req, res) => {
    const configured = !!LLM_API_KEY;
    res.json({ ok: true, status: configured ? "healthy" : "degraded", plugin: name, version, configured });
  });

  router.get("/skills", (_req, res) => {
    const list = Array.from(skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      inputs: s.inputs,
      outputs: s.outputs,
    }));
    res.json({ ok: true, skills: list });
  });

  router.post("/skills/:name/invoke", async (req, res) => {
    const skill = skills.get(req.params.name);
    if (!skill) return res.status(404).json({ ok: false, error: "skill_not_found" });

    const parsed = invokeSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const result = await skill.handler(parsed.data.inputs);
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.post("/chat", async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { sessionId, message, systemPrompt } = parsed.data;
    const ctx = getOrCreateContext(sessionId);
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    } else if (ctx.facts.length > 0) {
      const factContext = ctx.facts.map(f => `${f.key}: ${f.value}`).join("\n");
      messages.push({ role: "system", content: `Facts:\n${factContext}` });
    }

    messages.push(...ctx.messages);
    messages.push({ role: "user", content: message });

    const result = await callLLM(messages);
    if (!result.ok) return res.status(502).json(result);

    const response = result.data.message.content;
    ctx.messages.push({ role: "user", content: message });
    ctx.messages.push({ role: "assistant", content: response });

    if (ctx.messages.length > 20) {
      ctx.messages = ctx.messages.slice(-20);
    }

    res.json({ ok: true, response, sessionId, turns: Math.floor(ctx.messages.length / 2) });
  });

  router.post("/facts", (req, res) => {
    const parsed = factSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { key, value, sessionId } = parsed.data;
    facts.set(key, {
      value,
      source: "api",
      timestamp: new Date().toISOString(),
    });

    if (sessionId) {
      const ctx = getOrCreateContext(sessionId);
      ctx.facts.push({ key, value });
    }

    res.status(201).json({ ok: true, stored: key });
  });

  router.get("/facts", (req, res) => {
    const { prefix = "" } = req.query;
    const matched = [];
    for (const [key, data] of facts.entries()) {
      if (key.startsWith(prefix)) {
        matched.push({ key, ...data });
      }
    }
    res.json({ ok: true, count: matched.length, facts: matched });
  });

  router.get("/contexts/:id", (req, res) => {
    const ctx = contexts.get(req.params.id);
    if (!ctx) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({
      ok: true,
      context: {
        sessionId: req.params.id,
        messageCount: ctx.messages.length,
        factCount: ctx.facts.length,
        createdAt: ctx.createdAt,
        lastMessages: ctx.messages.slice(-6),
      },
    });
  });

  router.post("/planner", async (req, res) => {
    const parsed = plannerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { goal, constraints, async } = parsed.data;

    if (async) {
      const job = createJob("planner", { goal, constraints });
      res.status(202).json({ ok: true, jobId: job.id, status: "processing" });

      // Async execution
      const skill = skills.get("plan");
      const result = await skill.handler({ goal, constraints });
      job.resolve(result.ok ? { steps: result.data.steps } : result.error);
      return;
    }

    const skill = skills.get("plan");
    const result = await skill.handler({ goal, constraints });
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.post("/generate", async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_request", details: parsed.error.flatten() });
    }

    const { prompt, system, model, temperature, maxTokens } = parsed.data;
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const result = await callLLM(messages, { model, temperature, maxTokens });
    res.status(result.ok ? 200 : 502).json(result.ok ? { ok: true, text: result.data.message.content } : result);
  });

  app.use("/brain", router);
}
