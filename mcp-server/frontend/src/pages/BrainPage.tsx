import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Brain,
  Check,
  Download,
  FileJson,
  Layers,
  List,
  Loader2,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
  ThumbsDown,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import { MainNavMenuButton } from "@/components/layout/MainNavMenuButton";
import { MainNavDesktopToggle } from "@/components/layout/MainNavDesktopToggle";
import { EmptyState } from "@/components/layout/EmptyState";
import { BrainGraph, MEMORY_TYPE_COLORS } from "@/components/BrainGraph";
import {
  createMemory,
  deleteMemory,
  fetchBrainProfile,
  fetchBrainStats,
  fetchMemories,
  fetchMemory,
  fetchObsidianStatus,
  fetchProjects,
  recallMemories,
  submitMemoryFeedback,
  syncObsidian,
  pullObsidian,
  downloadObsidianCanvas,
  updateMemory,
  type BrainMemory,
  type MemoryType,
} from "@/lib/brain-api";
import { useToast } from "@/providers/ToastProvider";
import { cn, formatTime } from "@/lib/utils";

const MEMORY_TYPES: MemoryType[] = ["fact", "decision", "preference", "event", "project_note"];

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  fact: "Gerçek",
  decision: "Karar",
  preference: "Tercih",
  event: "Olay",
  project_note: "Proje notu",
};

function FilterChip({
  label,
  count,
  active,
  onClick,
  dotColor,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border/80 bg-muted/20 text-muted-foreground hover:border-primary/30 hover:bg-muted/40 hover:text-foreground"
      )}
    >
      {dotColor && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
      )}
      <span className="max-w-[140px] truncate">{label}</span>
      {count != null && <span className="tabular-nums opacity-80">{count}</span>}
    </button>
  );
}

