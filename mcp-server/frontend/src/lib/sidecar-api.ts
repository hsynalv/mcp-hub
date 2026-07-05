import { apiDelete, apiGet, apiPost, apiPut } from "./api-client";
import { BRAND } from "./branding";

export type SidecarAggregateStatus = "not_required" | "connected" | "offline" | "no_device";
export type SidecarMode = "direct" | "delegated";

export interface SidecarDevice {
  id: string;
  name: string;
  baseUrl: string;
  platform?: string | null;
  hostname?: string | null;
  capabilities?: string[];
  pairedAt?: string;
  lastSeenAt?: string;
  online: boolean;
  health?: { ok?: boolean; capabilities?: string[]; platform?: string; hostname?: string } | null;
  error?: string | null;
}

export interface SidecarStatus {
  nodeEnv: string;
  localFsOnServer: boolean;
  delegateToSidecar: boolean;
  mode: SidecarMode;
  deviceCount: number;
  devices: SidecarDevice[];
  aggregateStatus: SidecarAggregateStatus;
  sidecarRequired: boolean;
  ready: boolean;
}

export interface PairingCode {
  id: string;
  code: string;
  expiresInSec: number;
}

export async function fetchSidecarStatus() {
  return apiGet<SidecarStatus>("/sidecar/status");
}

export async function createSidecarPairingCode() {
  return apiPost<PairingCode>("/sidecar/pairing/code", {});
}

export async function pairSidecarDevice(body: {
  code: string;
  deviceName: string;
  baseUrl: string;
  platform?: string;
  hostname?: string;
}) {
  return apiPost<{ id: string; name: string; baseUrl: string } & { authToken?: string }>(
    "/sidecar/pair",
    body
  );
}

export interface SidecarPreference {
  actorId: string;
  channel: string;
  deviceId: string | null;
  device?: SidecarDevice | null;
  persisted?: boolean;
}

export async function fetchSidecarPreferences(channel = "default") {
  return apiGet<SidecarPreference>(`/sidecar/preferences?channel=${encodeURIComponent(channel)}`);
}

export async function setSidecarPreference(body: {
  channel?: string;
  deviceId: string;
}) {
  return apiPut<SidecarPreference>("/sidecar/preferences", body);
}

export async function setSidecarDeviceDefault(deviceId: string, channel = "default") {
  return apiPost<SidecarPreference>(`/sidecar/devices/${deviceId}/set-default`, { channel });
}

export async function removeSidecarDevice(deviceId: string) {
  return apiDelete<{ deleted: string }>(`/sidecar/devices/${deviceId}`);
}

export function sidecarStatusLabel(status: SidecarAggregateStatus): string {
  switch (status) {
    case "not_required":
      return "Gerekmez (doğrudan erişim)";
    case "connected":
      return "Bağlı";
    case "offline":
      return "Çevrimdışı";
    case "no_device":
      return "Cihaz eşleştirilmedi";
    default:
      return status;
  }
}

export function sidecarStatusTone(
  status: SidecarAggregateStatus
): "healthy" | "warning" | "error" | "disabled" {
  switch (status) {
    case "connected":
    case "not_required":
      return "healthy";
    case "no_device":
      return "warning";
    case "offline":
      return "error";
    default:
      return "disabled";
  }
}

export function sidecarModeDescription(mode: SidecarMode, nodeEnv: string): string {
  const desktop = BRAND.desktopAgentName;
  if (mode === "direct") {
    return `Geliştirme modu (${nodeEnv}): dosya ve terminal işlemleri hub bu makinede çalışır. ${desktop} gerekmez.`;
  }
  return `Production / delegation modu: yerel dosya, terminal ve bildirimler eşleştirilmiş ${desktop} üzerinden yapılır.`;
}
