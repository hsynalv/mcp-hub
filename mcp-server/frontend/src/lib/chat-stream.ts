import { getApiKey } from "./auth";
import { apiPost } from "./api-client";
import { getProjectHeaders } from "./workspace-context-store";

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolPhase?: "start" | "end";
  toolArguments?: Record<string, unknown>;
  toolSummary?: {
    ok?: boolean;
    summary?: string;
    keyFacts?: string[];
    truncated?: boolean;
    imageAttached?: boolean;
    rawRef?: { runId?: string; toolName?: string };
  };
  attachments?: ChatImageAttachment[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    iterations?: number;
  };
}

export interface ChatImageAttachment {
  kind: "image";
  toolName?: string;
  mimeType: string;
  dataUrl: string;
  width?: number | null;
  height?: number | null;
  caption?: string;
}

function parseChatImageAttachment(payload: Record<string, unknown>): ChatImageAttachment | null {
  if (
    payload.kind !== "image" ||
    typeof payload.mimeType !== "string" ||
    typeof payload.dataUrl !== "string"
  ) {
    return null;
  }
  return {
    kind: "image",
    mimeType: payload.mimeType,
    dataUrl: payload.dataUrl,
    toolName: typeof payload.toolName === "string" ? payload.toolName : undefined,
    width: typeof payload.width === "number" ? payload.width : payload.width === null ? null : undefined,
    height: typeof payload.height === "number" ? payload.height : payload.height === null ? null : undefined,
    caption: typeof payload.caption === "string" ? payload.caption : undefined,
  };
}

export interface ApprovalPayload {
  approvalId: string;
  tool: string;
  arguments: Record<string, unknown>;
  message?: string;
  memoryWrite?: boolean;
}

export interface ChatStreamMeta {
  provider?: string;
  model?: string;
  toolIntent?: string;
  contextStrategy?: string[];
  chatProfile?: string;
  brainContext?: boolean;
  projectContext?: boolean;
  toolCount?: number;
  conversationId?: string;
  runId?: string;
}

export interface ChatStreamCallbacks {
  onMeta?: (data: ChatStreamMeta) => void;
  onToken?: (text: string) => void;
  onTool?: (data: {
    phase: string;
    name: string;
    arguments?: Record<string, unknown>;
    result?: unknown;
    summary?: ChatMessage["toolSummary"];
  }) => void;
  onAttachment?: (attachment: ChatImageAttachment) => void;
  onRunStep?: (data: Record<string, unknown>) => void;
  onApproval?: (payload: ApprovalPayload) => void | Promise<void>;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

export async function streamChat(
  message: string,
  history: Array<{ role: string; content: string }>,
  model: string | undefined,
  callbacks: ChatStreamCallbacks,
  options?: {
    conversationId?: string;
    autoCreate?: boolean;
    systemPrompt?: string;
    includeBrainContext?: boolean;
    responseStyle?: "concise" | "detailed";
    pluginFilter?: string | null;
    sidecarDeviceId?: string | null;
    signal?: AbortSignal;
  }
): Promise<void> {
  const key = getApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getProjectHeaders(),
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch("/ui/chat", {
    method: "POST",
    credentials: "include",
    headers,
    signal: options?.signal,
    body: JSON.stringify({
      message,
      history,
      model,
      conversationId: options?.conversationId,
      autoCreate: options?.autoCreate ?? true,
      systemPrompt: options?.systemPrompt,
      includeBrainContext: options?.includeBrainContext,
      responseStyle: options?.responseStyle,
      pluginFilter: options?.pluginFilter || undefined,
      sidecarDeviceId: options?.sidecarDeviceId || undefined,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Stream unavailable");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (options?.signal?.aborted) {
      await reader.cancel().catch(() => {});
      break;
    }

    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (!dataLine) continue;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(dataLine) as Record<string, unknown>;
      } catch {
        continue;
      }

      switch (event) {
        case "meta":
          callbacks.onMeta?.(payload as ChatStreamMeta);
          break;
        case "token":
          if (typeof payload.text === "string") callbacks.onToken?.(payload.text);
          break;
        case "tool":
          callbacks.onTool?.(payload as Parameters<NonNullable<ChatStreamCallbacks["onTool"]>>[0]);
          break;
        case "attachment": {
          const attachment = parseChatImageAttachment(payload);
          if (attachment) callbacks.onAttachment?.(attachment);
          break;
        }
        case "run_step":
          callbacks.onRunStep?.(payload);
          break;
        case "approval":
          await callbacks.onApproval?.({
            approvalId: String(payload.approvalId ?? ""),
            tool: String(payload.tool ?? ""),
            arguments: (payload.arguments as Record<string, unknown>) || {},
            message: typeof payload.message === "string" ? payload.message : undefined,
          });
          break;
        case "done":
          callbacks.onDone?.(payload);
          break;
        case "error":
          callbacks.onError?.(typeof payload.message === "string" ? payload.message : "Stream error");
          break;
      }
    }
  }
}

export async function submitChatApproval(approvalId: string, approved: boolean): Promise<void> {
  await apiPost("/ui/chat/approve", { approval_id: approvalId, approved });
}

export async function submitWrongIntentFeedback(body: {
  userMessage: string;
  predictedIntent?: string;
  correctIntent: string;
  conversationId?: string;
  runId?: string;
}) {
  return apiPost<{ ok: boolean; data: { sampleId?: string; skipped?: boolean } }>(
    "/ui/chat/intent-feedback",
    body
  );
}
