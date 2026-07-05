/**
 * Per-actor sidecar device preferences (chat / telegram / default channels).
 */

import { persistenceQuery, isPersistenceHealthy } from "../persistence/index.js";
import { getSidecarDevice } from "./pairing.service.js";

const VALID_CHANNELS = new Set(["default", "chat", "telegram"]);

/** @type {Map<string, { deviceId: string, updatedAt: string }>} */
const memoryStore = new Map();

function memoryKey(actorId, channel) {
  return `${actorId}::${channel}`;
}

function normalizeChannel(value) {
  const ch = String(value || "default").trim().toLowerCase();
  return VALID_CHANNELS.has(ch) ? ch : "default";
}

function normalizeActorId(actorId) {
  const id = String(actorId || "").trim();
  if (!id) return "anonymous";
  return id.slice(0, 128);
}

/**
 * @param {string} actorId
 * @param {string} [channel]
 */
export async function getSidecarPreference(actorId, channel = "default") {
  const actor = normalizeActorId(actorId);
  const ch = normalizeChannel(channel);

  if (isPersistenceHealthy()) {
    try {
      const result = await persistenceQuery(
        `SELECT TOP 1 device_id, updated_at FROM sidecar_preferences WHERE actor_id = @actorId AND channel = @channel`,
        { actorId: actor, channel: ch }
      );
      const row = result?.recordset?.[0];
      if (row) {
        const deviceId = String(row.device_id);
        const device = await getSidecarDevice(deviceId);
        return {
          actorId: actor,
          channel: ch,
          deviceId,
          device,
          persisted: true,
          storage: "database",
          updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at ?? null,
        };
      }
    } catch (err) {
      console.warn("[sidecar-preferences] read failed:", err.message);
    }
  }

  const mem = memoryStore.get(memoryKey(actor, ch));
  if (mem) {
    const device = await getSidecarDevice(mem.deviceId);
    return {
      actorId: actor,
      channel: ch,
      deviceId: mem.deviceId,
      device,
      persisted: true,
      storage: "memory",
      updatedAt: mem.updatedAt,
    };
  }

  return {
    actorId: actor,
    channel: ch,
    deviceId: null,
    device: null,
    persisted: false,
    storage: "none",
    updatedAt: null,
  };
}

/**
 * @param {string} actorId
 * @param {{ channel?: string, deviceId: string }} opts
 */
export async function setSidecarPreference(actorId, { channel = "default", deviceId }) {
  const actor = normalizeActorId(actorId);
  const ch = normalizeChannel(channel);
  const id = String(deviceId || "").trim();
  if (!id) {
    return { ok: false, error: "device_id_required" };
  }

  const device = await getSidecarDevice(id);
  if (!device) {
    return { ok: false, error: "device_not_found" };
  }

  const updatedAt = new Date().toISOString();

  if (isPersistenceHealthy()) {
    try {
      await persistenceQuery(
        `
        MERGE sidecar_preferences AS target
        USING (SELECT @actorId AS actor_id, @channel AS channel) AS source
        ON target.actor_id = source.actor_id AND target.channel = source.channel
        WHEN MATCHED THEN
          UPDATE SET device_id = @deviceId, updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (actor_id, channel, device_id)
          VALUES (@actorId, @channel, @deviceId);
        `,
        { actorId: actor, channel: ch, deviceId: id }
      );
    } catch (err) {
      console.warn("[sidecar-preferences] write failed:", err.message);
      return { ok: false, error: "persist_failed", message: err.message };
    }
  } else {
    memoryStore.set(memoryKey(actor, ch), { deviceId: id, updatedAt });
  }

  return {
    ok: true,
    actorId: actor,
    channel: ch,
    deviceId: id,
    device,
    updatedAt,
  };
}

/**
 * @param {string} actorId
 * @param {string} [channel]
 */
export async function clearSidecarPreference(actorId, channel = "default") {
  const actor = normalizeActorId(actorId);
  const ch = normalizeChannel(channel);

  if (isPersistenceHealthy()) {
    try {
      await persistenceQuery(
        `DELETE FROM sidecar_preferences WHERE actor_id = @actorId AND channel = @channel`,
        { actorId: actor, channel: ch }
      );
    } catch (err) {
      console.warn("[sidecar-preferences] delete failed:", err.message);
    }
  }
  memoryStore.delete(memoryKey(actor, ch));
  return { ok: true, actorId: actor, channel: ch };
}

export function resolveSidecarChannel(context = {}) {
  if (context.channel === "telegram") return "telegram";
  if (context.channel === "chat") return "chat";
  if (context.source === "chat_ui") return "chat";
  if (String(context.actor || "").startsWith("telegram:")) return "telegram";
  if (context.source === "rest" || context.source === "ui") return "chat";
  return "default";
}

export function resolveSidecarActorId(context = {}) {
  if (context.actor) return String(context.actor);
  if (context.user?.userId) return String(context.user.userId);
  return "anonymous";
}

export function resetSidecarPreferencesForTests() {
  memoryStore.clear();
}
