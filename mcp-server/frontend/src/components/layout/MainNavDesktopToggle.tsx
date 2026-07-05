import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppShellNav } from "@/components/layout/AppShellNavContext";

type MainNavDesktopToggleProps = {
  className?: string;
  showLabel?: boolean;
};

/** Opens the desktop main nav when it is collapsed. Hidden while expanded. */
export function MainNavDesktopToggle({ className, showLabel = false }: MainNavDesktopToggleProps) {
  const { mainNavDesktopExpanded, toggleMainNavDesktop } = useAppShellNav();

  if (mainNavDesktopExpanded) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "sm" : "icon"}
      className={cn(showLabel && "gap-2 rounded-xl px-2.5", className)}
      onClick={toggleMainNavDesktop}
      title="Ana menüyü aç"
      aria-label="Ana menüyü aç"
    >
      <PanelLeft className="h-5 w-5 shrink-0" />
      {showLabel && <span className="text-xs font-medium">Menü</span>}
    </Button>
  );
}
