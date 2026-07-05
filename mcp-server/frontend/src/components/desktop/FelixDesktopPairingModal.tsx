import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Copy,
  Link2,
  Loader2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiError, apiGet, type WhoamiData } from "@/lib/api-client";
import {
  createSidecarPairingCode,
  fetchSidecarStatus,
  pairSidecarDevice,
} from "@/lib/sidecar-api";
import { FelixDesktopConnectionGuide } from "@/components/desktop/FelixDesktopConnectionGuide";
import { useToast } from "@/providers/ToastProvider";

type ModalView = "pair" | "help";

type FelixDesktopPairingModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialView?: ModalView;
};

export function FelixDesktopPairingModal({
  open,
  onOpenChange,
  initialView = "pair",
}: FelixDesktopPairingModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ModalView>(initialView);

  const isRemoteHub =
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname);

  const [pairCode, setPairCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [baseUrl, setBaseUrl] = useState(isRemoteHub ? "" : "http://127.0.0.1:9477");
  const [generatedCode, setGeneratedCode] = useState<{
    code: string;
    expiresInSec: number;
  } | null>(null);
  const [lastAuthToken, setLastAuthToken] = useState<string | null>(null);

  useEffect(() => {
    if (open) setView(initialView);
  }, [open, initialView]);

  const { data: whoami } = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<WhoamiData>("/whoami"),
    staleTime: 60_000,
    enabled: open,
  });

  const scopes = whoami?.auth?.scopes ?? [];
  const isAdmin = scopes.includes("admin");
  const canPair = scopes.includes("write") || isAdmin;

  const statusQuery = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: fetchSidecarStatus,
    enabled: open,
  });

  const codeMutation = useMutation({
    mutationFn: createSidecarPairingCode,
    onSuccess: (data) => {
      setGeneratedCode({ code: data.code, expiresInSec: data.expiresInSec });
      toast.show("Eşleştirme kodu oluşturuldu");
    },
    onError: (e) =>
      toast.show(e instanceof ApiError ? e.message : "Kod oluşturulamadı", "error"),
  });

  const pairMutation = useMutation({
    mutationFn: pairSidecarDevice,
    onSuccess: (data) => {
      if (data.authToken) setLastAuthToken(data.authToken);
      setPairCode("");
      queryClient.invalidateQueries({ queryKey: ["sidecar-status"] });
      toast.show(`"${data.name}" eşleştirildi`);
    },
    onError: (e) =>
      toast.show(e instanceof ApiError ? e.message : "Eşleştirme başarısız", "error"),
  });

  async function probeSidecarHealth(url: string) {
    try {
      const base = url.replace(/\/$/, "");
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { platform?: string; hostname?: string };
      return { platform: data.platform, hostname: data.hostname };
    } catch {
      return null;
    }
  }

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(`${label} kopyalandı`);
    } catch {
      toast.show("Kopyalama başarısız", "error");
    }
  };

  const sidecarRequired = statusQuery.data?.sidecarRequired ?? isRemoteHub;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,880px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 space-y-0 border-b border-border/60 px-5 py-4 text-left">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle>Yeni eşleştirme</DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                Mac veya Windows sidecar&apos;ı hub ile bağlayın. İlk kurulum için rehbere bakın.
              </DialogDescription>
            </div>
            <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
              <Button
                type="button"
                variant={view === "pair" ? "default" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setView("pair")}
              >
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                Eşleştir
              </Button>
              <Button
                type="button"
                variant={view === "help" ? "default" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setView("help")}
              >
                <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                Kurulum rehberi
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            {view === "help" ? (
              <FelixDesktopConnectionGuide variant="embedded" />
            ) : !sidecarRequired ? (
              <p className="text-sm text-muted-foreground">
                Geliştirme modunda hub bu makinede doğrudan çalışır; uzak eşleştirme gerekmez.
              </p>
            ) : !canPair ? (
              <p className="text-sm text-muted-foreground">
                Eşleştirme için write veya admin yetkisi gerekir.
              </p>
            ) : (
              <div className="space-y-6">
                {isAdmin && (
                  <section className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">1. Eşleştirme kodu</h3>
                      <p className="text-xs text-muted-foreground">
                        Admin olarak tek kullanımlık kod üretin (yaklaşık 5 dk geçerli).
                      </p>
                    </div>
                    <Button
                      onClick={() => codeMutation.mutate()}
                      disabled={codeMutation.isPending}
                      size="sm"
                    >
                      {codeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Kod oluştur
                    </Button>
                    {generatedCode && (
                      <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-mono text-3xl font-bold tracking-[0.2em]">
                            {generatedCode.code}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyText(generatedCode.code, "Kod")}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" />
                            Kopyala
                          </Button>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {generatedCode.expiresInSec} saniye geçerli — aşağıdaki forma girin.
                        </p>
                      </div>
                    )}
                  </section>
                )}

                {!isAdmin && (
                  <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Kod oluşturmak için admin gerekir. Admin&apos;den kod alıp aşağıdaki formu doldurun.
                  </p>
                )}

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {isAdmin ? "2. Cihazı kaydet" : "Cihazı kaydet"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Kod + sidecar adresi (sabit IP:{" "}
                      <code className="rounded bg-muted px-1">http://IP:9477</code> veya tunnel URL).
                      Health&apos;ten platform/hostname otomatik alınır.
                    </p>
                  </div>
                  <form
                    className="space-y-4"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const trimmedUrl = baseUrl.trim();
                      const health = await probeSidecarHealth(trimmedUrl);
                      pairMutation.mutate({
                        code: pairCode.trim(),
                        deviceName:
                          deviceName.trim() ||
                          health?.hostname ||
                          (health?.platform === "win32" ? "windows-pc" : "macbook"),
                        baseUrl: trimmedUrl,
                        platform: health?.platform,
                        hostname: health?.hostname,
                      });
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="modal-pair-code">Kod</Label>
                        <Input
                          id="modal-pair-code"
                          value={pairCode}
                          onChange={(e) => setPairCode(e.target.value)}
                          placeholder="123456"
                          className="font-mono text-lg tracking-widest"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="modal-pair-name">Cihaz adı</Label>
                        <Input
                          id="modal-pair-name"
                          value={deviceName}
                          onChange={(e) => setDeviceName(e.target.value)}
                          placeholder="macbook"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="modal-pair-url">Base URL</Label>
                      <Input
                        id="modal-pair-url"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder={
                          isRemoteHub
                            ? "http://88.248.21.106:9477"
                            : "http://127.0.0.1:9477"
                        }
                        className="font-mono text-sm"
                        required
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={pairMutation.isPending || !pairCode.trim()}>
                        {pairMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Eşleştir
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setView("help")}>
                        <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                        Kurulum rehberi
                      </Button>
                    </div>
                  </form>
                </section>

                {lastAuthToken && (
                  <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">3. Token&apos;ı sidecar makinesine kaydedin</p>
                        <p className="mt-2 break-all font-mono text-xs">{lastAuthToken}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyText(lastAuthToken, "Token")}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" />
                            Kopyala
                          </Button>
                        </div>
                        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted/40 p-2 font-mono text-[11px]">
                          {`# ~/.config/felix-desktop/env (Mac/Linux)\n# %USERPROFILE%\\.config\\felix-desktop\\env (Windows)\nSIDECAR_AUTH_TOKEN=${lastAuthToken}\n# Mac: npm run sidecar:pm2:restart\n# Win: Start-ScheduledTask -TaskName FelixDesktopSidecar`}
                        </pre>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
