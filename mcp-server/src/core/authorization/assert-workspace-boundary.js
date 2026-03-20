import { getWorkspace } from "../workspace.js";

/**
 * Fail-closed workspace registry check (matches canRunTool strict semantics for discovery/filter).
 *
 * @param {string|null|undefined} workspaceId
 * @param {import('../security/resolve-runtime-security.js').SecurityRuntime} runtime
 * @returns {{ ok: false, error: object } | null}
 */
export function assertRegisteredWorkspaceBoundary(workspaceId, runtime) {
  const wsId = workspaceId ?? "global";

  if (!runtime?.strictWorkspaceRegistration) return null;
  if (wsId === "global" || wsId == null || String(wsId).trim() === "") return null;

  if (!getWorkspace(wsId)) {
    return {
      ok: false,
      error: {
        code: "workspace_not_registered",
        message: `Workspace "${wsId}" is not registered. Create or register the workspace first, or set HUB_STRICT_WORKSPACE=false for local development.`,
      },
    };
  }
  return null;
}
