import { Router } from "express";
import { z } from "zod";
import { slackRequest } from "./slack.client.js";

export const name = "slack";
export const version = "1.0.0";
export const description = "Slack team communication and bot integration";
export const capabilities = ["read", "write"];
export const requires = ["SLACK_BOT_TOKEN"];
export const endpoints = [
  { method: "GET",    path: "/slack/channels",              description: "List all channels",                         scope: "read"  },
  { method: "GET",    path: "/slack/channels/:id",         description: "Get channel information",                    scope: "read"  },
  { method: "POST",   path: "/slack/message",               description: "Send message to channel",                   scope: "write" },
  { method: "GET",    path: "/slack/users",                 description: "List all users",                           scope: "read"  },
  { method: "GET",    path: "/slack/users/:id",             description: "Get user information",                      scope: "read"  },
  { method: "POST",   path: "/slack/files/upload",          description: "Upload file to channel",                    scope: "write" },
  { method: "GET",    path: "/slack/conversations/:id/history", description: "Get channel message history",               scope: "read"  },
  { method: "POST",   path: "/slack/reactions/add",         description: "Add reaction to message",                  scope: "write" },
];
export const examples = [
  "GET  /slack/channels",
  "POST /slack/message  body: { channel: 'C123', text: 'Hello!' }",
  "POST /slack/files/upload  body: { channel: 'C123', file: 'base64...' }",
];

// ── Zod schemas ───────────────────────────────────────────────────────────────

const sendMessageSchema = z.object({
  channel: z.string().min(1),
  text: z.string().min(1),
  thread_ts: z.string().optional(),
  blocks: z.array(z.any()).optional(),
});

const uploadFileSchema = z.object({
  channel: z.string().min(1),
  file: z.string().min(1), // base64 encoded file content
  filename: z.string().min(1),
  title: z.string().optional(),
  initial_comment: z.string().optional(),
});

