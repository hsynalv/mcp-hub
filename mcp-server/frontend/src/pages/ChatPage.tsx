import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, MessagesSquare, PanelRight, Sparkles } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { SidecarDevicePicker } from "@/components/desktop/SidecarDevicePicker";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatComposer, type ChatComposerHandle } from "@/components/chat/ChatComposer";
import { RunTracePanel, dispatchRunStepEvent } from "@/components/chat/RunTracePanel";
import { apiGet, type ChatModelsData, type PluginInfo } from "@/lib/api-client";
import { getConversation, updateConversation } from "@/lib/conversations-api";
import {
  buildSystemPromptFromSettings,
  DEFAULT_CONVERSATION_SETTINGS,
  parseConversationSettings,
  type ConversationSettings,
} from "@/lib/chat-instructions";
import { ChatInstructionsSheet } from "@/components/chat/ChatInstructionsSheet";
import { SpecArtifactPanel } from "@/components/chat/SpecArtifactPanel";
import {
  streamChat,
  submitChatApproval,
  submitWrongIntentFeedback,
  type ApprovalPayload,
  type ChatMessage,
  type ChatStreamMeta,
} from "@/lib/chat-stream";
import { useToast } from "@/providers/ToastProvider";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";
import { useSpeechSynthesis } from "@/lib/use-speech-synthesis";
import { parsePluginSlashMessage } from "@/lib/chat-plugin-slash";
import type { SlashPluginOption } from "@/components/chat/ChatSlashMenu";
import { conversationIdsMatch, normalizeConversationId } from "@/lib/conversation-ids";
import { PREPARE_NAVIGATION_EVENT, releaseRadixBodyLock } from "@/lib/radix-body-lock";
import { MainNavMenuButton } from "@/components/layout/MainNavMenuButton";

let messageIdSeq = 0;
function nextMessageId() {
  return `msg-${++messageIdSeq}`;
}

