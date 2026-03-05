/**
 * Email Plugin
 *
 * Send and receive emails via SMTP/IMAP.
 * Useful for notifications and automated email handling.
 */

import { Router } from "express";
import { createTransport } from "nodemailer";
import { ToolTags } from "../../core/tool-registry.js";

// Email configuration
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

const DEFAULT_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;

// Email history (last 100 sent)
const emailHistory = [];
const MAX_HISTORY = 100;

/**
 * Check if email is configured
 */
function isConfigured() {
  return !!(SMTP_CONFIG.host && SMTP_CONFIG.auth.user && SMTP_CONFIG.auth.pass);
}

/**
 * Get transporter (cached)
 */
let transporter = null;
function getTransporter() {
  if (!transporter && isConfigured()) {
    transporter = createTransport(SMTP_CONFIG);
  }
  return transporter;
}

/**
 * Send an email
 */
async function sendEmail(options) {
  if (!isConfigured()) {
    throw new Error("Email not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS");
  }

  const {
    to,
    subject,
    text,
    html,
    from = DEFAULT_FROM,
    cc,
    bcc,
    attachments = [],
  } = options;

  if (!to || !subject) {
    throw new Error("Recipient (to) and subject are required");
  }

  const transport = getTransporter();

  const mailOptions = {
    from,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    text,
    html,
    ...(cc && { cc: Array.isArray(cc) ? cc.join(", ") : cc }),
    ...(bcc && { bcc: Array.isArray(bcc) ? bcc.join(", ") : bcc }),
    attachments: attachments.map((att) => ({
      filename: att.filename,
      content: att.content,
      path: att.path,
    })),
  };

  const result = await transport.sendMail(mailOptions);

  const historyEntry = {
    id: result.messageId,
    to,
    subject,
    from,
    timestamp: new Date().toISOString(),
    accepted: result.accepted,
    rejected: result.rejected,
  };

  emailHistory.unshift(historyEntry);
  if (emailHistory.length > MAX_HISTORY) {
    emailHistory.pop();
  }

  return {
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
    response: result.response,
  };
}

/**
 * Send templated email
 */
async function sendTemplatedEmail(template, data, options) {
  const templates = {
    simple: (data) => ({
      subject: data.subject,
      text: data.body,
    }),
    notification: (data) => ({
      subject: `🔔 ${data.title}`,
      text: `${data.message}\n\n${data.actionUrl || ""}`,
      html: `
        <h2>${data.title}</h2>
        <p>${data.message}</p>
        ${data.actionUrl ? `<p><a href="${data.actionUrl}">Take Action</a></p>` : ""}
      `,
    }),
    code_complete: (data) => ({
      subject: `✅ Task Complete: ${data.taskName}`,
      text: `Task "${data.taskName}" has been completed.\n\nSummary:\n${data.summary}\n\nView details: ${data.projectUrl || "N/A"}`,
      html: `
        <h2>Task Complete ✅</h2>
        <p><strong>${data.taskName}</strong> has been completed.</p>
        <h3>Summary</h3>
        <pre>${data.summary}</pre>
        ${data.projectUrl ? `<p><a href="${data.projectUrl}">View in Notion</a></p>` : ""}
      `,
    }),
  };

  const templateFn = templates[template];
  if (!templateFn) {
    throw new Error(`Unknown template: ${template}`);
  }

  const rendered = templateFn(data);
  return sendEmail({ ...rendered, ...options });
}

/**
 * Get email history
 */
function getHistory(limit = 50) {
  return emailHistory.slice(0, Math.min(limit, MAX_HISTORY));
}

/**
 * Verify SMTP connection
 */
async function verifyConnection() {
  if (!isConfigured()) {
    return { ok: false, error: "Not configured" };
  }

  try {
    const transport = getTransporter();
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Plugin exports ───────────────────────────────────────────────────────────

export const name = "email";
export const version = "1.0.0";
export const description = "Send and receive emails via SMTP";
export const capabilities = ["read", "write"];
export const requires = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
export const endpoints = [
  { method: "POST", path: "/email/send", description: "Send an email", scope: "write" },
  { method: "POST", path: "/email/send-template", description: "Send templated email", scope: "write" },
  { method: "GET", path: "/email/history", description: "Get sent email history", scope: "read" },
  { method: "GET", path: "/email/health", description: "Check SMTP connection", scope: "read" },
];
export const examples = [
  'POST /email/send  body: {"to":"user@example.com","subject":"Hello","text":"World"}',
  'POST /email/send-template  body: {"template":"notification","data":{"title":"Alert","message":"Done"},"to":"user@example.com"}',
];

// ── MCP Tools ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "email_send",
    description: "Send an email",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email(s), comma-separated" },
        subject: { type: "string", description: "Email subject" },
        text: { type: "string", description: "Plain text body" },
        html: { type: "string", description: "HTML body (optional)" },
        from: { type: "string", description: "Sender email (optional)" },
        cc: { type: "string", description: "CC recipients" },
        bcc: { type: "string", description: "BCC recipients" },
      },
      required: ["to", "subject", "text"],
    },
    handler: async (args) => {
      try {
        const result = await sendEmail(args);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: { code: "send_failed", message: err.message } };
      }
    },
  },
  {
    name: "email_send_template",
    description: "Send a templated email (notification, code_complete)",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API],
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", enum: ["simple", "notification", "code_complete"], description: "Template name" },
        data: { type: "object", description: "Template data" },
        to: { type: "string", description: "Recipient" },
      },
      required: ["template", "data", "to"],
    },
    handler: async (args) => {
      try {
        const result = await sendTemplatedEmail(args.template, args.data, { to: args.to });
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: { code: "send_failed", message: err.message } };
      }
    },
  },
  {
    name: "email_history",
    description: "Get sent email history",
    tags: [ToolTags.READ],
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
      },
    },
    handler: async (args) => {
      return { ok: true, data: { emails: getHistory(args.limit || 10) } };
    },
  },
];

// ── Routes ───────────────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // Send email
  router.post("/send", async (req, res) => {
    try {
      const result = await sendEmail(req.body);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "send_failed", message: err.message } });
    }
  });

  // Send templated email
  router.post("/send-template", async (req, res) => {
    const { template, data, ...options } = req.body || {};

    if (!template || !data) {
      return res.status(400).json({
        ok: false,
        error: { code: "missing_params", message: "template and data are required" },
      });
    }

    try {
      const result = await sendTemplatedEmail(template, data, options);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: "send_failed", message: err.message } });
    }
  });

  // Get history
  router.get("/history", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    res.json({ ok: true, data: { emails: getHistory(limit) } });
  });

  // Health check
  router.get("/health", async (_req, res) => {
    const status = await verifyConnection();
    res.json({
      ok: status.ok,
      data: {
        configured: isConfigured(),
        connected: status.ok,
        error: status.error,
      },
    });
  });

  app.use("/email", router);
}