const addReactionSchema = z.object({
  channel: z.string().min(1),
  timestamp: z.string().min(1),
  name: z.string().min(1), // reaction name like "thumbsup", "heart", etc.
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(res, status, error, message, details) {
  return res.status(status).json({ ok: false, error, message, details });
}

function validate(schema, data, res) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    err(res, 400, "invalid_request", "Validation failed", parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

function formatChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    display_name: channel.display_name || channel.name,
    purpose: channel.purpose?.value || "",
    topic: channel.topic?.value || "",
    type: channel.type, // "public_channel", "private_channel", "im", "mpim"
    is_archived: channel.is_archived,
    created: channel.created,
    member_count: channel.num_members || 0,
  };
}

function formatUser(user) {
  return {
    id: user.id,
    name: user.name,
    display_name: user.profile?.display_name || user.name,
    real_name: user.profile?.real_name || user.name,
    email: user.profile?.email || "",
    avatar: user.profile?.image_192 || "",
    is_bot: user.is_bot || false,
    is_admin: user.is_admin || false,
    status: user.presence || "away",
  };
}

function formatMessage(message) {
  return {
    id: message.ts,
    user: message.user,
    username: message.username,
    text: message.text,
    thread_ts: message.thread_ts,
    timestamp: parseFloat(message.ts) * 1000, // convert to milliseconds
    reactions: message.reactions?.map(r => ({
      name: r.name,
      count: r.count,
      users: r.users,
    })) || [],
    files: message.files?.map(f => ({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      size: f.size,
      url: f.url_private,
    })) || [],
  };
}

// ── Plugin register ───────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // ── Channels ───────────────────────────────────────────────────────────────

  /**
   * GET /slack/channels
   * List all channels the bot has access to.
   * 
   * Query params:
   *   types = comma-separated list (public_channel,private_channel,im,mpim)
   *   limit = max results (default: 100)
   */
  router.get("/channels", async (req, res) => {
    const types = req.query.types || "public_channel,private_channel";
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);

    const result = await slackRequest("GET", "conversations.list", {
      types,
      limit,
    });

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const channels = (result.data?.channels ?? []).map(formatChannel);
    res.json({ ok: true, count: channels.length, channels });
  });

  /**
   * GET /slack/channels/:id
   * Get detailed information about a specific channel.
   */
  router.get("/channels/:id", async (req, res) => {
    const channelId = req.params.id;
    const result = await slackRequest("GET", "conversations.info", {
      channel: channelId,
    });

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, channel: formatChannel(result.data?.channel) });
  });

  /**
   * GET /slack/conversations/:id/history
   * Get message history for a channel.
   * 
   * Query params:
   *   limit = max messages (default: 50)
   *   cursor = pagination cursor
   */
  router.get("/conversations/:id/history", async (req, res) => {
    const channelId = req.params.id;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const cursor = req.query.cursor;

    const params = { channel: channelId, limit };
    if (cursor) params.cursor = cursor;

    const result = await slackRequest("GET", "conversations.history", params);

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const messages = (result.data?.messages ?? []).map(formatMessage);
    res.json({
      ok: true,
      count: messages.length,
      messages,
      has_more: result.data?.has_more || false,
      cursor: result.data?.response_metadata?.next_cursor,
    });
  });

  // ── Messages ───────────────────────────────────────────────────────────────

  /**
   * POST /slack/message
   * Send a message to a channel.
   * 
   * Body: { channel: "C123", text: "Hello!", thread_ts?: "123.456", blocks?: [...] }
   */
  router.post("/message", async (req, res) => {
    const data = validate(sendMessageSchema, req.body, res);
    if (!data) return;

    const result = await slackRequest("POST", "chat.postMessage", data);

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({
      ok: true,
      message: {
        id: result.data?.ts,
        channel: result.data?.channel,
        timestamp: parseFloat(result.data?.ts) * 1000,
      },
    });
  });

  /**
   * POST /slack/reactions/add
   * Add a reaction to a message.
   * 
   * Body: { channel: "C123", timestamp: "123.456", name: "thumbsup" }
   */
  router.post("/reactions/add", async (req, res) => {
    const data = validate(addReactionSchema, req.body, res);
    if (!data) return;

    const result = await slackRequest("POST", "reactions.add", {
      channel: data.channel,
      timestamp: data.timestamp,
      name: data.name,
    });

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, message: "Reaction added successfully" });
  });

  // ── Users ─────────────────────────────────────────────────────────────────

  /**
   * GET /slack/users
   * List all users in the workspace.
   * 
   * Query params:
   *   limit = max results (default: 100)
   *   cursor = pagination cursor
   */
  router.get("/users", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    const cursor = req.query.cursor;

    const params = { limit };
    if (cursor) params.cursor = cursor;

    const result = await slackRequest("GET", "users.list", params);

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const users = (result.data?.members ?? []).map(formatUser);
    res.json({
      ok: true,
      count: users.length,
      users,
      has_more: result.data?.response_metadata?.next_cursor !== undefined,
      cursor: result.data?.response_metadata?.next_cursor,
    });
  });

  /**
   * GET /slack/users/:id
   * Get detailed information about a specific user.
   */
  router.get("/users/:id", async (req, res) => {
    const userId = req.params.id;
    const result = await slackRequest("GET", "users.info", { user: userId });

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, user: formatUser(result.data?.user) });
  });

  // ── Files ─────────────────────────────────────────────────────────────────

  /**
   * POST /slack/files/upload
   * Upload a file to a channel.
   * 
   * Body: { 
   *   channel: "C123", 
   *   file: "base64-encoded-content", 
   *   filename: "document.pdf",
   *   title?: "Document Title",
   *   initial_comment?: "Check this out"
   * }
   */
  router.post("/files/upload", async (req, res) => {
    const data = validate(uploadFileSchema, req.body, res);
    if (!data) return;

    try {
      // Decode base64 file content
      const fileBuffer = Buffer.from(data.file, 'base64');
      
      // Upload file to Slack
      const result = await slackRequest("POST", "files.upload", {
        channels: data.channel,
        file: fileBuffer,
        filename: data.filename,
        title: data.title,
        initial_comment: data.initial_comment,
      }, true); // true indicates file upload

      if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

      res.json({
        ok: true,
        file: {
          id: result.data?.file?.id,
          name: result.data?.file?.name,
          mimetype: result.data?.file?.mimetype,
          size: result.data?.file?.size,
          url: result.data?.file?.url_private,
          permalink: result.data?.file?.permalink,
        },
      });
    } catch (error) {
      return err(res, 500, "file_upload_error", "Failed to process file upload", { message: error.message });
    }
  });

  app.use("/slack", router);
}
