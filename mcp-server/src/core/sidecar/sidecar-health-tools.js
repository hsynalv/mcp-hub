/**
 * V10 Faz E — Sidecar health MCP tools.
 */

import { registerTool, ToolTags } from "../tool-registry.js";
import { isLocalFsOnServer } from "./pairing.service.js";
import {
  delegateSidecarDependencies,
  delegateDesktopPermissions,
  sidecarRequiredError,
} from "./sidecar-proxy.js";
import {
  checkSidecarDependencies,
  checkDesktopPermissions,
  listSidecarCapabilityCatalog,
} from "../../plugins/local-sidecar/sidecar-health.core.js";

function sidecarCtx(context = {}) {
  return context && typeof context === "object" ? context : {};
}

export function registerSidecarHealthTools() {
  registerTool({
    name: "sidecar_dependency_check",
    description: "Check sidecar CLI dependencies (tesseract, cliclick, playwright, rclone)",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateSidecarDependencies(sidecarCtx(context))) || sidecarRequiredError();
      }
      return checkSidecarDependencies();
    },
  });

  registerTool({
    name: "desktop_permission_check",
    description: "Check macOS Screen Recording and Accessibility permissions for the sidecar",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY, ToolTags.LOCAL_FS],
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, context) => {
      if (!isLocalFsOnServer()) {
        return (await delegateDesktopPermissions(sidecarCtx(context))) || sidecarRequiredError();
      }
      return checkDesktopPermissions();
    },
  });

  registerTool({
    name: "sidecar_capabilities",
    description: "List sidecar capability groups and default pairing capabilities",
    plugin: "local-sidecar",
    tags: [ToolTags.READ_ONLY],
    inputSchema: { type: "object", properties: {} },
    handler: async () => listSidecarCapabilityCatalog(),
  });
}