function mapServerMessages(
  messages: Array<{ id: string; role: string; content: string; metadata?: Record<string, unknown> | null; createdAt?: string }>
) {
  return messages.map((m) => ({
    id: m.id,
    role: m.role as ChatMessage["role"],
    content: m.content,
    toolName: m.metadata?.toolName as string | undefined,
    toolPhase: m.metadata?.toolPhase as "start" | "end" | undefined,
    usage: m.metadata?.usage as ChatMessage["usage"],
    createdAt: m.createdAt,
  }));
}

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlConversationId = searchParams.get("c");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    () => normalizeConversationId(urlConversationId)
  );
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const [messages, setMessages] = useState<Array<ChatMessage & { id: string; createdAt?: string }>>([]);
  const [input, setInput] = useState(() => searchParams.get("prompt") || "");
  const [streaming, setStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [chatSettings, setChatSettings] = useState<ConversationSettings>({
    ...DEFAULT_CONVERSATION_SETTINGS,
  });
  const [approval, setApproval] = useState<ApprovalPayload | null>(null);
  const [turnMeta, setTurnMeta] = useState<ChatStreamMeta | null>(null);
  const [lastTurnUserMessage, setLastTurnUserMessage] = useState<string | null>(null);
  const [intentFeedbackOpen, setIntentFeedbackOpen] = useState(false);
  const [correctIntent, setCorrectIntent] = useState("general");
  const [intentFeedbackBusy, setIntentFeedbackBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(() => searchParams.get("run"));
  const [isDesktopTrace, setIsDesktopTrace] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  const [traceOpen, setTraceOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activePlugin, setActivePlugin] = useState<string | null>(null);
  const [sidebarActiveId, setSidebarActiveId] = useState<string | null>(
    () => normalizeConversationId(searchParams.get("c")) ?? searchParams.get("c")
  );
  const approvalResolve = useRef<((v: boolean) => void) | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const userSelectedConversationRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const tokenRafRef = useRef<number | null>(null);
  const tokenBufferRef = useRef("");
  const activeRunIdRef = useRef<string | null>(searchParams.get("run"));
  const holdLocalMessagesRef = useRef(false);
  const pendingUrlRef = useRef<{ c?: string; run?: string } | null>(null);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const sendRef = useRef<(text?: string) => void>(() => {});
  const qc = useQueryClient();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      const desktop = mq.matches;
      setIsDesktopTrace(desktop);
      if (!desktop) setTraceOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      approvalResolve.current?.(false);
      approvalResolve.current = null;
      if (tokenRafRef.current != null) {
        cancelAnimationFrame(tokenRafRef.current);
        tokenRafRef.current = null;
      }
      releaseRadixBodyLock();
    };
  }, []);

  const closeOverlays = useCallback(() => {
    setTraceOpen(false);
    setSidebarOpen(false);
    setIntentFeedbackOpen(false);
    setApproval(null);
    approvalResolve.current?.(false);
    approvalResolve.current = null;
    releaseRadixBodyLock();
  }, []);

  useEffect(() => {
    const onPrepareNav = () => closeOverlays();
    window.addEventListener(PREPARE_NAVIGATION_EVENT, onPrepareNav);
    return () => window.removeEventListener(PREPARE_NAVIGATION_EVENT, onPrepareNav);
  }, [closeOverlays]);

  useLayoutEffect(() => {
    return () => releaseRadixBodyLock();
  }, []);

  const flushTokenBuffer = useCallback(() => {
    tokenRafRef.current = null;
    const text = tokenBufferRef.current;
    if (!text || !mountedRef.current) return;
    const targetId = assistantIdRef.current;
    if (!targetId) return;
    setMessages((m) =>
      m.map((row) => (row.id === targetId ? { ...row, content: text } : row))
    );
  }, []);

  const scheduleTokenFlush = useCallback(
    (fullText: string) => {
      tokenBufferRef.current = fullText;
      if (tokenRafRef.current != null) return;
      tokenRafRef.current = requestAnimationFrame(flushTokenBuffer);
    },
    [flushTokenBuffer]
  );

  const speech = useSpeechRecognition({
    onInterim: (t) => setInput(t),
    onFinal: (t) => {
      if (t) void sendRef.current(t);
    },
  });
  const tts = useSpeechSynthesis();

  const { data: modelsData, isLoading: modelsLoading, isError: modelsError } = useQuery({
    queryKey: ["chat-models"],
    queryFn: () => apiGet<ChatModelsData>("/ui/chat/models"),
    retry: 1,
  });

  const conversationQuery = useQuery({
    queryKey: ["conversation", activeConversationId],
    queryFn: () => getConversation(activeConversationId!),
    enabled:
      !!activeConversationId &&
      !streaming &&
      modelsData?.persistenceEnabled !== false,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: plugins = [] } = useQuery({
    queryKey: ["plugins"],
    queryFn: () => apiGet<PluginInfo[]>("/plugins"),
    staleTime: 60_000,
  });

  const pluginNames = useMemo(() => plugins.map((p) => p.name.toLowerCase()), [plugins]);
  const slashPlugins: SlashPluginOption[] = useMemo(
    () =>
      plugins.map((p) => ({
        name: p.name,
        description: p.description,
        toolCount: Array.isArray(p.tools) ? p.tools.length : 0,
      })),
    [plugins]
  );

  // URL → state (refresh, back/forward). Sidebar clicks update state first.
  useEffect(() => {
    const fromUrl = normalizeConversationId(searchParams.get("c"));
    setActiveConversationId((current) =>
      conversationIdsMatch(current, fromUrl) ? current : fromUrl
    );
    if (fromUrl) {
      setSidebarActiveId((prev) =>
        prev && conversationIdsMatch(prev, fromUrl) ? prev : fromUrl
      );
    }
  }, [searchParams]);

  const applyConversationData = useCallback(
    (id: string, data: Awaited<ReturnType<typeof getConversation>>) => {
      if (!conversationIdsMatch(activeConversationIdRef.current, id)) return;
      setMessages(mapServerMessages(data.messages ?? []));
      if (data.metadata) {
        setChatSettings(parseConversationSettings(data.metadata));
      }
      userSelectedConversationRef.current = null;
    },
    []
  );

  const loadConversation = useCallback(
    async (id: string) => {
      const normalized = normalizeConversationId(id) ?? id;
      try {
        const data = await qc.fetchQuery({
          queryKey: ["conversation", normalized],
          queryFn: () => getConversation(normalized),
          staleTime: 0,
        });
        applyConversationData(normalized, data);
      } catch (e) {
        if (!conversationIdsMatch(activeConversationIdRef.current, normalized)) return;
        toastRef.current.show(e instanceof Error ? e.message : "Sohbet yüklenemedi", "error");
      }
    },
    [applyConversationData, qc]
  );

  // Populate from query cache (initial load, back/forward).
  useEffect(() => {
    if (!activeConversationId || holdLocalMessagesRef.current || streaming) return;
    const data = conversationQuery.data;
    if (!data || !conversationIdsMatch(data.id, activeConversationId)) return;
    applyConversationData(activeConversationId, data);
  }, [activeConversationId, applyConversationData, conversationQuery.data, streaming]);

  useEffect(() => {
    if (!activeConversationId) {
      setChatSettings({ ...DEFAULT_CONVERSATION_SETTINGS });
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (!conversationQuery.isError || !activeConversationId) return;
    const err = conversationQuery.error;
    toastRef.current.show(err instanceof Error ? err.message : "Sohbet yüklenemedi", "error");
  }, [conversationQuery.isError, conversationQuery.error, activeConversationId]);

  useEffect(() => {
    if (streaming) return;
    const id = window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [streaming]);

  const selectConversation = useCallback(
    (id: string | null) => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      pendingUrlRef.current = null;
      holdLocalMessagesRef.current = false;
      userSelectedConversationRef.current = id;
      setStreaming(false);
      setStreamingMessageId(null);
      setActiveRunId(null);
      activeRunIdRef.current = null;
      setMessages([]);

      if (id) {
        const normalized = normalizeConversationId(id) ?? id;
        setActiveConversationId(normalized);
        setSidebarActiveId(normalized);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("c", normalized);
            next.delete("run");
            return next;
          },
          { replace: true }
        );
        void loadConversation(normalized);
      } else {
        setActiveConversationId(null);
        setSidebarActiveId(null);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("c");
            next.delete("run");
            return next;
          },
          { replace: true }
        );
      }
      setSidebarOpen(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [loadConversation, setSearchParams]
  );

  const applyPendingUrl = useCallback(() => {
    if (!mountedRef.current) return;
    const pending = pendingUrlRef.current;
    if (!pending?.c) return;
    const normalized = normalizeConversationId(pending.c) ?? pending.c;
    setActiveConversationId(normalized);
    setSidebarActiveId(normalized);
    const params: Record<string, string> = { c: normalized };
    if (pending.run) params.run = pending.run;
    setSearchParams(params, { replace: true });
    pendingUrlRef.current = null;
  }, [setSearchParams]);

  const handleSaveSettings = useCallback(
    async (settings: ConversationSettings) => {
      setChatSettings(settings);
      if (activeConversationId && modelsData?.persistenceEnabled !== false) {
        await updateConversation(activeConversationId, { metadata: settings });
        qc.invalidateQueries({ queryKey: ["conversation", activeConversationId] });
      }
    },
    [activeConversationId, modelsData?.persistenceEnabled, qc]
  );

  const effectiveModel =
    customModel.trim() || model || conversationQuery.data?.model || modelsData?.defaultModel || "";

  const waitApproval = useCallback((payload: ApprovalPayload) => {
    return new Promise<boolean>((resolve) => {
      setApproval(payload);
      approvalResolve.current = resolve;
    });
  }, []);

  const handleApproval = async (approved: boolean) => {
    if (!approval) return;
    try {
      await submitChatApproval(approval.approvalId, approved);
      approvalResolve.current?.(approved);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Onay hatası", "error");
      approvalResolve.current?.(false);
    }
    setApproval(null);
    approvalResolve.current = null;
  };

  const send = async (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || streaming) return;

    const { message: msg, pluginFilter } = parsePluginSlashMessage(raw, pluginNames, activePlugin);
    if (!msg) {
      toast.show("Mesaj boş olamaz. /eklenti sonrası bir soru yaz.", "error");
      return;
    }

    setInput("");
    setStreaming(true);
    setTurnMeta(null);
    setLastTurnUserMessage(msg);
    holdLocalMessagesRef.current = true;
    requestAnimationFrame(() => composerRef.current?.focus());

    const turnPlugin = pluginFilter;

    const userId = nextMessageId();
    const assistantId = nextMessageId();
    assistantIdRef.current = assistantId;
    setStreamingMessageId(assistantId);

    setMessages((m) => [
      ...m,
      { id: userId, role: "user", content: msg },
      { id: assistantId, role: "assistant", content: "…" },
    ]);

    let assistantText = "";
    let resolvedConversationId = activeConversationId;

    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    const history = messages
      .filter((x) => x.role === "user" || x.role === "assistant")
      .filter((x) => x.content !== "…")
      .map((x) => ({ role: x.role, content: x.content }));

    try {
      await streamChat(msg, history, effectiveModel || undefined, {
        onMeta: (data) => {
          if (!mountedRef.current) return;
          setTurnMeta({
            toolIntent: data.toolIntent,
            contextStrategy: data.contextStrategy,
            chatProfile: data.chatProfile,
            toolCount: data.toolCount,
            brainContext: data.brainContext,
            projectContext: data.projectContext,
            runId: data.runId,
            conversationId: data.conversationId,
          });
          if (data.conversationId && typeof data.conversationId === "string") {
            resolvedConversationId = data.conversationId;
            const normalized =
              normalizeConversationId(data.conversationId) ?? data.conversationId;
            setActiveConversationId(normalized);
            setSidebarActiveId(normalized);
          }
          const c = activeConversationId || resolvedConversationId || pendingUrlRef.current?.c;
          if (c) {
            pendingUrlRef.current = {
              c,
              run: pendingUrlRef.current?.run,
            };
          }
          if (typeof data.runId === "string") {
            activeRunIdRef.current = data.runId;
            setActiveRunId(data.runId);
            if (pendingUrlRef.current) {
              pendingUrlRef.current.run = data.runId;
            } else if (c) {
              pendingUrlRef.current = { c, run: data.runId };
            }
          }
        },
        onRunStep: (data) => {
          if (typeof data.runId === "string") {
            dispatchRunStepEvent({
              runId: data.runId,
              type: typeof data.type === "string" ? data.type : "tool",
              toolName: typeof data.toolName === "string" ? data.toolName : undefined,
              phase: typeof data.phase === "string" ? data.phase : undefined,
              status: typeof data.status === "string" ? data.status : "pending",
            });
          }
        },
        onToken: (t) => {
          assistantText += t;
          scheduleTokenFlush(assistantText);
        },
        onTool: (data) => {
          if (!mountedRef.current) return;
          const preview =
            data.phase === "start"
              ? `${JSON.stringify(data.arguments || {}, null, 2).slice(0, 500)}`
              : data.summary?.summary ||
                `${JSON.stringify(data.result).slice(0, 600)}`;
          setMessages((m) => [
            ...m,
            {
              id: nextMessageId(),
              role: "tool",
              content: preview,
              toolName: data.name,
              toolPhase: data.phase as "start" | "end",
              toolArguments: data.phase === "start" ? data.arguments : undefined,
              toolSummary: data.phase === "end" ? data.summary : undefined,
            },
          ]);
        },
        onAttachment: (attachment) => {
          if (!mountedRef.current) return;
          const targetId = assistantIdRef.current;
          if (!targetId) return;
          setMessages((m) =>
            m.map((row) =>
              row.id === targetId
                ? { ...row, attachments: [...(row.attachments || []), attachment] }
                : row
            )
          );
        },
        onApproval: async (payload) => {
          setMessages((m) => [
            ...m,
            { id: nextMessageId(), role: "tool", content: `Onay bekleniyor: ${payload.tool}` },
          ]);
          const ok = await waitApproval(payload);
          setMessages((m) => [
            ...m,
            {
              id: nextMessageId(),
              role: "tool",
              content: ok ? `Onaylandı` : `Reddedildi`,
              toolName: payload.tool,
              toolPhase: "end",
            },
          ]);
        },
        onDone: (data) => {
          if (!mountedRef.current) return;
          const targetId = assistantIdRef.current;
          const usage = data.usage as ChatMessage["usage"] | undefined;
          if (targetId && (usage || data.content)) {
            setMessages((m) =>
              m.map((row) =>
                row.id === targetId
                  ? {
                      ...row,
                      content: typeof data.content === "string" ? data.content : row.content,
                      usage: usage ?? row.usage,
                    }
                  : row
              )
            );
          }
          if (resolvedConversationId) {
            qc.invalidateQueries({ queryKey: ["conversations"] });
            const normalized = normalizeConversationId(resolvedConversationId);
            if (normalized) {
              qc.invalidateQueries({ queryKey: ["conversation", normalized] });
            }
          }
        },
        onError: (err) => {
          if (!mountedRef.current) return;
          const targetId = assistantIdRef.current;
          setMessages((m) =>
            m.map((row) => (row.id === targetId ? { ...row, content: `Hata: ${err}` } : row))
          );
        },
      }, {
        conversationId: activeConversationId || undefined,
        autoCreate: !activeConversationId,
        systemPrompt: buildSystemPromptFromSettings(chatSettings),
        includeBrainContext: chatSettings.includeBrainContext !== false,
        responseStyle: chatSettings.responseStyle,
        pluginFilter: turnPlugin,
        sidecarDeviceId: chatSettings.sidecarDeviceId || undefined,
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) return;

      if (!assistantText) {
        const targetId = assistantIdRef.current;
        setMessages((m) =>
          m.map((row) => (row.id === targetId ? { ...row, content: "(boş yanıt)" } : row))
        );
      } else {
        tts.speak(assistantText);
      }
    } catch (e) {
      if (abortController.signal.aborted) return;
      toast.show(e instanceof Error ? e.message : "Chat hatası", "error");
      const targetId = assistantIdRef.current;
      setMessages((m) =>
        m.map((row) =>
          row.id === targetId
            ? { ...row, content: `Hata: ${e instanceof Error ? e.message : "unknown"}` }
            : row
        )
      );
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      if (tokenRafRef.current != null) {
        cancelAnimationFrame(tokenRafRef.current);
        tokenRafRef.current = null;
      }
      tokenBufferRef.current = "";
      if (!mountedRef.current) return;

      if (abortController.signal.aborted) {
        pendingUrlRef.current = null;
      } else if (pendingUrlRef.current?.c) {
        applyPendingUrl();
        if (resolvedConversationId) {
          qc.invalidateQueries({ queryKey: ["conversations"] });
        }
      }

      holdLocalMessagesRef.current = false;

      setStreaming(false);
      setStreamingMessageId(null);
      assistantIdRef.current = null;
      composerRef.current?.focus();
    }
  };

  sendRef.current = send;

  const modelOptions = useMemo(() => {
    const fromApi = modelsData?.selectableModels?.length
      ? modelsData.selectableModels
      : (modelsData?.availableModels ?? modelsData?.models?.filter((m) => m.available) ?? [])
          .flatMap((m) => m.models || [])
          .filter((n, i, arr) => n && arr.indexOf(n) === i);
    const saved = conversationQuery.data?.model;
    const merged = [...fromApi];
    if (saved && !merged.includes(saved)) merged.unshift(saved);
    if (modelsData?.defaultModel && !merged.includes(modelsData.defaultModel)) {
      merged.unshift(modelsData.defaultModel);
    }
    return merged.filter(Boolean);
  }, [modelsData, conversationQuery.data?.model]);

  const selectedModel =
    customModel.trim() ||
    model ||
    conversationQuery.data?.model ||
    modelsData?.defaultModel ||
    modelOptions[0] ||
    "default";

  const conversationTitle =
    conversationIdsMatch(conversationQuery.data?.id, activeConversationId)
      ? conversationQuery.data?.title
      : undefined;

  const toolIntentOptions = useMemo(
    () =>
      modelsData?.toolIntents?.length
        ? modelsData.toolIntents
        : [
            "no_tool",
            "brain_save",
            "brain_recall",
            "project_context",
            "read_repo",
            "modify_files",
            "run_command",
            "external_api",
            "automation",
            "general",
          ],
    [modelsData?.toolIntents]
  );

  const submitIntentFeedback = async () => {
    if (!lastTurnUserMessage || !turnMeta?.toolIntent) return;
    setIntentFeedbackBusy(true);
    try {
      await submitWrongIntentFeedback({
        userMessage: lastTurnUserMessage,
        predictedIntent: turnMeta.toolIntent,
        correctIntent,
        conversationId: turnMeta.conversationId ?? activeConversationId ?? undefined,
        runId: turnMeta.runId,
      });
      toast.show("Intent geri bildirimi kaydedildi");
      setIntentFeedbackOpen(false);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Geri bildirim kaydedilemedi", "error");
    } finally {
      setIntentFeedbackBusy(false);
    }
  };

  const sidebarHighlightId = sidebarActiveId ?? activeConversationId;

  const loadingConversation =
    !!activeConversationId &&
    !streaming &&
    messages.length === 0 &&
    (conversationQuery.isLoading || conversationQuery.isFetching);

  const sidebarProps = {
    activeId: sidebarHighlightId,
    onSelect: (id: string | null) => {
      selectConversation(id);
      setSidebarOpen(false);
    },
    persistenceEnabled: modelsData?.persistenceEnabled,
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        <div className="hidden h-full min-h-0 shrink-0 lg:flex">
          <ChatSidebar {...sidebarProps} />
        </div>

        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <motion.header
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 flex shrink-0 flex-col gap-2 border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur-md sm:gap-3 sm:px-4 sm:py-3"
          >
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <MainNavMenuButton className="md:hidden shrink-0 rounded-xl" />
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1.5 rounded-xl px-2 lg:hidden"
                    title="Sohbet listesi"
                    aria-label="Sohbet listesi"
                  >
                    <MessagesSquare className="h-5 w-5" />
                    <span className="hidden text-xs font-medium sm:inline">Sohbetler</span>
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="z-[60] flex h-full w-[min(20rem,88vw)] flex-col gap-0 border-border/60 p-0 lg:hidden"
                >
                  <SheetHeader className="border-b border-border/60 px-4 py-3 text-left">
                    <SheetTitle className="text-sm font-semibold">Sohbetler</SheetTitle>
                  </SheetHeader>
                  <ChatSidebar {...sidebarProps} embedded className="w-full border-0" />
                </SheetContent>
              </Sheet>

              <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-gradient-to-br from-primary/15 to-accent/10 sm:flex">
                <Bot className="h-5 w-5 text-primary" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-sm font-semibold">
                    {conversationTitle || "Yeni sohbet"}
                  </h1>
                  <AnimatePresence>
                    {streaming && (
                      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                        <Badge variant="success" className="hidden gap-1 text-[10px] sm:inline-flex">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                          </span>
                          Yazıyor
                        </Badge>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  {modelsLoading
                    ? "Modeller yükleniyor…"
                    : modelsError
                      ? "Model listesi alınamadı"
                      : `${modelsData?.provider ?? "—"} · ${modelsData?.toolCount ?? 0} araç`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1 sm:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl"
                  title="Run trace"
                  onClick={() => setTraceOpen((o) => !o)}
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
                <ChatInstructionsSheet
                  settings={chatSettings}
                  persistenceEnabled={modelsData?.persistenceEnabled !== false}
                  onSave={handleSaveSettings}
                  disabled={modelsLoading}
                />
              </div>
            </div>

            {turnMeta && (
              <div className="hidden max-w-full flex-wrap gap-1 sm:flex">
                    {turnMeta.toolIntent && (
                      <Badge variant="default" className="font-mono text-[9px]">
                        Intent: {turnMeta.toolIntent}
                      </Badge>
                    )}
                    {turnMeta.chatProfile && turnMeta.chatProfile !== "balanced" && (
                      <Badge variant="default" className="font-mono text-[9px]">
                        Mod: {turnMeta.chatProfile}
                      </Badge>
                    )}
                    {turnMeta.contextStrategy && turnMeta.contextStrategy.length > 0 && (
                      <Badge variant="default" className="max-w-full truncate font-mono text-[9px]">
                        Context: {turnMeta.contextStrategy.join(", ")}
                      </Badge>
                    )}
                    {turnMeta.toolCount != null && (
                      <Badge variant="default" className="font-mono text-[9px]">
                        {turnMeta.toolCount} tool
                      </Badge>
                    )}
                    {turnMeta.toolIntent && lastTurnUserMessage && !streaming && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-5 px-1.5 text-[9px]"
                        onClick={() => {
                          setCorrectIntent("general");
                          setIntentFeedbackOpen(true);
                        }}
                      >
                        Yanlış intent
                      </Button>
                    )}
              </div>
            )}

            <div className="flex min-w-0 items-center gap-2 overflow-x-auto sm:justify-end">
              <SidecarDevicePicker
                compact
                channel="chat"
                value={chatSettings.sidecarDeviceId ?? null}
                onChange={(deviceId) => {
                  setChatSettings((s) => {
                    const next = { ...s, sidecarDeviceId: deviceId ?? undefined };
                    if (activeConversationId) {
                      void updateConversation(activeConversationId, { metadata: next }).catch(() => {});
                    }
                    return next;
                  });
                }}
              />
              <ProjectSwitcher className="hidden md:flex" />
              <Button
                variant="ghost"
                size="icon"
                className="hidden shrink-0 rounded-xl sm:inline-flex"
                title="Run trace"
                onClick={() => setTraceOpen((o) => !o)}
              >
                <PanelRight className="h-4 w-4" />
              </Button>
              <div className="hidden sm:block">
                <ChatInstructionsSheet
                  settings={chatSettings}
                  persistenceEnabled={modelsData?.persistenceEnabled !== false}
                  onSave={handleSaveSettings}
                  disabled={modelsLoading}
                />
              </div>
              <Select
                value={selectedModel}
                onValueChange={(v) => {
                  setCustomModel("");
                  setModel(v);
                }}
                disabled={modelsLoading || !modelsData}
              >
              <SelectTrigger className="h-9 min-w-0 flex-1 rounded-xl border-border/60 bg-card/60 backdrop-blur-sm sm:w-[min(180px,36vw)] sm:flex-none">
                <Sparkles className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" />
                <SelectValue placeholder="Model seç" />
              </SelectTrigger>
              <SelectContent>
                {(modelOptions.length ? modelOptions : [selectedModel]).map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="hidden h-9 w-[min(140px,30vw)] shrink-0 rounded-xl border-border/60 bg-card/60 md:block"
              placeholder="Özel model"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              disabled={modelsLoading}
              title="Sunucudaki herhangi bir model adını yazabilirsiniz"
            />
            </div>
          </motion.header>

          <AnimatePresence>
            {modelsData?.providerAvailable === false && modelsData.providerHint && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="shrink-0 overflow-hidden px-4 pt-3"
              >
                <Alert variant="warning">
                  <AlertDescription>{modelsData.providerHint}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="shrink-0 px-4 pt-2">
            <SpecArtifactPanel
              settings={chatSettings}
              onSettingsChange={handleSaveSettings}
              disabled={modelsLoading || streaming}
            />
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ChatMessageList
              key={activeConversationId ?? "new-chat"}
              messages={messages}
              streaming={streaming}
              streamingMessageId={streamingMessageId}
              loading={loadingConversation}
              hasConversation={!!activeConversationId}
              runId={activeRunId}
              onExample={send}
              scrollRef={scrollRef}
            />
          </div>

          <ChatComposer
            ref={composerRef}
            input={input}
            streaming={streaming}
            speechSupported={speech.supported}
            speechListening={speech.listening}
            ttsEnabled={tts.enabled}
            ttsSupported={tts.supported}
            plugins={slashPlugins}
            activePlugin={activePlugin}
            onActivePluginChange={setActivePlugin}
            onInputChange={setInput}
            onSend={() => send()}
            onSpeechStart={() => speech.start()}
            onSpeechStop={() => speech.stop()}
            onTtsToggle={tts.toggle}
          />
        </div>

        {traceOpen && (
          <div className="hidden h-full min-h-0 w-72 shrink-0 border-l border-border/60 bg-card/30 lg:flex xl:w-80">
            <RunTracePanel runId={activeRunId} live={streaming} className="w-full" />
          </div>
        )}
      </div>

      <Sheet open={traceOpen && !isDesktopTrace} onOpenChange={setTraceOpen} modal={false}>
        <SheetContent side="right" overlay={false} className="flex h-full w-[min(20rem,90vw)] flex-col border-border/60 p-0 lg:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Run trace</SheetTitle>
          </SheetHeader>
          <RunTracePanel runId={activeRunId} live={streaming} className="w-full" />
        </SheetContent>
      </Sheet>

      <Dialog open={!!approval} onOpenChange={(open) => !open && handleApproval(false)}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          <div className="border-b border-border/60 bg-amber-500/10 px-6 py-4">
            <DialogHeader>
              <DialogTitle>
                {approval?.tool === "brain_remember" ? "Bellek kaydı onayı" : "Araç onayı gerekli"}
              </DialogTitle>
              <DialogDescription>
                {approval?.tool === "brain_remember"
                  ? "Hassas veya kişisel içerik belleğe kaydedilmek isteniyor. Devam etmeden önce içeriği kontrol et."
                  : "Bu işlem politika gereği onayını istiyor. Devam etmeden önce parametreleri kontrol et."}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-3 px-6 py-4">
            {approval?.tool === "brain_remember" && (
              <Badge variant="warning" className="text-[10px]">
                Bellek kaydı
              </Badge>
            )}
            <p className="font-mono text-sm font-medium text-primary">{approval?.tool}</p>
            <pre className="max-h-48 overflow-auto rounded-xl border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed">
              {JSON.stringify(approval?.arguments ?? {}, null, 2)}
            </pre>
          </div>
          <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-4">
            <Button variant="outline" onClick={() => handleApproval(false)}>
              Reddet
            </Button>
            <Button variant="destructive" onClick={() => handleApproval(true)}>
              Onayla ve çalıştır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={intentFeedbackOpen} onOpenChange={setIntentFeedbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Intent düzelt</DialogTitle>
            <DialogDescription>
              Tahmin: <span className="font-mono">{turnMeta?.toolIntent}</span>. Doğru intent&apos;i seçin;
              örnek eğitim korpusuna eklenir.
            </DialogDescription>
          </DialogHeader>
          <Select value={correctIntent} onValueChange={setCorrectIntent}>
            <SelectTrigger>
              <SelectValue placeholder="Intent seç" />
            </SelectTrigger>
            <SelectContent>
              {toolIntentOptions.map((intent) => (
                <SelectItem key={intent} value={intent}>
                  {intent}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIntentFeedbackOpen(false)}>
              İptal
            </Button>
            <Button onClick={() => void submitIntentFeedback()} disabled={intentFeedbackBusy}>
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
