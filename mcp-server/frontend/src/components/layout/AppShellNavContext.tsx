import { createContext, useContext } from "react";

type AppShellNavContextValue = {
  openMainNav: () => void;
  closeMainNav: () => void;
  mainNavDesktopExpanded: boolean;
  toggleMainNavDesktop: () => void;
};

export const AppShellNavContext = createContext<AppShellNavContextValue | null>(null);

export function useAppShellNav() {
  const ctx = useContext(AppShellNavContext);
  if (!ctx) {
    throw new Error("useAppShellNav must be used within AppShell");
  }
  return ctx;
}