function MemoryDetailContent({
  selected,
  editing,
  editContent,
  related,
  onEditContent,
  onStartEdit,
  onCancelEdit,
  onSave,
  savePending,
  onDelete,
  deletePending,
  onSelectRelated,
  onFeedbackDone,
}: {
  selected: BrainMemory;
  editing: boolean;
  editContent: string;
  related: BrainMemory[];
  onEditContent: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  savePending: boolean;
  onDelete: () => void;
  deletePending: boolean;
  onSelectRelated: (id: string) => void;
  onFeedbackDone?: () => void;
}) {
  const toast = useToast();
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const runFeedback = async (action: "confirm" | "reject" | "forget") => {
    setFeedbackBusy(true);
    try {
      await submitMemoryFeedback(selected.id, { action });
      toast.show(action === "forget" ? "Bellek unutuldu" : "Geri bildirim kaydedildi");
      onFeedbackDone?.();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Geri bildirim hatası", "error");
    } finally {
      setFeedbackBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-1.5">
        <Badge
          style={{
            backgroundColor: `${MEMORY_TYPE_COLORS[selected.type]}22`,
            color: MEMORY_TYPE_COLORS[selected.type],
          }}
        >
          {MEMORY_TYPE_LABELS[selected.type]}
        </Badge>
        <Badge>Önem {(selected.importance ?? 0).toFixed(2)}</Badge>
        {selected.projectId && <Badge variant="warning">{selected.projectId}</Badge>}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Oluşturulma {formatTime(selected.createdAt)}
        {selected.updatedAt && ` · Güncelleme ${formatTime(selected.updatedAt)}`}
      </p>

      {editing ? (
        <Textarea
          value={editContent}
          onChange={(e) => onEditContent(e.target.value)}
          rows={12}
          className="font-mono text-sm"
        />
      ) : (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown>
        </div>
      )}

      {selected.tags && selected.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.tags.map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
        {!editing && (
          <>
            <Button size="sm" variant="outline" disabled={feedbackBusy} onClick={() => runFeedback("confirm")}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Doğru
            </Button>
            <Button size="sm" variant="outline" disabled={feedbackBusy} onClick={() => runFeedback("reject")}>
              <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
              Yanlış
            </Button>
            <Button size="sm" variant="outline" disabled={feedbackBusy} onClick={() => runFeedback("forget")}>
              Unut
            </Button>
          </>
        )}
        {editing ? (
          <>
            <Button size="sm" onClick={onSave} disabled={savePending}>
              Kaydet
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelEdit}>
              İptal
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onStartEdit}>
              Düzenle
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link
                to={`/chat?prompt=${encodeURIComponent(`Bu bellek hakkında: ${selected.content.slice(0, 200)}`)}`}
              >
                <MessageSquare className="mr-1.5 h-4 w-4" />
                Sohbette sor
              </Link>
            </Button>
            <Button size="sm" variant="destructive" onClick={onDelete} disabled={deletePending}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {related.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">İlgili bellekler</p>
          <ul className="space-y-2">
            {related.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full rounded-lg border border-border/60 p-2 text-left text-xs transition-colors hover:bg-muted/40"
                  onClick={() => onSelectRelated(r.id)}
                >
                  <span
                    className="mb-1 inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: MEMORY_TYPE_COLORS[r.type] }}
                  />
                  <span className="ml-1.5 line-clamp-2 text-foreground">{r.content}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BrainPage() {
  const [search, setSearch] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<MemoryType>("fact");
  const [typeManuallySelected, setTypeManuallySelected] = useState(false);
  const [view, setView] = useState<"list" | "graph">("list");

  const toast = useToast();
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["brain-stats"],
    queryFn: fetchBrainStats,
    staleTime: 60_000,
  });

  const { data: profile } = useQuery({
    queryKey: ["brain-profile"],
    queryFn: fetchBrainProfile,
  });

  const { data: projectsData } = useQuery({
    queryKey: ["brain-projects"],
    queryFn: fetchProjects,
    staleTime: 60_000,
  });

  const { data: obsidian } = useQuery({
    queryKey: ["brain-obsidian"],
    queryFn: fetchObsidianStatus,
  });

  const listQuery = useQuery({
    queryKey: ["brain-memories", typeFilter, tagFilter, projectFilter, semantic ? search : ""],
    queryFn: async () => {
      if (semantic && search.trim()) {
        const data = await recallMemories({
          query: search.trim(),
          type: (typeFilter as MemoryType) || undefined,
          projectId: projectFilter || undefined,
          tags: tagFilter ? [tagFilter] : undefined,
          limit: 50,
        });
        return { total: data.total, memories: data.memories };
      }
      return fetchMemories({
        type: typeFilter || undefined,
        projectId: projectFilter || undefined,
        tags: tagFilter || undefined,
        limit: 100,
      });
    },
  });

  const memories = listQuery.data?.memories ?? [];

  const filteredMemories = useMemo(() => {
    if (semantic || !search.trim()) return memories;
    const q = search.toLowerCase();
    return memories.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [memories, search, semantic]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    memories.forEach((m) => m.tags?.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [memories]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    memories.forEach((m) => m.tags?.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return allTags.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [memories, allTags]);

  const { data: selected } = useQuery({
    queryKey: ["brain-memory", selectedId],
    queryFn: () => fetchMemory(selectedId!),
    enabled: !!selectedId,
  });

  const related = useMemo(() => {
    if (!selected) return [];
    return memories
      .filter(
        (m) =>
          m.id !== selected.id &&
          ((selected.projectId && m.projectId === selected.projectId) ||
            selected.tags?.some((t) => m.tags?.includes(t)))
      )
      .slice(0, 6);
  }, [memories, selected]);

  const saveMutation = useMutation({
    mutationFn: () => updateMemory(selectedId!, { content: editContent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain-memories"] });
      qc.invalidateQueries({ queryKey: ["brain-memory", selectedId] });
      setEditing(false);
      toast.show("Bellek güncellendi");
    },
    onError: (e) => toast.show(e instanceof Error ? e.message : "Hata", "error"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createMemory({
        content: newContent.trim(),
        type: newType,
        tags: tagFilter ? [tagFilter] : [],
        projectId: projectFilter || null,
        skipClassification: typeManuallySelected,
        autoClassify: !typeManuallySelected,
      }),
    onSuccess: (mem) => {
      qc.invalidateQueries({ queryKey: ["brain-memories"] });
      qc.invalidateQueries({ queryKey: ["brain-stats"] });
      setNewOpen(false);
      setNewContent("");
      setNewType("fact");
      setTypeManuallySelected(false);
      setSelectedId(mem.id);
      toast.show("Bellek oluşturuldu");
    },
    onError: (e) => toast.show(e instanceof Error ? e.message : "Hata", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory(selectedId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain-memories"] });
      qc.invalidateQueries({ queryKey: ["brain-stats"] });
      setSelectedId(null);
      toast.show("Bellek silindi");
    },
    onError: (e) => toast.show(e instanceof Error ? e.message : "Hata", "error"),
  });

  const obsidianSync = useMutation({
    mutationFn: syncObsidian,
    onSuccess: (d) => toast.show(`Obsidian senkron: ${d.synced} bellek`),
    onError: (e) => toast.show(e instanceof Error ? e.message : "Sync hatası", "error"),
  });

  const obsidianPull = useMutation({
    mutationFn: pullObsidian,
    onSuccess: (d) => toast.show(`Vault güncellendi: ${d.updated} kayıt`),
    onError: (e) => toast.show(e instanceof Error ? e.message : "Pull hatası", "error"),
  });

  const obsidianCanvas = useMutation({
    mutationFn: downloadObsidianCanvas,
    onSuccess: () => toast.show("Canvas indirildi"),
    onError: (e) => toast.show(e instanceof Error ? e.message : "Canvas hatası", "error"),
  });

  const selectMemory = useCallback((id: string) => {
    setSelectedId(id);
    setEditing(false);
  }, []);

  useEffect(() => {
    if (selected) setEditContent(selected.content);
  }, [selected]);

  const projects = projectsData?.projects ?? [];
  const activeFilters = [typeFilter, tagFilter, projectFilter, search.trim()].filter(Boolean).length;

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("");
    setTagFilter("");
    setProjectFilter("");
    setSemantic(false);
  };

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["brain-memories"] });
    void qc.invalidateQueries({ queryKey: ["brain-stats"] });
    void qc.invalidateQueries({ queryKey: ["brain-projects"] });
    void listQuery.refetch();
  };

  const detailProps = selected
    ? {
        selected,
        editing,
        editContent,
        related,
        onEditContent: setEditContent,
        onStartEdit: () => setEditing(true),
        onCancelEdit: () => setEditing(false),
        onSave: () => saveMutation.mutate(),
        savePending: saveMutation.isPending,
        onDelete: () => deleteMutation.mutate(),
        deletePending: deleteMutation.isPending,
        onSelectRelated: selectMemory,
        onFeedbackDone: () => {
          void qc.invalidateQueries({ queryKey: ["brain-memories"] });
          void qc.invalidateQueries({ queryKey: ["brain-stats"] });
        },
      }
    : null;

  const viewTabs = (
    <Tabs value={view} onValueChange={(v) => setView(v as "list" | "graph")}>
      <TabsList equalWidth>
        <TabsTrigger value="list" className="gap-1.5 text-xs">
          <List className="h-3.5 w-3.5" />
          Liste
        </TabsTrigger>
        <TabsTrigger value="graph" className="gap-1.5 text-xs">
          <Network className="h-3.5 w-3.5" />
          Harita
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <MainNavMenuButton className="md:hidden" showLabel />
      <MainNavDesktopToggle className="hidden md:inline-flex" showLabel />
      <Button variant="outline" size="sm" onClick={refreshAll} disabled={listQuery.isFetching}>
        <RefreshCw className={cn("mr-1.5 h-4 w-4", listQuery.isFetching && "animate-spin")} />
        Yenile
      </Button>
      {obsidian?.enabled && (
        <>
          <Button variant="outline" size="sm" disabled={obsidianPull.isPending} onClick={() => obsidianPull.mutate()}>
            {obsidianPull.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
            Vault çek
          </Button>
          <Button variant="outline" size="sm" disabled={obsidianCanvas.isPending} onClick={() => obsidianCanvas.mutate()}>
            {obsidianCanvas.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="mr-1 h-4 w-4" />}
            Canvas
          </Button>
          <Button variant="outline" size="sm" disabled={obsidianSync.isPending} onClick={() => obsidianSync.mutate()}>
            {obsidianSync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Hub gönder
          </Button>
        </>
      )}
      <Button size="sm" onClick={() => setNewOpen(true)}>
        <Plus className="mr-1 h-4 w-4" />
        Yeni bellek
      </Button>
    </div>
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col",
        view === "graph" ? "gap-0 overflow-hidden" : "overflow-hidden"
      )}
    >
      {view === "list" ? (
        <>
          <div className="mx-auto w-full max-w-7xl shrink-0 px-4 pt-4 md:px-6">
            <PageHeader
              title="Brain Bellek"
              description="Proje bilgilerinizi, kararlarınızı ve notlarınızı tek yerde tutun. Liste veya bilgi haritası ile keşfedin."
              actions={headerActions}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pb-6 md:px-6">
              <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Toplam bellek", value: stats?.total ?? "—", icon: Brain, hint: "Kayıtlı anı" },
          { label: "Proje", value: projects.length, icon: Layers, hint: "Bağlı proje" },
          { label: "Etiket", value: allTags.length, icon: Tags, hint: "Farklı etiket" },
          {
            label: "Profil",
            value: profile && Object.keys(profile).length > 0 ? "Aktif" : "Boş",
            icon: Sparkles,
            hint: obsidian?.enabled ? "Obsidian bağlı" : "Yerel bellek",
          },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <s.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-[11px] text-muted-foreground">{s.hint}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
              </div>

      <Card className="min-w-0 shrink-0 overflow-hidden">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Bellek içeriği veya etiket ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant={semantic ? "default" : "outline"}
                size="sm"
                onClick={() => setSemantic((s) => !s)}
                title="Anlamsal arama"
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                Akıllı arama
              </Button>
              {viewTabs}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Bellek türü</p>
            <div className="scrollbar-chip-row flex gap-2 overflow-x-auto pb-1">
              <div className="flex w-max flex-nowrap gap-2 pr-2">
                <FilterChip
                  label="Tümü"
                  count={memories.length}
                  active={!typeFilter}
                  onClick={() => setTypeFilter("")}
                />
                {MEMORY_TYPES.map((type) => (
                  <FilterChip
                    key={type}
                    label={MEMORY_TYPE_LABELS[type]}
                    count={stats?.byType?.[type]}
                    active={typeFilter === type}
                    dotColor={MEMORY_TYPE_COLORS[type]}
                    onClick={() => setTypeFilter(typeFilter === type ? "" : type)}
                  />
                ))}
              </div>
            </div>
          </div>

          {projects.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Proje</p>
              <div className="scrollbar-chip-row flex gap-2 overflow-x-auto pb-1">
                <div className="flex w-max flex-nowrap gap-2 pr-2">
                  <FilterChip
                    label="Tüm projeler"
                    active={!projectFilter}
                    onClick={() => setProjectFilter("")}
                  />
                  {projects.map((p) => {
                    const slug = p.slug || p.name;
                    return (
                      <FilterChip
                        key={slug}
                        label={p.name}
                        count={stats?.byProject?.[slug]}
                        active={projectFilter === slug}
                        onClick={() => setProjectFilter(projectFilter === slug ? "" : slug)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tagCounts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Etiket</p>
                {activeFilters > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearFilters}>
                    Filtreleri temizle
                  </Button>
                )}
              </div>
              <div className="scrollbar-chip-row flex gap-2 overflow-x-auto pb-1">
                <div className="flex w-max flex-nowrap gap-2 pr-2">
                  <FilterChip label="Tüm etiketler" active={!tagFilter} onClick={() => setTagFilter("")} />
                  {tagCounts.map(({ name, count }) => (
                    <FilterChip
                      key={name}
                      label={`#${name}`}
                      count={count}
                      active={tagFilter === name}
                      onClick={() => setTagFilter(tagFilter === name ? "" : name)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {semantic && (
            <p className="text-xs text-muted-foreground">
              Akıllı arama: anlamına göre en yakın bellekler getirilir.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid min-h-[min(50vh,520px)] shrink-0 gap-4 lg:min-h-[min(70vh,640px)] lg:grid-cols-5">
        <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden lg:col-span-3">
          <CardHeader className="shrink-0 border-b border-border/60 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <List className="h-4 w-4 text-primary" />
              Bellek listesi
              <span className="font-normal text-muted-foreground">({filteredMemories.length})</span>
            </CardTitle>
          </CardHeader>

            <ScrollArea className="min-h-0 flex-1">
              {listQuery.isLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
                  ))}
                </div>
              ) : filteredMemories.length === 0 ? (
                <EmptyState
                  icon={Brain}
                  title="Bellek bulunamadı"
                  description="Yeni bir bellek ekleyin veya filtreleri genişletin."
                  action={
                    <Button size="sm" onClick={() => setNewOpen(true)}>
                      <Plus className="mr-1 h-4 w-4" />
                      İlk belleği ekle
                    </Button>
                  }
                  className="py-16"
                />
              ) : (
                <ul className="divide-y divide-border/60 p-2">
                  {filteredMemories.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => selectMemory(m.id)}
                        className={cn(
                          "w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/40",
                          selectedId === m.id && "bg-primary/10 ring-1 ring-inset ring-primary/25"
                        )}
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge
                            style={{
                              backgroundColor: `${MEMORY_TYPE_COLORS[m.type]}22`,
                              color: MEMORY_TYPE_COLORS[m.type],
                            }}
                          >
                            {MEMORY_TYPE_LABELS[m.type]}
                          </Badge>
                          {m.projectId && <Badge variant="warning">{m.projectId}</Badge>}
                          {semantic && m.score != null && (
                            <Badge variant="success">%{Math.round(m.score * 100)}</Badge>
                          )}
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {formatTime(m.createdAt)}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-sm leading-relaxed">{m.content}</p>
                        {m.tags && m.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {m.tags.slice(0, 5).map((t) => (
                              <span key={t} className="text-[10px] text-muted-foreground">
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
        </Card>

        <Card className="hidden min-h-0 min-w-0 flex-col overflow-hidden lg:col-span-2 lg:flex">
          <CardHeader className="shrink-0 border-b border-border/60 py-3">
            <CardTitle className="text-sm font-medium">Bellek detayı</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            {!selected ? (
              <EmptyState
                icon={Brain}
                title="Bir bellek seçin"
                description="Listeden bir belleğe tıklayarak içeriğini görüntüleyin."
                className="py-16"
              />
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                {detailProps && <MemoryDetailContent {...detailProps} />}
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0 lg:hidden">
          <SheetHeader className="shrink-0 border-b border-border/60 px-4 py-3 text-left">
            <SheetTitle className="text-sm font-medium">Bellek detayı</SheetTitle>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            {detailProps ? <MemoryDetailContent {...detailProps} /> : null}
          </ScrollArea>
        </SheetContent>
      </Sheet>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-card/80 px-3 py-2 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2">
              <MainNavMenuButton className="md:hidden shrink-0" />
              <MainNavDesktopToggle className="hidden shrink-0 md:inline-flex" />
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Network className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Bilgi haritası</p>
                <p className="text-[11px] text-muted-foreground">{filteredMemories.length} bellek</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {viewTabs}
              {headerActions}
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-b border-border/60 bg-card/40 px-3 py-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Ara…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-9 text-sm"
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant={semantic ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() => setSemantic((s) => !s)}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Akıllı
                </Button>
                {activeFilters > 0 && (
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearFilters}>
                    Temizle
                  </Button>
                )}
              </div>
            </div>
            <div className="scrollbar-chip-row flex gap-2 overflow-x-auto pb-0.5">
              <div className="flex w-max flex-nowrap gap-1.5 pr-2">
                <FilterChip label="Tümü" count={memories.length} active={!typeFilter} onClick={() => setTypeFilter("")} />
                {MEMORY_TYPES.map((type) => (
                  <FilterChip
                    key={type}
                    label={MEMORY_TYPE_LABELS[type]}
                    active={typeFilter === type}
                    dotColor={MEMORY_TYPE_COLORS[type]}
                    onClick={() => setTypeFilter(typeFilter === type ? "" : type)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            <BrainGraph
              className="h-full min-h-0 rounded-none border-0"
              memories={filteredMemories}
              projects={projects}
              selectedId={selectedId}
              onSelect={selectMemory}
            />

            <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
              <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md">
                <SheetHeader className="shrink-0 border-b border-border/60 px-4 py-3 text-left">
                  <SheetTitle className="text-sm font-medium">Bellek detayı</SheetTitle>
                </SheetHeader>
                <ScrollArea className="min-h-0 flex-1">
                  {detailProps ? <MemoryDetailContent {...detailProps} /> : null}
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </>
      )}

      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          setNewOpen(open);
          if (open) {
            setNewType("fact");
            setTypeManuallySelected(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Yeni bellek</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tür</Label>
              <div className="flex flex-wrap gap-2">
                {MEMORY_TYPES.map((type) => (
                  <FilterChip
                    key={type}
                    label={MEMORY_TYPE_LABELS[type]}
                    active={newType === type}
                    dotColor={MEMORY_TYPE_COLORS[type]}
                    onClick={() => {
                      setNewType(type);
                      setTypeManuallySelected(true);
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>İçerik</Label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={8}
                placeholder="Markdown desteklenir. Kararlar, notlar, tercihler…"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => createMutation.mutate()}
              disabled={!newContent.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Bellek oluştur
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
