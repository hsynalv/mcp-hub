/**
 * Shared chat orchestrator — SSE (ui-chat) and non-SSE (Telegram) entry points
 */

import OpenAI from "openai";
import { listTools, callTool, approveTool } from "./tool-registry.js";
import { ToolTags } from "./tool-registry.js";
import { recordUsageEvent } from "./usage/usage-ledger.service.js";
import { computeCostUsd } from "./usage/usage-pricing.js";
import { mergeUsageTotals, normalizeUsageFromResponse, usageContextFromRequest } from "./usage/usage-context.js";
import { checkQuota } from "./usage/quota.service.js";
import { buildSystemPrompt, buildToolCatalogSummary } from "./chat/chat-system-prompt.js";
import { buildInstructionsBlock } from "./chat/chat-instructions.js";
import { getChatContext } from "./chat/chat-context.js";
import { classifyToolIntentRegex } from "./chat/tool-intent.js";
import { shortlistToolsForIntent } from "./chat/tool-intent.js";
import { guardToolCall, markReadToolUsed, recordToolCallSignature } from "./chat/tool-planning.js";
import {
  createAgentLoopState,
  setAgentLoopPhase,
  getAgentLoopSnapshot,
} from "./chat/agent-loop.js";
import {
  summarizeToolResult,
  formatToolResultForModel,
} from "./chat/tool-result-summarizer.js";
import { resolveChatProfile, applyProfileToToolIntent } from "./chat/chat-profiles.js";
import { resolveEffectiveTenantId } from "./authorization/assert-tenant-boundary.js";
import { buildSidecarDevicesPromptSection } from "./sidecar/sidecar-device-resolver.service.js";
import { shouldDisableChatTools } from "./chat/intent-decision.js";
import { getRequestContext } from "./auth/request-context.js";
import { loadTenantOverlay } from "./auth/tenant-overlay.js";
import { shouldAutoApproveTelegramTool } from "./chat/telegram-auto-approve.js";
import { auditLog } from "./audit/index.js";
import { CHAT_HISTORY_RAW_LIMIT } from "./chat/chat-config.js";
import {
  getLlmKeyMode,
  getProviderApiKey,
  getUnifiedApiKey,
  getChatProviderPreference,
  getResolvedChatProvider,
  getChatDefaultModel,
  isProviderKeyConfigured,
} from "./llm-config.js";
import { getEnvValue } from "./settings/effective-config.js";
import {
  recordApprovalPending,
  recordApprovalResolved,
  recordLlmStep,
  recordToolStep,
} from "./agent-runs/run-orchestrator.js";
import { withToolRetry } from "./agent-runs/tool-retry.js";

export const MAX_TOOL_ITERATIONS = 8;
export const APPROVAL_TIMEOUT_MS = 120_000;

/** Per user-message cap for brain tools (prevents tool loops) */
export const BRAIN_TOOL_CAPS = {
  brain_remember: 1,
  brain_recall: 1,
  brain_get_context: 1,
  brain_what_do_you_know_about: 1,
};

const BRAIN_RECALL_TOOLS = new Set(["brain_recall", "brain_get_context", "brain_what_do_you_know_about"]);

/**
 * Check if a brain tool call should be blocked due to per-turn caps.
 * @param {string} name
 * @param {Record<string, number>} counts
 * @returns {{ blocked: boolean; message?: string }}
 */
export function checkBrainToolCap(name, counts = {}) {
  if (!BRAIN_TOOL_CAPS[name]) return { blocked: false };

  if (BRAIN_RECALL_TOOLS.has(name)) {
    const recallUsed = [...BRAIN_RECALL_TOOLS].some((t) => (counts[t] || 0) >= BRAIN_TOOL_CAPS[t]);
    if (recallUsed) {
      return {
        blocked: true,
        message: "Bu turda zaten bir brain recall aracı çağrıldı; önceki sonucu kullan.",
      };
    }
    return { blocked: false };
  }

  const used = counts[name] || 0;
  if (used >= BRAIN_TOOL_CAPS[name]) {
    return {
      blocked: true,
      message: `Bu turda ${name} zaten çağrıldı; önceki sonucu kullan.`,
    };
  }
  return { blocked: false };
}

