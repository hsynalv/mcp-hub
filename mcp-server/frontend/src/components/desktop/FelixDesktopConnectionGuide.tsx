import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Copy,
  Globe,
  HelpCircle,
  Laptop,
  Router,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/branding";
import { useToast } from "@/providers/ToastProvider";

type GuideStep = {
  title: string;
  body: string;
  code?: string;
};

type PlatformTab = "mac" | "win";
type ConnectionTab = "static" | "tunnel";

function GuideStepCard({
  index,
  step,
  onCopy,
}: {
  index: number;
  step: GuideStep;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3.5">
      <div className="flex gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
          {index}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium">{step.title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{step.body}</p>
          {step.code && (
            <div className="relative rounded-md border border-border/50 bg-background/80 p-2 pr-9">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                {step.code}
              </pre>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-0.5 h-7 w-7"
                onClick={() => onCopy(step.code!, "Komut")}
                aria-label="Kopyala"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const MAC_STATIC_STEPS: GuideStep[] = [
  {
    title: "Kur ve arka planda başlat",
    body: "macOS'ta repo içindeki mcp-server klasöründe:",
    code: "cd mcp-server\npnpm install\nnpm run sidecar:install\nnpm run sidecar:pm2:start",
  },
  {
    title: "Env dosyası",
    body: "Sabit IP ve dışarıdan dinleme. Token'ı eşleştirme sonrası eklersiniz.",
    code: `# ~/.config/felix-desktop/env\nSIDECAR_PORT=9477\nSIDECAR_BIND=0.0.0.0\nSIDECAR_PUBLIC_URL=http://SABIT_IP:9477\nSIDECAR_AUTH_TOKEN=\nFELIX_HUB_URL=https://asistan.huseyinalav.com`,
  },
  {
    title: "Port yönlendirme",
    body: "Modemde dış 9477 → Mac yerel IP (ipconfig getifaddr en0) → iç 9477 TCP.",
  },
  {
    title: "Test ve eşleştir",
    body: "Mobil veriden health kontrolü, ardından bu sayfadaki Yeni eşleşme ile pair.",
    code: "curl http://SABIT_IP:9477/health",
  },
];

const WIN_STATIC_STEPS: GuideStep[] = [
  {
    title: "Kur ve otomatik başlat",
    body: "Windows'ta PowerShell (mcp-server klasöründe):",
    code: "cd mcp-server\npnpm install\nnpm run sidecar:install:win",
  },
  {
    title: "Env dosyası",
    body: "Token eşleştirmeden sonra. Görev: FelixDesktopSidecar (oturum + PC açılışı).",
    code: `# %USERPROFILE%\\.config\\felix-desktop\\env\nSIDECAR_PORT=9477\nSIDECAR_BIND=0.0.0.0\nSIDECAR_PUBLIC_URL=http://SABIT_IP:9477\nSIDECAR_AUTH_TOKEN=\nFELIX_HUB_URL=https://asistan.huseyinalav.com`,
  },
  {
    title: "Firewall",
    body: "Windows Güvenlik Duvarı → Gelen kural: TCP 9477 (Private ağ). Modemde port forward aynı.",
  },
  {
    title: "Test ve eşleştir",
    body: "Health OK ise hub'da pair. Log: %USERPROFILE%\\.config\\felix-desktop\\stderr.log",
    code: "curl http://127.0.0.1:9477/health\nStart-ScheduledTask -TaskName FelixDesktopSidecar",
  },
];

const MAC_TUNNEL_STEPS: GuideStep[] = [
  {
    title: "Daemon",
    body: "Tunnel için SIDECAR_BIND=127.0.0.1 yeterli.",
    code: "npm run sidecar:install\nnpm run sidecar:daemon",
  },
  {
    title: "Tunnel URL",
    body: "İkinci terminalde public HTTPS URL alın.",
    code: "npm run sidecar:tunnel",
  },
  {
    title: "Eşleştir",
    body: "https://….trycloudflare.com adresini Base URL olarak girin. Token'ı env'e yazıp PM2 restart.",
    code: "npm run sidecar:pm2:restart",
  },
];

const WIN_TUNNEL_STEPS: GuideStep[] = [
  {
    title: "Daemon (manuel)",
    body: "Tunnel için SIDECAR_BIND=127.0.0.1. Scheduled Task yerine geçici terminal:",
    code: "npm run sidecar:daemon",
  },
  {
    title: "Tunnel URL",
    body: "İkinci terminalde public HTTPS URL alın.",
    code: "npm run sidecar:tunnel",
  },
  {
    title: "Eşleştir",
    body: "Tunnel URL'yi Base URL olarak girin. Token'ı env'e yazıp görevi yeniden başlatın.",
    code: "Stop-ScheduledTask -TaskName FelixDesktopSidecar\nStart-ScheduledTask -TaskName FelixDesktopSidecar",
  },
];

const FAQ: Record<PlatformTab, { q: string; a: string }[]> = {
  mac: [
    {
      q: "Çevrimiçi ama screenshot yok",
      a: "macOS → Gizlilik → Ekran Kaydı → node (PM2) açın, sidecar restart.",
    },
    {
      q: "Çevrimdışı görünüyor",
      a: "PM2 çalışıyor mu? Port 9477 dışarı açık mı? curl ile health test edin.",
    },
    {
      q: "401 unauthorized",
      a: "SIDECAR_AUTH_TOKEN hub'daki pair token ile aynı olmalı.",
    },
  ],
  win: [
    {
      q: "Görev çalışmıyor",
      a: "Görev Zamanlayıcı → FelixDesktopSidecar → Son çalıştırma. stderr.log kontrol edin.",
    },
    {
      q: "Screenshot / tıklama yok",
      a: "Kullanıcı oturumu açık olmalı. @nut-tree-fork/nut-js kurulu mu? sidecar_dependency_check çalıştırın.",
    },
    {
      q: "401 unauthorized",
      a: "SIDECAR_AUTH_TOKEN hub'daki pair token ile aynı olmalı; env sonrası görevi yeniden başlatın.",
    },
  ],
};

type FelixDesktopConnectionGuideProps = {
  className?: string;
  defaultPlatform?: PlatformTab;
  defaultTab?: ConnectionTab;
  variant?: "panel" | "embedded";
};

export function FelixDesktopConnectionGuide({
  className,
  defaultPlatform = "mac",
  defaultTab = "static",
  variant = "panel",
}: FelixDesktopConnectionGuideProps) {
  const toast = useToast();
  const [platform, setPlatform] = useState<PlatformTab>(defaultPlatform);
  const [tab, setTab] = useState<ConnectionTab>(defaultTab);
  const [faqOpen, setFaqOpen] = useState(false);
  const hubOrigin =
    typeof window !== "undefined" ? window.location.origin : "https://asistan.huseyinalav.com";

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(`${label} kopyalandı`);
    } catch {
      toast.show("Kopyalama başarısız", "error");
    }
  };

  const embedded = variant === "embedded";
  const staticSteps = platform === "mac" ? MAC_STATIC_STEPS : WIN_STATIC_STEPS;
  const tunnelSteps = platform === "mac" ? MAC_TUNNEL_STEPS : WIN_TUNNEL_STEPS;
  const faqItems = FAQ[platform];

  return (
    <div className={cn(!embedded && "rounded-2xl border border-border/80 bg-card/80 shadow-sm", className)}>
      {!embedded && (
        <div className="border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold">Kurulum rehberi</h2>
          <p className="text-xs text-muted-foreground">
            {BRAND.desktopAgentName} ↔ {BRAND.hubName}
          </p>
        </div>
      )}

      <div className={cn(embedded ? "space-y-4" : "px-4 py-4")}>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Hub sunucuda çalışır; dosyalar bilgisayarınızda. Hub&apos;ın sidecar&apos;a ulaşması için{" "}
          <strong className="font-medium text-foreground">sabit IP</strong> (önerilen) veya{" "}
          <strong className="font-medium text-foreground">tunnel</strong> kullanın.
        </p>

        <Tabs value={platform} onValueChange={(v) => setPlatform(v as PlatformTab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="mac" className="gap-1.5 text-xs">
              <Laptop className="h-3.5 w-3.5" />
              macOS
            </TabsTrigger>
            <TabsTrigger value="win" className="gap-1.5 text-xs">
              <Laptop className="h-3.5 w-3.5" />
              Windows
            </TabsTrigger>
          </TabsList>

          <TabsContent value={platform} className="mt-3 space-y-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as ConnectionTab)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="static" className="gap-1.5 text-xs">
                  <Router className="h-3.5 w-3.5" />
                  Sabit IP
                </TabsTrigger>
                <TabsTrigger value="tunnel" className="gap-1.5 text-xs">
                  <Globe className="h-3.5 w-3.5" />
                  Tunnel
                </TabsTrigger>
              </TabsList>

              <TabsContent value="static" className="mt-3 space-y-2.5">
                {staticSteps.map((step, i) => (
                  <GuideStepCard key={step.title} index={i + 1} step={step} onCopy={copyText} />
                ))}
              </TabsContent>

              <TabsContent value="tunnel" className="mt-3 space-y-2.5">
                {tunnelSteps.map((step, i) => (
                  <GuideStepCard key={step.title} index={i + 1} step={step} onCopy={copyText} />
                ))}
              </TabsContent>
            </Tabs>

            <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 px-3 py-2.5 text-xs">
              {platform === "mac" ? (
                <>
                  <p className="font-medium text-violet-200">macOS izinleri</p>
                  <p className="mt-1 text-muted-foreground">
                    Screenshot: Ekran Kaydı → <code className="text-foreground">node</code>. Tıklama/yazma:
                    Erişilebilirlik → <code className="text-foreground">node</code>. Sonra{" "}
                    <code className="text-foreground">npm run sidecar:pm2:restart</code>
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-violet-200">Windows notları</p>
                  <p className="mt-1 text-muted-foreground">
                    Oturum açıkken çalışır (masaüstü otomasyonu). Tam özellik için{" "}
                    <code className="text-foreground">pnpm install</code> ile{" "}
                    <code className="text-foreground">@nut-tree-fork/nut-js</code> kurulu olmalı. Görev:{" "}
                    <code className="text-foreground">FelixDesktopSidecar</code>
                  </p>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setFaqOpen((o) => !o)}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {faqOpen ? "Sorun gidermeyi gizle" : "Sorun giderme"}
          </Button>
          {faqOpen && (
            <div className="mt-2 space-y-2">
              {faqItems.map((item) => (
                <div
                  key={item.q}
                  className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 text-xs"
                >
                  <p className="font-medium">{item.q}</p>
                  <p className="mt-0.5 text-muted-foreground">{item.a}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Hub: <code className="text-foreground">{hubOrigin}</code>
        </p>
      </div>
    </div>
  );
}

export function FelixDesktopChecklist({ ready, platform = "mac" }: { ready: boolean; platform?: PlatformTab }) {
  const items =
    platform === "win"
      ? [
          "Sidecar çalışıyor (Scheduled Task)",
          "Firewall / port forward",
          "Hub'da eşleştirildi",
          "Token env'de kayıtlı",
        ]
      : [
          "Sidecar çalışıyor (PM2)",
          "Port forward veya tunnel",
          "Hub'da eşleştirildi",
          "Token kayıtlı",
        ];

  return (
    <ul className="space-y-1.5">
      {items.map((label) => (
        <li key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
          {ready ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Circle className="h-3.5 w-3.5 opacity-40" />
          )}
          {label}
        </li>
      ))}
    </ul>
  );
}
