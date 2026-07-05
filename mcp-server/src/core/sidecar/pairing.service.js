/**
 * Sidecar device pairing — one-time codes + registered devices (memory + MSSQL).
 */

import { randomUUID, randomInt } from "crypto";
import { generateSidecarAuthToken } from "./sidecar-auth.js";
import { persistenceQuery, isPersistenceHealthy, randomUUID as dbUuid } from "../persistence/index.js";

/** @type {Map<string, { code: string, expiresAt: number }>} */
const pendingCodes = new Map();

/** @type {Map<string, object>} */
const devices = new Map();

const CODE_TTL_MS = 5 * 60 * 1000;
let devicesHydrated = false;

export function isLocalFsOnServer() {
  const v = process.env.LOCAL_FS_ON_SERVER;
  if (v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  return process.env.NODE_ENV !== "production";
}

async function hydrateDevicesFromDb() {
  if (devicesHydrated || !isPersistenceHealthy()) {
    devicesHydrated = true;
    return;
  }
  try {
    const result = await persistenceQuery(
      `SELECT id, name, base_url, capabilities_json, auth_token, paired_at, last_seen_at,
              platform, hostname
       FROM sidecar_devices ORDER BY paired_at ASC`
    );
    for (const row of result?.recordset ?? []) {
      devices.set(row.id, {
        id: row.id,
        name: row.name,
        baseUrl: row.base_url,
        capabilities: JSON.parse(row.capabilities_json || '["fs"]'),
        authToken: row.auth_token,
        pairedAt: row.paired_at,
        lastSeenAt: row.last_seen_at,
        platform: row.platform || null,
        hostname: row.hostname || null,
      });
    }
  } catch (err) {
    console.warn("[sidecar] device hydrate failed:", err.message);
  }
  devicesHydrated = true;
}

async function persistDevice(device) {
  if (!isPersistenceHealthy()) return;
  try {
    await persistenceQuery(
      `MERGE sidecar_devices AS target
       USING (SELECT @id AS id) AS source ON target.id = source.id
       WHEN MATCHED THEN
         UPDATE SET name = @name, base_url = @baseUrl, capabilities_json = @capabilitiesJson,
           auth_token = @authToken, last_seen_at = @lastSeenAt, platform = @platform, hostname = @hostname
       WHEN NOT MATCHED THEN
         INSERT (id, name, base_url, capabilities_json, auth_token, paired_at, last_seen_at, platform, hostname)
         VALUES (@id, @name, @baseUrl, @capabilitiesJson, @authToken, @pairedAt, @lastSeenAt, @platform, @hostname);`,
      {
        id: device.id,
        name: device.name,
        baseUrl: device.baseUrl,
        capabilitiesJson: JSON.stringify(device.capabilities || ["fs"]),
        authToken: device.authToken,
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
        platform: device.platform || null,
        hostname: device.hostname || null,
      }
    );
  } catch (err) {
    console.warn("[sidecar] device persist failed:", err.message);
  }
}

async function deleteDeviceFromDb(deviceId) {
  if (!isPersistenceHealthy()) return;
  try {
    await persistenceQuery(`DELETE FROM sidecar_devices WHERE id = @id`, { id: deviceId });
  } catch (err) {
    console.warn("[sidecar] device delete failed:", err.message);
  }
}

export function createPairingCode({ createdBy = "admin" } = {}) {
  const id = randomUUID();
  const code = String(randomInt(100000, 999999));
  pendingCodes.set(code, {
    id,
    code,
    createdBy,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return { id, code, expiresInSec: CODE_TTL_MS / 1000 };
}

/**
 * Sidecar daemon serves plain HTTP; https:// on LAN/static IP breaks hub health probes.
 * @param {string} baseUrl
 */
export function normalizeSidecarBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!trimmed) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.protocol === "https:" && (u.port === "9477" || u.port === "")) {
      u.protocol = "http:";
      if (!u.port) u.port = "9477";
      return u.toString().replace(/\/$/, "");
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/^https:\/\//i, "http://");
  }
}

