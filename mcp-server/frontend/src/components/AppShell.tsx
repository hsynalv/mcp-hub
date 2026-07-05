import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  LogOut,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Sun,
  X,
  PanelLeftClose,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { dispatchPrepareNavigation } from "@/lib/radix-body-lock";
import { apiGet, type HealthData, type WhoamiData } from "@/lib/api-client";
import { fetchIntentTrainingStatus } from "@/lib/intent-training-api";
import { useTheme } from "@/providers/ThemeProvider";
import { useAuth } from "@/providers/AuthProvider";
import { logout } from "@/lib/auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { JarvisOverlay } from "@/components/jarvis/JarvisOverlay";
import { APP_ROUTE_TITLES, IMMERSIVE_APP_PATHS } from "@/components/layout/app-navigation";
import { AppNavBrand, AppNavItems } from "@/components/layout/AppNavItems";
import { AppShellNavContext } from "@/components/layout/AppShellNavContext";
import { MainNavMenuButton } from "@/components/layout/MainNavMenuButton";
import { MainNavDesktopToggle } from "@/components/layout/MainNavDesktopToggle";
import { AppFooter } from "@/components/layout/AppFooter";
import { BRAND } from "@/lib/branding";
import {
  defaultMainNavExpandedForPath,
  persistMainNavExpanded,
} from "@/lib/main-nav-preference";

function PageLoader() {
  return (
    <div className="flex h-40 items-center justify-center text-muted-foreground">
      Yükleniyor…
    </div>
  );
}

function RoutedPage({ fullBleed }: { fullBleed: boolean }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", fullBleed ? "h-full overflow-hidden" : "")}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </div>
  );
}

