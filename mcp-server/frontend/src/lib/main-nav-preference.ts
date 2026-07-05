const STORAGE_KEY = "felix-hub-main-nav-expanded";

/** Routes where the main nav starts collapsed on desktop. */
export const MAIN_NAV_COLLAPSED_PATHS = new Set(["/chat"]);

export function readMainNavExpandedPreference(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return true;
    return saved === "true";
  } catch {
    return true;
  }
}

export function persistMainNavExpanded(expanded: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? "true" : "false");
  } catch {
    /* ignore quota / private mode */
  }
}

export function defaultMainNavExpandedForPath(pathname: string): boolean {
  if (MAIN_NAV_COLLAPSED_PATHS.has(pathname)) return false;
  return readMainNavExpandedPreference();
}