export async function consumePairingCode(
  code,
  {
    deviceName,
    baseUrl,
    capabilities = ["fs", "terminal", "desktop", "notify", "browser"],
    platform = null,
    hostname = null,
  } = {}
) {
  await hydrateDevicesFromDb();
  const pending = pendingCodes.get(code);
  if (!pending) return { ok: false, error: "invalid_code" };
  if (Date.now() > pending.expiresAt) {
    pendingCodes.delete(code);
    return { ok: false, error: "expired_code" };
  }
  pendingCodes.delete(code);

  const device = {
    id: dbUuid(),
    name: deviceName || "sidecar",
    baseUrl: normalizeSidecarBaseUrl(baseUrl),
    capabilities,
    authToken: generateSidecarAuthToken(),
    pairedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    platform: platform ? String(platform).slice(0, 16) : null,
    hostname: hostname ? String(hostname).slice(0, 256) : null,
  };
  devices.set(device.id, device);
  await persistDevice(device);
  return { ok: true, device, authToken: device.authToken };
}

export async function listSidecarDevices() {
  await hydrateDevicesFromDb();
  return [...devices.values()];
}

export async function getSidecarDevice(deviceId) {
  await hydrateDevicesFromDb();
  return devices.get(deviceId) || null;
}

export async function getDefaultSidecarDevice() {
  const all = await listSidecarDevices();
  return all.length ? all[all.length - 1] : null;
}

export async function touchDevice(deviceId) {
  await hydrateDevicesFromDb();
  const d = devices.get(deviceId);
  if (d) {
    d.lastSeenAt = new Date().toISOString();
    await persistDevice(d);
  }
  return d;
}

export async function removeSidecarDevice(deviceId) {
  await hydrateDevicesFromDb();
  const ok = devices.delete(deviceId);
  if (ok) await deleteDeviceFromDb(deviceId);
  return ok;
}

export async function rotateSidecarDeviceToken(deviceId) {
  await hydrateDevicesFromDb();
  const device = devices.get(deviceId);
  if (!device) return { ok: false, error: "not_found" };

  const authToken = generateSidecarAuthToken();
  device.authToken = authToken;
  device.tokenRotatedAt = new Date().toISOString();
  device.lastSeenAt = new Date().toISOString();
  await persistDevice(device);

  return {
    ok: true,
    deviceId: device.id,
    authToken,
    rotatedAt: device.tokenRotatedAt,
  };
}

export async function updateSidecarDeviceCapabilities(deviceId, capabilities) {
  await hydrateDevicesFromDb();
  const device = devices.get(deviceId);
  if (!device) return { ok: false, error: "not_found" };
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return { ok: false, error: "invalid_capabilities" };
  }
  device.capabilities = capabilities;
  device.lastSeenAt = new Date().toISOString();
  await persistDevice(device);
  return { ok: true, deviceId, capabilities: device.capabilities };
}

export async function updateSidecarDevice(deviceId, { baseUrl, capabilities, platform, hostname } = {}) {
  await hydrateDevicesFromDb();
  const device = devices.get(deviceId);
  if (!device) return { ok: false, error: "not_found" };
  if (baseUrl) device.baseUrl = normalizeSidecarBaseUrl(baseUrl);
  if (Array.isArray(capabilities) && capabilities.length > 0) {
    device.capabilities = capabilities;
  }
  if (platform !== undefined) device.platform = platform ? String(platform).slice(0, 16) : null;
  if (hostname !== undefined) device.hostname = hostname ? String(hostname).slice(0, 256) : null;
  device.lastSeenAt = new Date().toISOString();
  await persistDevice(device);
  return {
    ok: true,
    deviceId: device.id,
    baseUrl: device.baseUrl,
    capabilities: device.capabilities,
    platform: device.platform,
    hostname: device.hostname,
  };
}

export function resetSidecarPairingForTests() {
  pendingCodes.clear();
  devices.clear();
  devicesHydrated = false;
}