export function AppShell() {
  const [mainNavOpen, setMainNavOpen] = useState(false);
  const [mainNavDesktopExpanded, setMainNavDesktopExpanded] = useState(() =>
    defaultMainNavExpandedForPath(window.location.pathname)
  );
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const { error: authError, ready: authReady, user: sessionUser } = useAuth();

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet<HealthData>("/health"),
    staleTime: 60_000,
    retry: 1,
  });

  const { data: whoami, isError: whoamiError, isFetching: whoamiLoading } = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<WhoamiData>("/whoami"),
    enabled: authReady,
    staleTime: 60_000,
    retry: 1,
  });

  const { data: intentStatus } = useQuery({
    queryKey: ["intent-status-nav"],
    queryFn: fetchIntentTrainingStatus,
    enabled: authReady && (whoami?.auth?.scopes?.includes("admin") ?? false),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const disagreementCount = intentStatus?.counts?.disagreement ?? 0;
  const isAdmin = whoami?.auth?.scopes?.includes("admin") ?? false;
  const authDisabled = whoami?.auth?.enabled === false;
  const connected =
    !authError &&
    (authDisabled ? health?.status === "ok" : (whoami?.auth?.scopes?.length ?? 0) > 0);
  const connecting = !authError && !authDisabled && (whoamiLoading || (!connected && !whoamiError));

  const refresh = () => qc.invalidateQueries();
  const pageTitle = APP_ROUTE_TITLES[location.pathname] || BRAND.hubName;
  const isImmersive = IMMERSIVE_APP_PATHS.has(location.pathname);

  useEffect(() => {
    setMainNavDesktopExpanded(defaultMainNavExpandedForPath(location.pathname));
  }, [location.pathname]);

  const closeMainNav = useCallback(() => setMainNavOpen(false), []);

  const toggleMainNavDesktop = useCallback(() => {
    setMainNavDesktopExpanded((prev) => {
      const next = !prev;
      persistMainNavExpanded(next);
      return next;
    });
  }, []);

  const openMainNav = useCallback(() => {
    dispatchPrepareNavigation();
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      setMainNavOpen(true);
      return;
    }
    setMainNavDesktopExpanded(true);
    persistMainNavExpanded(true);
  }, []);

  const onGlobalNav = useCallback(() => {
    dispatchPrepareNavigation();
    closeMainNav();
  }, [closeMainNav]);

  const navContextValue = useMemo(
    () => ({ openMainNav, closeMainNav, mainNavDesktopExpanded, toggleMainNavDesktop }),
    [openMainNav, closeMainNav, mainNavDesktopExpanded, toggleMainNavDesktop]
  );

  return (
    <AppShellNavContext.Provider value={navContextValue}>
      <TooltipProvider>
        <div className="flex h-dvh min-h-0 overflow-hidden bg-background">
          <aside
            className={cn(
              "hidden shrink-0 flex-col border-r border-border/80 bg-gradient-to-b from-card/80 to-card/40 transition-[width,opacity] duration-200 md:flex",
              mainNavDesktopExpanded ? "w-60 opacity-100" : "pointer-events-none w-0 overflow-hidden border-0 opacity-0"
            )}
            aria-hidden={!mainNavDesktopExpanded}
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4">
              <AppNavBrand />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto shrink-0"
                onClick={toggleMainNavDesktop}
                title="Ana menüyü kapat"
                aria-label="Ana menüyü kapat"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-4">
              <AppNavItems disagreementCount={disagreementCount} isAdmin={isAdmin} onNavigate={onGlobalNav} />
            </div>
          </aside>

          <AnimatePresence>
            {mainNavOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[70] bg-black/50 md:hidden"
                  onClick={closeMainNav}
                />
                <motion.aside
                  initial={{ x: -300 }}
                  animate={{ x: 0 }}
                  exit={{ x: -300 }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                  className="fixed inset-y-0 left-0 z-[80] flex w-[min(18rem,88vw)] flex-col border-r border-border bg-card shadow-xl md:hidden"
                >
                  <div className="flex h-14 items-center justify-between border-b border-border px-4">
                    <AppNavBrand />
                    <Button variant="ghost" size="icon" onClick={closeMainNav} aria-label="Menüyü kapat">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 py-3">
                    <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Menü
                    </p>
                    <AppNavItems
                      disagreementCount={disagreementCount}
                      isAdmin={isAdmin}
                      onNavigate={() => {
                        onGlobalNav();
                        closeMainNav();
                      }}
                    />
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {!isImmersive && (
              <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border/80 bg-background/85 px-3 backdrop-blur-md sm:px-5">
                <MainNavMenuButton className="md:hidden" />
                <MainNavDesktopToggle className="hidden md:inline-flex" />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <h1 className="truncate text-sm font-semibold sm:text-base">{pageTitle}</h1>
                  {sessionUser ? (
                    <Badge variant="default" className="hidden max-w-[180px] truncate text-[10px] sm:inline-flex">
                      {sessionUser.displayName || sessionUser.email}
                    </Badge>
                  ) : whoami?.user?.displayName || whoami?.user?.email ? (
                    <Badge variant="default" className="hidden max-w-[180px] truncate text-[10px] sm:inline-flex">
                      {whoami.user.displayName || whoami.user.email}
                    </Badge>
                  ) : whoami?.auth?.scopes ? (
                    <Badge variant="success" className="hidden text-[10px] sm:inline-flex">
                      {whoami.auth.scopes.join(", ")}
                    </Badge>
                  ) : null}
                  <Badge
                    variant={connected ? "success" : authError || whoamiError ? "destructive" : "warning"}
                    className="shrink-0 text-[10px]"
                  >
                    {connected ? "Bağlı" : authError || whoamiError ? "Bağlantı hatası" : connecting ? "Bağlanıyor…" : "Bağlı değil"}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={toggle}>
                        Tema: {theme === "dark" ? "Açık mod" : "Koyu mod"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={refresh}>Verileri yenile</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          onGlobalNav();
                          navigate("/settings?tab=account");
                        }}
                      >
                        Hesabım
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          onGlobalNav();
                          navigate("/settings");
                        }}
                      >
                        Ayarlar
                      </DropdownMenuItem>
                      {sessionUser && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={async () => {
                              await logout();
                              navigate("/login", { replace: true });
                              window.location.reload();
                            }}
                          >
                            <LogOut className="mr-2 h-4 w-4" />
                            Çıkış yap
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="icon" onClick={toggle} className="hidden sm:inline-flex">
                    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={refresh}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </header>
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <main
                className={cn(
                  "flex min-h-0 min-w-0 flex-1 flex-col",
                  isImmersive ? "overflow-hidden p-0" : "overflow-auto p-3 sm:p-4 md:p-6 lg:p-8"
                )}
              >
                <ErrorBoundary>
                  <RoutedPage fullBleed={isImmersive} />
                </ErrorBoundary>
              </main>
              {!isImmersive && <AppFooter />}
            </div>
          </div>
          {connected && location.pathname !== "/login" && location.pathname !== "/register" && (
            <JarvisOverlay />
          )}
        </div>
      </TooltipProvider>
    </AppShellNavContext.Provider>
  );
}
