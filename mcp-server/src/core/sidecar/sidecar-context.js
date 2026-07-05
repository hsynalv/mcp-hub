/**
 * Inject paired sidecar device metadata into tool execution context (V10 capability guard).
 */

import { isLocalFsOnServer, listSidecarDevices } from "./pairing.service.js";
import {
  resolveSidecarDevice,
  formatSidecarDeviceSummary,
} from "./sidecar-device-resolver.service.js";

/**
 * @param {object} context
 * @returns {Promise<object>}
 */
export async function enrichSidecarToolContext(context = {}) {
  if (isLocalFsOnServer()) return context;

  const devices = await listSidecarDevices();
  if (!devices.length) return context;

  const resolved = await resolveSidecarDevice(context);

  const availableSidecars = devices.map(formatSidecarDeviceSummary);

  if (!resolved.ok) {
    return {
      ...context,
      availableSidecars,
      sidecarResolution: resolved.error?.code === "sidecar_ambiguous" ? "ambiguous" : "unresolved",
      sidecarResolutionError: resolved.error || null,
    };
  }

  const device = resolved.device;
  return {
    ...context,
    sidecarCapabilities: device.capabilities || ["fs"],
    sidecarDeviceId: device.id,
    sidecarDeviceName: device.name,
    sidecarBaseUrl: device.baseUrl,
    sidecarPlatform: device.platform || null,
    sidecarResolution: resolved.resolution,
    availableSidecars,
  };
}
