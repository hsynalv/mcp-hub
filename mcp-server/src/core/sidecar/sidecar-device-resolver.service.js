/**
 * Resolve which paired sidecar device should handle a tool call.
 *
 * Priority:
 * 1. context.sidecarDeviceId
 * 2. context.sidecarDeviceName (fuzzy match)
 * 3. actor + channel preference
 * 4. exactly one paired device → auto
 * 5. multiple devices, no preference → ambiguous
 */

import { listSidecarDevices, getSidecarDevice } from "./pairing.service.js";
import {
  getSidecarPreference,
  resolveSidecarActorId,
  resolveSidecarChannel,
} from "./sidecar-preferences.service.js";

/**
 * @param {string} name
 * @param {object[]} devices
 */
function findDeviceByName(name, devices) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  const exact = devices.filter((d) => d.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const partial = devices.filter(
    (d) => d.name.toLowerCase().includes(needle) || needle.includes(d.name.toLowerCase())
  );
  if (partial.length === 1) return partial[0];
  return null;
}

/**
 * @param {object} device
 */
export function formatSidecarDeviceSummary(device) {
  if (!device) return null;
  return {
    id: device.id,
    name: device.name,
    platform: device.platform || null,
    hostname: device.hostname || null,
    baseUrl: device.baseUrl,
    capabilities: device.capabilities || ["fs"],
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
  };
}

/**
 * @param {object} [context]
 * @returns {Promise<{ ok: true, device: object, resolution: string } | { ok: false, error: object }>}
 */
export async function resolveSidecarDevice(context = {}) {
  const devices = await listSidecarDevices();
  if (!devices.length) {
    return {
      ok: false,
      error: {
        code: "sidecar_required",
        message:
          "Local actions are delegated to a paired sidecar. Run `npm run sidecar:daemon` and pair via POST /sidecar/pair.",
      },
    };
  }

  if (context.sidecarDeviceId) {
    const device = await getSidecarDevice(String(context.sidecarDeviceId));
    if (device) {
      return { ok: true, device, resolution: "explicit_id" };
    }
    return {
      ok: false,
      error: {
        code: "sidecar_not_found",
        message: `Sidecar device not found: ${context.sidecarDeviceId}`,
        devices: devices.map(formatSidecarDeviceSummary),
      },
    };
  }

  if (context.sidecarDeviceName) {
    const byName = findDeviceByName(context.sidecarDeviceName, devices);
    if (byName) {
      return { ok: true, device: byName, resolution: "explicit_name" };
    }
    return {
      ok: false,
      error: {
        code: "sidecar_not_found",
        message: `No sidecar device matches name: ${context.sidecarDeviceName}`,
        devices: devices.map(formatSidecarDeviceSummary),
      },
    };
  }

  const actorId = resolveSidecarActorId(context);
  const channel = resolveSidecarChannel(context);

  const channelPref = await getSidecarPreference(actorId, channel);
  if (channelPref.device) {
    return { ok: true, device: channelPref.device, resolution: "preference_channel" };
  }

  if (channel !== "default") {
    const defaultPref = await getSidecarPreference(actorId, "default");
    if (defaultPref.device) {
      return { ok: true, device: defaultPref.device, resolution: "preference_default" };
    }
  }

  if (devices.length === 1) {
    return { ok: true, device: devices[0], resolution: "single_device" };
  }

  return {
    ok: false,
    error: {
      code: "sidecar_ambiguous",
      message: "Birden fazla Felix Desktop eşleşmiş. Hangi cihazı kullanayım?",
      devices: devices.map(formatSidecarDeviceSummary),
      actorId,
      channel,
    },
  };
}

/**
 * Build prompt section listing devices and preferences for LLM.
 * @param {object} [context]
 */
export async function buildSidecarDevicesPromptSection(context = {}) {
  const devices = await listSidecarDevices();
  if (!devices.length) {
    return "## Felix Desktop\nNo paired devices. User must pair Felix Desktop first.";
  }

  const actorId = resolveSidecarActorId(context);
  const channel = resolveSidecarChannel(context);
  const pref = await getSidecarPreference(actorId, channel);
  const defaultPref =
    channel !== "default" ? await getSidecarPreference(actorId, "default") : null;

  const lines = ["## Felix Desktop cihazları"];
  for (const d of devices) {
    const plat = d.platform || "unknown";
    const host = d.hostname ? ` (${d.hostname})` : "";
    lines.push(`- ${d.name}${host} — platform: ${plat} [id: ${d.id}]`);
  }

  if (pref.device) {
    lines.push(`Varsayılan (${channel}): ${pref.device.name} [id: ${pref.device.id}]`);
  } else if (defaultPref?.device) {
    lines.push(`Varsayılan (global): ${defaultPref.device.name} [id: ${defaultPref.device.id}]`);
  } else if (devices.length > 1) {
    lines.push(
      "Birden fazla cihaz var; kullanıcı hedef belirtmediyse sidecar_list_devices ile listele ve hangi cihazı kullanacağını sor. Seçimden sonra sidecar_set_active ile kaydet."
    );
  } else {
    lines.push(`Tek cihaz: ${devices[0].name} — otomatik kullanılır.`);
  }

  return lines.join("\n");
}

export function sidecarAmbiguousError(devices, actorId, channel) {
  return {
    ok: false,
    error: {
      code: "sidecar_ambiguous",
      message: "Birden fazla Felix Desktop eşleşmiş. Hangi cihazı kullanayım?",
      devices: devices.map(formatSidecarDeviceSummary),
      actorId,
      channel,
    },
  };
}
