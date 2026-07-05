/**
 * Sidecar pairing and device management routes.
 */

import { requireScope } from "../auth.js";
import {
  createPairingCode,
  consumePairingCode,
  listSidecarDevices,
  removeSidecarDevice,
  rotateSidecarDeviceToken,
  updateSidecarDeviceCapabilities,
  updateSidecarDevice,
  isLocalFsOnServer,
} from "./pairing.service.js";
import { auditLog } from "../audit/index.js";
import { listSidecarCapabilityCatalog } from "../../plugins/local-sidecar/sidecar-health.core.js";
import {
  getSidecarPreference,
  setSidecarPreference,
} from "./sidecar-preferences.service.js";
import { resolveActorId } from "../workspace-preferences.service.js";

async function probeDeviceHealth(device) {
  try {
    const headers = { Accept: "application/json" };
    if (device.authToken) headers.Authorization = `Bearer ${device.authToken}`;
    const res = await fetch(`${device.baseUrl}/health`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => ({}));
    return { online: true, health: body };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

function resolveAggregateStatus({ delegateToSidecar, devices }) {
  if (!delegateToSidecar) return "not_required";
  if (!devices.length) return "no_device";
  if (devices.some((d) => d.online)) return "connected";
  return "offline";
}

export async function getSidecarStatusPayload() {
  const localFsOnServer = isLocalFsOnServer();
  const delegateToSidecar = !localFsOnServer;
  const raw = await listSidecarDevices();
  const devices = await Promise.all(
    raw.map(async (d) => {
      const probe = await probeDeviceHealth(d);
      return {
        id: d.id,
        name: d.name,
        baseUrl: d.baseUrl,
        platform: d.platform || probe.health?.platform || null,
        hostname: d.hostname || probe.health?.hostname || null,
        capabilities: d.capabilities || ["fs"],
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
        online: probe.online,
        health: probe.health || null,
        error: probe.error || null,
      };
    })
  );

  const aggregateStatus = resolveAggregateStatus({ delegateToSidecar, devices });

  return {
    nodeEnv: process.env.NODE_ENV || "development",
    localFsOnServer,
    delegateToSidecar,
    mode: localFsOnServer ? "direct" : "delegated",
    deviceCount: devices.length,
    devices,
    aggregateStatus,
    sidecarRequired: delegateToSidecar,
    ready: !delegateToSidecar || aggregateStatus === "connected",
  };
}

export function registerSidecarRoutes(app) {
  app.get("/sidecar/status", requireScope("read"), async (_req, res) => {
    try {
      const data = await getSidecarStatusPayload();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "status_failed", message: err.message } });
    }
  });

  app.post("/sidecar/pairing/code", requireScope("admin"), (_req, res) => {
    const data = createPairingCode({ createdBy: "admin" });
    res.json({ ok: true, data });
  });

  app.post("/sidecar/pair", requireScope("write"), async (req, res) => {
    const { code, deviceName, baseUrl, capabilities, platform, hostname } = req.body ?? {};
    if (!code || !baseUrl) {
      return res.status(400).json({
        ok: false,
        error: { code: "invalid_request", message: "code and baseUrl required" },
      });
    }
    const result = await consumePairingCode(String(code), {
      deviceName,
      baseUrl: String(baseUrl),
      capabilities,
      platform,
      hostname,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: { code: result.error, message: result.error } });
    }
    res.json({
      ok: true,
      data: {
        ...result.device,
        authToken: result.authToken,
      },
    });
  });

  app.delete("/sidecar/devices/:id", requireScope("admin"), async (req, res) => {
    const reason = req.body?.reason || req.query?.reason || "admin_revoke";
    const removed = await removeSidecarDevice(req.params.id);
    if (!removed) {
      return res.status(404).json({ ok: false, error: { code: "not_found" } });
    }
    void auditLog({
      plugin: "local-sidecar",
      operation: "sidecar_device_revoke",
      actor: req.user?.id || "admin",
      allowed: true,
      success: true,
      metadata: { deviceId: req.params.id, reason },
    }).catch(() => {});
    res.json({ ok: true, deleted: req.params.id, reason });
  });

  app.post("/sidecar/devices/:id/rotate-token", requireScope("admin"), async (req, res) => {
    const result = await rotateSidecarDeviceToken(req.params.id);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: { code: result.error, message: result.error } });
    }
    void auditLog({
      plugin: "local-sidecar",
      operation: "sidecar_token_rotate",
      actor: req.user?.id || "admin",
      allowed: true,
      success: true,
      metadata: {
        deviceId: result.deviceId,
        reason: req.body?.reason || "admin_rotate",
        rotatedAt: result.rotatedAt,
      },
    }).catch(() => {});
    res.json({
      ok: true,
      data: {
        deviceId: result.deviceId,
        authToken: result.authToken,
        rotatedAt: result.rotatedAt,
      },
    });
  });

  app.get("/sidecar/capabilities", requireScope("read"), (_req, res) => {
    res.json(listSidecarCapabilityCatalog());
  });

  app.patch("/sidecar/devices/:id/capabilities", requireScope("admin"), async (req, res) => {
    const { capabilities } = req.body ?? {};
    const result = await updateSidecarDeviceCapabilities(req.params.id, capabilities);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: { code: result.error, message: result.error } });
    }
    void auditLog({
      plugin: "local-sidecar",
      operation: "sidecar_capabilities_update",
      actor: req.user?.id || "admin",
      allowed: true,
      success: true,
      metadata: { deviceId: result.deviceId, capabilities: result.capabilities },
    }).catch(() => {});
    res.json({ ok: true, data: result });
  });

  app.patch("/sidecar/devices/:id", requireScope("admin"), async (req, res) => {
    const { baseUrl, capabilities } = req.body ?? {};
    const result = await updateSidecarDevice(req.params.id, { baseUrl, capabilities });
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: { code: result.error, message: result.error } });
    }
    void auditLog({
      plugin: "local-sidecar",
      operation: "sidecar_device_update",
      actor: req.user?.id || "admin",
      allowed: true,
      success: true,
      metadata: result,
    }).catch(() => {});
    res.json({ ok: true, data: result });
  });

  app.get("/sidecar/preferences", requireScope("read"), async (req, res) => {
    try {
      const actorId = resolveActorId(req);
      const channel = req.query?.channel || "default";
      const data = await getSidecarPreference(actorId, String(channel));
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "sidecar_prefs_read_failed", message: err.message } });
    }
  });

  app.put("/sidecar/preferences", requireScope("write"), async (req, res) => {
    try {
      const actorId = resolveActorId(req);
      const { channel = "default", deviceId } = req.body ?? {};
      const result = await setSidecarPreference(actorId, { channel, deviceId });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: { code: result.error, message: result.error } });
      }
      void auditLog({
        plugin: "local-sidecar",
        operation: "sidecar_preference_set",
        actor: actorId,
        allowed: true,
        success: true,
        metadata: { channel, deviceId: result.deviceId },
      }).catch(() => {});
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "sidecar_prefs_write_failed", message: err.message } });
    }
  });

  app.post("/sidecar/devices/:id/set-default", requireScope("write"), async (req, res) => {
    try {
      const actorId = resolveActorId(req);
      const channel = req.body?.channel || "default";
      const result = await setSidecarPreference(actorId, { channel, deviceId: req.params.id });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: { code: result.error, message: result.error } });
      }
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "sidecar_set_default_failed", message: err.message } });
    }
  });
}