export function createBrainToolCounts() {
  return {};
}

export function recordBrainToolCall(name, counts) {
  if (BRAIN_TOOL_CAPS[name]) {
    counts[name] = (counts[name] || 0) + 1;
  }
}

/** @type {Map<string, { resolve: Function, toolName: string, args: object, context: object }>} */
const approvalWaiters = new Map();

export function getOpenAiClient() {
  const pref = getChatProviderPreference();
  const resolved = getResolvedChatProvider();

  if (resolved === "openai" || (pref === "auto" && isProviderKeyConfigured("openai"))) {
    const key = getLlmKeyMode() === "unified" ? getUnifiedApiKey() : getProviderApiKey("openai");
    if (key) return new OpenAI({ apiKey: key });
  }

  if (resolved === "vllm" || (pref === "auto" && isProviderKeyConfigured("vllm"))) {
    const vllmUrl = getEnvValue("VLLM_BASE_URL")?.trim();
    if (vllmUrl) {
      return new OpenAI({
        apiKey: getProviderApiKey("vllm") || "not-needed",
        baseURL: vllmUrl,
      });
    }
  }

  return null;
}

export function getChatProvider() {
  return getResolvedChatProvider();
}

export function getOllamaBaseUrl() {
  return (getEnvValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export function getDefaultModel() {
  return getChatDefaultModel();
}

export async function checkProviderAvailable() {
  const resolved = getResolvedChatProvider();
  if (resolved === "openai" || resolved === "vllm") {
    if (getOpenAiClient()) {
      return { available: true, provider: resolved };
    }
  }
  if (resolved === "ollama") {
    try {
      const res = await fetch(`${getOllamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return { available: res.ok, provider: "ollama" };
    } catch {
      return {
        available: false,
        provider: "ollama",
        hint: "Ollama çalışmıyor. Ollama başlatın veya Ayarlar → LLM bölümünden OpenAI/vLLM yapılandırın.",
      };
    }
  }
  return {
    available: false,
    provider: "none",
    hint: "LLM yapılandırılmamış. Ayarlar → LLM bölümünden anahtar ve atama yapın.",
  };
}

const MAX_CHAT_TOOLS = 128;

const CHAT_TOOL_PRIORITY = new Set([
  "fs_list",
  "fs_read",
  "fs_write",
  "fs_stat",
  "fs_search",
  "fs_recent",
  "desktop_screenshot",
  "desktop_region_screenshot",
  "desktop_window_screenshot",
  "browser_open_url",
  "browser_snapshot",
  "browser_screenshot",
  "desktop_active_window",
  "local_terminal_exec",
  "local_notify",
  "policy_list_rules",
  "policy_evaluate",
  "policy_list_approvals",
  "llm_list_models",
  "llm_list_providers",
  "llm_route",
  "observability_health",
  "observability_metrics",
  "brain_recall",
  "brain_remember",
  "brain_get_context",
  "brain_get_stats",
  "brain_what_do_you_know_about",
  "prompt_list",
  "git_status",
]);

export function selectChatTools(
  allTools,
  { allowWriteTools = true, pluginFilter = null, toolIntent = null, chatProfile = null } = {}
) {
  let tools = allTools;
  if (pluginFilter) {
    const needle = String(pluginFilter).toLowerCase();
    tools = tools.filter((t) => (t.plugin || "").toLowerCase() === needle);
  }

  const profile = chatProfile ? resolveChatProfile(chatProfile) : null;
  const profileAllowsWrite = profile ? profile.allowWriteTools : allowWriteTools;
  if (!profileAllowsWrite || !allowWriteTools) {
    tools = tools.filter((t) => !isWriteToolDef(t));
  }
  if (shouldDisableChatTools(toolIntent, profile?.id || chatProfile)) {
    return [];
  }
  if (toolIntent) {
    tools = shortlistToolsForIntent(tools, toolIntent);
  }
  const priority = [];
  const rest = [];
  for (const tool of tools) {
    if (CHAT_TOOL_PRIORITY.has(tool.name)) priority.push(tool);
    else rest.push(tool);
  }
  const sortedRest = rest.sort((a, b) => {
    const score = (t) => {
      const tags = t.tags || [];
      if (tags.includes(ToolTags.READ_ONLY) || tags.includes("read_only")) return 0;
      if (tags.includes("write") && !tags.includes("destructive")) return 1;
      return 2;
    };
    return score(a) - score(b) || a.name.localeCompare(b.name);
  });
  return [...priority, ...sortedRest].slice(0, MAX_CHAT_TOOLS);
}

export function isWriteToolDef(tool) {
  const tags = tool?.tags || [];
  return (
    tags.includes(ToolTags.WRITE) ||
    tags.includes(ToolTags.DESTRUCTIVE) ||
    tags.includes("write") ||
    tags.includes("destructive")
  );
}

export function isWriteToolName(name) {
  const tool = listTools().find((t) => t.name === name);
  return tool ? isWriteToolDef(tool) : false;
}

export function buildOpenAiTools(options = {}) {
  const selected = selectChatTools(listTools(), options);
  if (!selected.length) return [];
  return selected.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  }));
}

export { buildSystemPrompt, buildToolCatalogSummary } from "./chat/chat-system-prompt.js";

async function waitForApproval(approvalId, toolName, args, context) {
  return new Promise((resolve) => {
    approvalWaiters.set(approvalId, { resolve, toolName, args, context });
    setTimeout(() => {
      if (!approvalWaiters.has(approvalId)) return;
      approvalWaiters.delete(approvalId);
      resolve({
        ok: false,
        error: { code: "approval_timeout", message: "Onay zaman aşımına uğradı (120s)" },
      });
    }, APPROVAL_TIMEOUT_MS);
  });
}

export function getApprovalWaiter(approvalId) {
  return approvalWaiters.get(approvalId);
}

export function deleteApprovalWaiter(approvalId) {
  approvalWaiters.delete(approvalId);
}

async function runToolWithApproval(name, args, context, handlers = {}) {
  const { allowWriteTools = true, onToolCall = () => {}, onApproval = () => {} } = handlers;

  setAgentLoopPhase(context, "act");

  const reqCtx = getRequestContext();
  if (reqCtx?.namespace) {
    await loadTenantOverlay(reqCtx.namespace);
  }

  const brainToolCounts = context.brainToolCounts || {};
  const capCheck = checkBrainToolCap(name, brainToolCounts);
  if (capCheck.blocked) {
    const capped = {
      ok: true,
      data: { capped: true, message: capCheck.message },
    };
    onToolCall({ phase: "start", name, arguments: args, loopPhase: getAgentLoopSnapshot(context).phase });
    onToolCall({ phase: "end", name, result: capped, loopPhase: getAgentLoopSnapshot(context).phase });
    return capped;
  }

  const toolDef = listTools().find((t) => t.name === name);
  if (!context.availableToolNames) {
    context.availableToolNames = listTools().map((t) => t.name);
  }
  const guard = guardToolCall(name, args, context, toolDef);
  if (guard.blocked) {
    if (!context.guardBlocks) context.guardBlocks = [];
    context.guardBlocks.push({ toolName: name, code: guard.code, reason: guard.reason });
    const rejected = {
      ok: false,
      error: { code: guard.code, message: guard.reason },
    };
    onToolCall({ phase: "start", name, arguments: args, loopPhase: getAgentLoopSnapshot(context).phase });
    onToolCall({ phase: "end", name, result: rejected, loopPhase: getAgentLoopSnapshot(context).phase });
    return rejected;
  }
  if (guard.warn) {
    if (!context.guardBlocks) context.guardBlocks = [];
    context.guardBlocks.push({ toolName: name, code: guard.code, reason: guard.reason, warn: true });
    context._guardWarning = guard.reason;
  }

  if (!allowWriteTools && isWriteToolName(name)) {
    const blocked = {
      ok: false,
      error: {
        code: "write_tool_blocked",
        message: `Write tool "${name}" is not allowed in this channel`,
      },
    };
    onToolCall({ phase: "start", name, arguments: args, loopPhase: getAgentLoopSnapshot(context).phase });
    onToolCall({ phase: "end", name, result: blocked, loopPhase: getAgentLoopSnapshot(context).phase });
    return blocked;
  }

  onToolCall({ phase: "start", name, arguments: args, loopPhase: getAgentLoopSnapshot(context).phase });
  const toolStart = Date.now();
  const toolContext = {
    ...context,
    parentCorrelationId: context.parentCorrelationId || context.requestId,
    toolName: name,
    runId: context.runId,
  };

  let result = await withToolRetry(
    async (attempt) => {
      const r = await callTool(name, args, { ...toolContext, retryAttempt: attempt });
      if (r?.status === "approval_required" && r.approval?.id) return r;
      return r;
    },
    { maxAttempts: 3 }
  );

  if (result?.status === "approval_required" && result.approval?.id) {
    if (shouldAutoApproveTelegramTool(context, name)) {
      void auditLog({
        plugin: "notifications",
        operation: "telegram_auto_approved",
        actor: context.actor || "telegram",
        workspaceId: "global",
        allowed: true,
        success: true,
        metadata: { toolName: name, approvalId: result.approval.id, channel: "telegram" },
      }).catch(() => {});
      const approved = await approveTool(result.approval.id, {
        user: context.actor || "telegram:auto",
      });
      result = approved.ok ? (approved.data?.result ?? approved) : approved;
    } else if (!allowWriteTools) {
      const rejected = {
        ok: false,
        error: { code: "approval_required_blocked", message: "Tool approval not available in this channel" },
      };
      onToolCall({ phase: "end", name, result: rejected, loopPhase: getAgentLoopSnapshot(context).phase });
      if (context.runId) {
        void recordToolStep(context.runId, {
          toolName: name,
          input: args,
          output: rejected,
          durationMs: Date.now() - toolStart,
          phase: "end",
        });
      }
      return rejected;
    }
    if (context.runId) {
      void recordApprovalPending(context.runId, {
        approvalId: result.approval.id,
        toolName: name,
        args,
      });
    }
    setAgentLoopPhase(context, "wait");
    onApproval({
      approvalId: result.approval.id,
      tool: name,
      arguments: args,
      message: result.message,
      preview: result.preview,
      runId: context.runId,
    });
    result = await waitForApproval(result.approval.id, name, args, context);
  }

  const summary = summarizeToolResult({ toolName: name, result, runId: context.runId });
  if (context._guardWarning) {
    summary.summary = `[Guard warning: ${context._guardWarning}] ${summary.summary}`;
    delete context._guardWarning;
  }
  result._toolSummary = summary;

  setAgentLoopPhase(context, "reflect");
  onToolCall({
    phase: "end",
    name,
    arguments: args,
    result,
    summary,
    loopPhase: getAgentLoopSnapshot(context).phase,
  });
  if (context.runId) {
    void recordToolStep(context.runId, {
      toolName: name,
      input: args,
      output: result,
      durationMs: Date.now() - toolStart,
      phase: "end",
    });
  }
  recordBrainToolCall(name, brainToolCounts);
  recordToolCallSignature(name, args, context);
  markReadToolUsed(name, toolDef?.tags || [], context);

  return result;
}

async function recordChatUsage(context, { model, provider, usage, iteration, durationMs }) {
  const u = usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const cost = computeCostUsd(model, u.promptTokens, u.completionTokens);
  const base = usageContextFromRequest(context, {
    source: context.source || "chat_ui",
    toolName: "chat_completion",
    operationType: "chat_completion",
  });
  await recordUsageEvent({
    ...base,
    runId: context.runId || null,
    projectId: context.projectId || null,
    provider,
    model,
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
    totalTokens: u.totalTokens,
    estimatedCostUsd: cost,
    durationMs,
    metadata: { iteration, stream: true },
  });
  if (context.runId) {
    void recordLlmStep(context.runId, {
      model,
      provider,
      usage: u,
      durationMs,
      iteration,
    });
  }
  return { ...u, estimatedCostUsd: cost || 0 };
}

async function chatWithOpenAi({ messages, model, tools, context, handlers }) {
  const client = getOpenAiClient();
  if (!client) throw new Error("OPENAI_API_KEY not configured");

  const resolvedModel = model || getDefaultModel();
  const { onDelta = () => {}, maxIterations = MAX_TOOL_ITERATIONS, ...toolHandlers } = handlers;
  if (!context.agentLoop) context.agentLoop = createAgentLoopState();
  let currentMessages = [...messages];
  let iterations = 0;
  const toolCallsLog = [];
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

  while (iterations < maxIterations) {
    iterations++;
    setAgentLoopPhase(context, iterations === 1 ? "plan" : "plan");
    const iterStart = Date.now();
    const stream = await client.chat.completions.create({
      model: resolvedModel,
      messages: currentMessages,
      tools: tools.length ? tools : undefined,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.7,
    });

    let assistantContent = "";
    const toolCallsByIndex = new Map();
    let iterUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for await (const chunk of stream) {
      if (chunk.usage) {
        iterUsage = normalizeUsageFromResponse(chunk, "openai");
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        assistantContent += delta.content;
        onDelta(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsByIndex.has(idx)) {
            toolCallsByIndex.set(idx, { id: tc.id, name: tc.function?.name || "", arguments: "" });
          }
          const entry = toolCallsByIndex.get(idx);
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }
    }

    const recorded = await recordChatUsage(context, {
      model: resolvedModel,
      provider: getChatProvider(),
      usage: iterUsage,
      iteration: iterations,
      durationMs: Date.now() - iterStart,
    });
    totalUsage = mergeUsageTotals(totalUsage, recorded);

    const toolCalls = [...toolCallsByIndex.values()].filter((t) => t.name);
    if (!toolCalls.length) {
      setAgentLoopPhase(context, "stop");
      return {
        text: assistantContent,
        iterations,
        toolCalls: toolCallsLog,
        usage: totalUsage,
        agentLoop: getAgentLoopSnapshot(context),
      };
    }

    currentMessages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.arguments },
      })),
    });

    for (const tc of toolCalls) {
      let args = {};
      try {
        args = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        args = {};
      }

      toolCallsLog.push({ name: tc.name, arguments: args });
      const result = await runToolWithApproval(tc.name, args, context, toolHandlers);
      const summary = result._toolSummary || summarizeToolResult({
        toolName: tc.name,
        result,
        runId: context.runId,
      });
      currentMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: formatToolResultForModel(summary),
      });
    }
    setAgentLoopPhase(context, "reflect");
  }

  setAgentLoopPhase(context, "stop");
  return {
    text: "",
    iterations,
    maxIterations: true,
    toolCalls: toolCallsLog,
    usage: totalUsage,
    agentLoop: getAgentLoopSnapshot(context),
  };
}

async function chatWithOllama({ messages, model, tools, context, handlers }) {
  const baseUrl = getOllamaBaseUrl();
  const resolvedModel = model || getDefaultModel();
  const {
    allowWriteTools = true,
    onDelta = () => {},
    onToolCall,
    onApproval,
    maxIterations = MAX_TOOL_ITERATIONS,
  } = handlers;
  const ollamaTools = tools?.length ? tools : buildOpenAiTools({ allowWriteTools });

  if (!context.agentLoop) context.agentLoop = createAgentLoopState();
  let currentMessages = [...messages];
  let iterations = 0;
  const toolCallsLog = [];
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

  while (iterations < maxIterations) {
    iterations++;
    setAgentLoopPhase(context, "plan");
    const iterStart = Date.now();
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: resolvedModel,
        messages: currentMessages,
        tools: ollamaTools.length ? ollamaTools : undefined,
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
    }

    let msg = { role: "assistant", content: "", tool_calls: [] };
    let iterUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        const delta = chunk.message;
        if (!delta) continue;

        if (delta.content) {
          msg.content += delta.content;
          onDelta(delta.content);
        }
        if (delta.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            const idx = tc.function?.index ?? 0;
            if (!msg.tool_calls[idx]) {
              msg.tool_calls[idx] = {
                function: { name: tc.function?.name || "", arguments: "" },
              };
            }
            if (tc.function?.name) msg.tool_calls[idx].function.name = tc.function.name;
            if (tc.function?.arguments) msg.tool_calls[idx].function.arguments += tc.function.arguments;
          }
        }
        if (chunk.done) {
          iterUsage = normalizeUsageFromResponse(chunk, "ollama");
          break;
        }
      }
    }

    const recorded = await recordChatUsage(context, {
      model: resolvedModel,
      provider: "ollama",
      usage: iterUsage,
      iteration: iterations,
      durationMs: Date.now() - iterStart,
    });
    totalUsage = mergeUsageTotals(totalUsage, recorded);

    msg.tool_calls = (msg.tool_calls || []).filter((t) => t?.function?.name);
    if (!msg.tool_calls.length) {
      setAgentLoopPhase(context, "stop");
      return {
        text: msg.content || "",
        iterations,
        toolCalls: toolCallsLog,
        usage: totalUsage,
        agentLoop: getAgentLoopSnapshot(context),
      };
    }

    currentMessages.push(msg);

    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      let args = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }
      toolCallsLog.push({ name, arguments: args });
      const result = await runToolWithApproval(name, args, context, {
        allowWriteTools,
        onToolCall,
        onApproval,
      });
      const summary = result._toolSummary || summarizeToolResult({
        toolName: name,
        result,
        runId: context.runId,
      });
      currentMessages.push({
        role: "tool",
        content: formatToolResultForModel(summary),
      });
    }
    setAgentLoopPhase(context, "reflect");
  }

  setAgentLoopPhase(context, "stop");
  return {
    text: "",
    iterations,
    maxIterations: true,
    toolCalls: toolCallsLog,
    usage: totalUsage,
    agentLoop: getAgentLoopSnapshot(context),
  };
}

/**
 * Non-SSE chat turn for Telegram and other integrations.
 */
export async function assertChatQuota(projectId) {
  const pid = projectId || "default";
  const result = await checkQuota({ projectId: pid });
  if (!result.allowed) {
    const err = new Error(result.reason || "Project quota exceeded");
    err.code = "quota_exceeded";
    err.quota = result.quota;
    throw err;
  }
  return result;
}

export async function runChatTurn({
  message,
  history = [],
  model,
  systemPrompt,
  includeBrainContext = true,
  projectId,
  context = {},
  allowWriteTools = false,
  onToolCall,
  onApproval,
  chatProfile = "balanced",
  chatMode = null,
  marketplacePackId = null,
  historySummaryBlock = "",
}) {
  if (!message || typeof message !== "string") {
    throw new Error("message string required");
  }

  await assertChatQuota(projectId || context.projectId);

  const chatContext = {
    method: context.method || "CHAT_TURN",
    user: context.user || context.actor || "agent",
    scopes: context.scopes || ["read"],
    projectId: projectId || context.projectId,
    projectEnv: context.projectEnv,
    requestId: context.requestId,
    channel: context.channel || "telegram",
    source: context.source || "telegram",
    conversationId: context.conversationId,
    runId: context.runId || null,
    workspaceId: context.workspaceId ?? "global",
    tenantId: resolveEffectiveTenantId(context),
    brainToolCounts: context.brainToolCounts || createBrainToolCounts(),
    readToolsUsed: false,
    actor: context.actor || null,
    sidecarDeviceId: context.sidecarDeviceId || null,
    personalScope: context.personalScope,
    scope: context.scope,
  };

  const profile = resolveChatProfile(chatProfile);
  const channel = chatContext.channel || "telegram";
  if (
    channel === "telegram" ||
    profile.mode === "desktop" ||
    profile.id === "telegram_assistant" ||
    profile.id === "desktop_assistant"
  ) {
    chatContext.personalScope = true;
    chatContext.scope = "personal";
  }
  const effectiveChatMode = chatMode || context.chatMode || null;
  chatContext.chatMode = effectiveChatMode || profile.mode;
  chatContext.marketplacePackId = marketplacePackId || context.marketplacePackId || null;

  const chatCtx = await getChatContext({
    message,
    projectId: chatContext.projectId,
    conversationId: chatContext.conversationId,
    includeBrainContext,
    hasConversationHistory: history.length > 0,
    chatProfile,
    chatMode: effectiveChatMode,
    historySummaryBlock,
  });
  chatContext.intent = chatCtx.toolIntent;

  const effectiveAllowWrite = allowWriteTools && profile.allowWriteTools;
  const maxIterations = profile.maxIterations ?? MAX_TOOL_ITERATIONS;

  const instructionsBlock = buildInstructionsBlock({}, systemPrompt);
  let telegramDesktopDirective = "";
  if (channel === "telegram") {
    const quickIntent = classifyToolIntentRegex(message);
    if (quickIntent.intent === "desktop_local") {
      telegramDesktopDirective = `## Bu mesaj — Felix Desktop (zorunlu)
Kullanıcı yerel masaüstü / pano / uygulama odak istiyor. **Hemen** uygun aracı çağır:
- Birden fazla cihaz varsa önce **sidecar_list_devices** veya kullanıcıya hangi makine sor; **sidecar_set_active** ile kaydet
- Uygulama öne getir → **desktop_focus_app**
- Pano oku → **clipboard_read** (onay gerekirse Telegram'da Onayla/Reddet gelir)
- Dosya/klasör → **fs_list** / **fs_read**
"Asistanın yetkisi yok" deme; önce aracı dene. sidecar_ambiguous alırsan cihaz seçtir.`;
    }
  }
  const sidecarSection = await buildSidecarDevicesPromptSection(chatContext);
  const systemContent = buildSystemPrompt(
    [
      instructionsBlock,
      chatCtx.contextHints,
      telegramDesktopDirective,
      sidecarSection,
    ]
      .filter(Boolean)
      .join("\n\n"),
    {
      toolCatalog: buildToolCatalogSummary(
        selectChatTools(listTools(), {
          allowWriteTools: effectiveAllowWrite,
          toolIntent: chatCtx.toolIntent,
          chatProfile,
        })
      ),
      channel: chatContext.channel,
      projectId: chatContext.projectId,
      chatProfile,
      chatMode: effectiveChatMode,
      marketplacePackId: context.marketplacePackId || null,
    }
  );

  const messages = [
    { role: "system", content: systemContent },
    ...history.filter((m) => m?.role && m?.content).slice(-CHAT_HISTORY_RAW_LIMIT),
    { role: "user", content: message },
  ];

  const useOpenAi = !!getOpenAiClient();
  if (!useOpenAi) {
    const status = await checkProviderAvailable();
    if (!status.available) {
      throw new Error(status.hint || "LLM provider unavailable");
    }
  }

  const tools = buildOpenAiTools({
    allowWriteTools: effectiveAllowWrite,
    toolIntent: chatCtx.toolIntent,
    chatProfile,
  });
  const handlers = {
    allowWriteTools: effectiveAllowWrite,
    maxIterations,
    onDelta: () => {},
    onToolCall: onToolCall || (() => {}),
    onApproval: onApproval || (() => {}),
  };

  const result = useOpenAi
    ? await chatWithOpenAi({ messages, model, tools, context: chatContext, handlers })
    : await chatWithOllama({ messages, model, context: chatContext, handlers });

  return {
    ...result,
    provider: useOpenAi ? getChatProvider() : "ollama",
    model: model || getDefaultModel(),
  };
}

export async function resolveChatApproval(approvalId, approved) {
  const waiter = approvalWaiters.get(approvalId);
  if (!waiter) return null;

  approvalWaiters.delete(approvalId);

  if (!approved) {
    const { getApprovalStore } = await import("./policy-hooks.js");
    getApprovalStore()?.updateApprovalStatus?.(approvalId, "rejected", "ui");
    if (waiter.context?.runId) {
      void recordApprovalResolved(waiter.context.runId, {
        approvalId,
        approved: false,
        toolName: waiter.toolName,
      });
    }
    waiter.resolve({
      ok: false,
      error: { code: "approval_rejected", message: "Kullanıcı tool çalıştırmayı reddetti" },
    });
    return { status: "rejected" };
  }

  const approveResult = await approveTool(approvalId, { user: "ui" });
  const toolResult = approveResult.ok ? approveResult.data?.result : approveResult;
  if (waiter.context?.runId) {
    void recordApprovalResolved(waiter.context.runId, {
      approvalId,
      approved: true,
      toolName: waiter.toolName,
    });
  }
  waiter.resolve(toolResult || approveResult);
  return { status: "approved", result: toolResult };
}

export { chatWithOpenAi, chatWithOllama, runToolWithApproval };
