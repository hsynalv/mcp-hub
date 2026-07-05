import {
  Laptop,
  Link2,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/EmptyState";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { SettingsInfoBox, SettingsSectionCard } from "@/components/settings/shared";
import { FelixDesktopChecklist } from "@/components/desktop/FelixDesktopConnectionGuide";
import { ApiError, apiGet, type WhoamiData } from "@/lib/api-client";
import {
  fetchSidecarStatus,
  removeSidecarDevice,
  setSidecarDeviceDefault,
  sidecarModeDescription,
  sidecarStatusLabel,
  sidecarStatusTone,
  type SidecarDevice,
} from "@/lib/sidecar-api";
import { BRAND } from "@/lib/branding";
import { useToast } from "@/providers/ToastProvider";
import { cn, formatTime } from "@/lib/utils";

function platformLabel(platform?: string | null) {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform || "desktop";
}

function DeviceRow({
  device,
  onRemove,
  onSetDefault,
  removing,
  settingDefault,
  canRemove,
}: {
  device: SidecarDevice;
  onRemove: () => void;
  onSetDefault: (channel: "chat" | "telegram" | "default") => void;
  removing: boolean;
  settingDefault: boolean;
  canRemove: boolean;
}) {
  const platform = device.platform || device.health?.platform;
  return (
    <div className="rounded-xl border border-border/80 bg-muted/10 px-4 py-3.5 transition-colors hover:bg-muted/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{device.name}</p>
            <Badge variant="outline" className="text-[10px] font-normal">
              {platformLabel(platform)}
            </Badge>
            <StatusBadge
              status={device.online ? "healthy" : "error"}
              label={device.online ? "Çevrimiçi" : "Çevrimdışı"}
              className="text-[10px]"
            />
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{device.baseUrl}</p>
          <div className="flex flex-wrap gap-1.5">
            {(device.capabilities ?? ["fs"]).map((cap) => (
              <Badge key={cap} variant="default" className="text-[10px] font-normal">
                {cap}
              </Badge>
            ))}
          </div>
          {device.pairedAt && (
            <p className="text-[11px] text-muted-foreground">
              Eşleştirildi: {formatTime(device.pairedAt)}
              {device.lastSeenAt ? ` · Son: ${formatTime(device.lastSeenAt)}` : ""}
            </p>
          )}
          {device.error && !device.online && (
            <p className="text-[11px] text-destructive">{device.error}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={settingDefault}
            onClick={() => onSetDefault("chat")}
          >
            Chat varsayılan
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={settingDefault}
            onClick={() => onSetDefault("telegram")}
          >
            Telegram varsayılan
          </Button>
          {canRemove && (
            <Button
              variant="outline"
              size="sm"
              disabled={removing}
              onClick={onRemove}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Kaldır
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type FelixDesktopPanelProps = {
  onOpenPairing?: (view?: "pair" | "help") => void;
};

export function FelixDesktopPanel({ onOpenPairing }: FelixDesktopPanelProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: whoami } = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<WhoamiData>("/whoami"),
    staleTime: 60_000,
  });

  const isAdmin = (whoami?.auth?.scopes ?? []).includes("admin");

  const statusQuery = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: fetchSidecarStatus,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const removeMutation = useMutation({
    mutationFn: removeSidecarDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sidecar-status"] });
      toast.show("Cihaz kaldırıldı");
    },
    onError: (e) =>
      toast.show(e instanceof ApiError ? e.message : "Cihaz kaldırılamadı", "error"),
  });

  const defaultMutation = useMutation({
    mutationFn: ({ deviceId, channel }: { deviceId: string; channel: "chat" | "telegram" | "default" }) =>
      setSidecarDeviceDefault(deviceId, channel),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["sidecar-preferences"] });
      toast.show(`${vars.channel} varsayılanı ayarlandı`);
    },
    onError: (e) =>
      toast.show(e instanceof ApiError ? e.message : "Varsayılan ayarlanamadı", "error"),
  });

  const status = statusQuery.data;
  const loading = statusQuery.isLoading;
  const notConnected =
    status?.sidecarRequired &&
    status.aggregateStatus !== "connected" &&
    status.aggregateStatus !== "not_required";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      {notConnected && (
        <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-orange-500/5 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <MessageSquareWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-amber-50">Bağlantı yok</p>
                <p className="text-xs leading-relaxed text-amber-100/90">
                  Sohbet ve Telegram&apos;dan Mac dosyalarına erişmek için {BRAND.desktopAgentName}{" "}
                  eşleştirmesi gerekir.
                </p>
              </div>
            </div>
            {onOpenPairing && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => onOpenPairing("pair")}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                Yeni eşleşme
              </Button>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "overflow-hidden rounded-2xl border shadow-sm",
          status?.ready
            ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-card/80 to-card/40"
            : "border-border/80 bg-gradient-to-br from-violet-500/10 via-card/80 to-card/40",
        )}
      >
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                status?.ready ? "bg-emerald-500/20 text-emerald-400" : "bg-violet-500/20 text-violet-400",
              )}
            >
              <Laptop className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{BRAND.desktopAgentName}</h2>
              <p className="text-sm text-muted-foreground">Yerel dosya, terminal, bildirim</p>
              {loading ? (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Durum yükleniyor…
                </p>
              ) : status ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge
                    status={sidecarStatusTone(status.aggregateStatus)}
                    label={sidecarStatusLabel(status.aggregateStatus)}
                  />
                  {status.ready ? (
                    <Badge variant="success">Sohbet için hazır</Badge>
                  ) : (
                    <Badge variant="warning">Kurulum gerekli</Badge>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
            className="shrink-0"
          >
            <RefreshCw className={cn("mr-1.5 h-4 w-4", statusQuery.isFetching && "animate-spin")} />
            Yenile
          </Button>
        </div>

        {status && (
          <div className="grid gap-px border-t border-border/60 bg-border/40 sm:grid-cols-3">
            {[
              { label: "Ortam", value: status.nodeEnv },
              { label: "Cihaz", value: String(status.deviceCount) },
              { label: "Mod", value: status.mode === "direct" ? "Doğrudan" : "Delegation" },
            ].map((item) => (
              <div key={item.label} className="bg-card/80 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 text-sm font-medium capitalize">{item.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {status && status.sidecarRequired && !status.ready && (
        <SettingsSectionCard title="Kontrol listesi" description="Tamamlanması gerekenler">
          <FelixDesktopChecklist ready={!!status.ready} />
          {onOpenPairing && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => onOpenPairing("help")}>
              Kurulum rehberi
            </Button>
          )}
        </SettingsSectionCard>
      )}

      {status && (
        <SettingsInfoBox
          variant={status.sidecarRequired && !status.ready ? "warning" : "tip"}
          title={status.mode === "direct" ? "Geliştirme modu" : "Production"}
        >
          {sidecarModeDescription(status.mode, status.nodeEnv)}
        </SettingsInfoBox>
      )}

      <SettingsSectionCard title="Eşleşmiş cihazlar" description="Hub'ın bağlandığı Mac/PC (Windows desteklenir)">
        {loading ? (
          <div className="flex h-20 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          </div>
        ) : !status?.devices.length ? (
          <EmptyState
            icon={Laptop}
            title={status?.sidecarRequired ? "Henüz cihaz yok" : "Sidecar gerekmez"}
            description={
              status?.sidecarRequired
                ? "Sağ üstten Yeni eşleşme ile Mac'inizi bağlayın."
                : "Geliştirme modunda hub bu makinede doğrudan çalışır."
            }
            action={
              status?.sidecarRequired && onOpenPairing ? (
                <Button size="sm" onClick={() => onOpenPairing("pair")}>
                  <Link2 className="mr-1.5 h-4 w-4" />
                  Yeni eşleşme
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {status.devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                canRemove={isAdmin}
                removing={removeMutation.isPending}
                settingDefault={defaultMutation.isPending}
                onSetDefault={(channel) => defaultMutation.mutate({ deviceId: d.id, channel })}
                onRemove={() => removeMutation.mutate(d.id)}
              />
            ))}
          </div>
        )}
      </SettingsSectionCard>

      {status?.aggregateStatus === "connected" && status.sidecarRequired && (
        <SettingsInfoBox variant="tip" title="macOS izinleri">
          <p className="text-xs leading-relaxed">
            Screenshot için <strong>Ekran Kaydı</strong>, tıklama için <strong>Erişilebilirlik</strong> →{" "}
            <code className="rounded bg-muted px-1">node</code>. İzin sonrası{" "}
            <code className="rounded bg-muted px-1">npm run sidecar:pm2:restart</code>
          </p>
        </SettingsInfoBox>
      )}

      {status?.aggregateStatus === "offline" && status.devices.length > 0 && (
        <SettingsInfoBox variant="warning" title="Hub Mac'e ulaşamıyor">
          <p className="text-xs">
            Cihaz kayıtlı ama çevrimdışı. PM2, port forward veya tunnel kontrol edin.
            {onOpenPairing && (
              <>
                {" "}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenPairing("help")}
                >
                  Rehber
                </button>
              </>
            )}
          </p>
        </SettingsInfoBox>
      )}
    </div>
  );
}

/** @deprecated Use FelixDesktopPanel */
export function SidecarSettingsPanel() {
  return <FelixDesktopPanel />;
}
