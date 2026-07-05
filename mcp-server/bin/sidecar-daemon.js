#!/usr/bin/env node
/**
 * Felix Desktop local agent daemon (legacy CLI: mcp-hub-sidecar) — filesystem, terminal, desktop notify on localhost.
 *
 * Usage:
 *   npm run sidecar:daemon
 *   SIDECAR_AUTH_TOKEN=<from-pairing> npm run sidecar:daemon
 *   # or write token to ~/.config/felix-desktop/env and run npm run sidecar:daemon
 */

import { loadFelixDesktopEnv } from "../src/core/sidecar/load-desktop-env.js";

const envLoad = loadFelixDesktopEnv();
if (envLoad.loaded && envLoad.keys > 0) {
  console.log(`[sidecar] Loaded ${envLoad.keys} var(s) from ${envLoad.path}`);
}

import express from "express";
import os from "os";
import { fsList, fsRead, fsWrite, fsHash } from "../src/plugins/local-sidecar/sidecar.core.js";
import {
  fsStat,
  fsRecent,
  fsSearch,
  fsCopy,
  fsMove,
  fsDeleteToTrash,
} from "../src/plugins/local-sidecar/fs-pro.core.js";
import {
  createTerminalSession,
  execTerminalCommand,
  execInSession,
  closeTerminalSession,
  listTerminalSessions,
} from "../src/plugins/local-sidecar/terminal.core.js";
import { sendDesktopNotification } from "../src/plugins/local-sidecar/notify.core.js";
import {
  captureScreenshot,
  captureRegionScreenshot,
  captureWindowScreenshot,
  screenshotWithContextGuard,
  getActiveWindow,
  ocrScreenRegion,
  desktopClick,
  desktopType,
  desktopScroll,
  desktopHotkey,
  desktopDrag,
  desktopFocusApp,
} from "../src/plugins/local-sidecar/desktop.core.js";
import { clipboardRead, clipboardWrite } from "../src/plugins/local-sidecar/clipboard.core.js";
import {
  checkSidecarDependencies,
  checkDesktopPermissions,
} from "../src/plugins/local-sidecar/sidecar-health.core.js";
import {
  browserOpenUrl,
  browserSnapshot,
  browserScreenshot,
  browserExtractLinks,
  browserExtractTable,
  browserFindText,
  browserClick,
  browserType,
} from "../src/plugins/local-sidecar/browser.core.js";
import { validateSidecarRequest } from "../src/core/sidecar/sidecar-auth.js";
import { fsAccessOptsFromRequest } from "../src/plugins/local-sidecar/fs-access.js";

const port = Number(process.env.SIDECAR_PORT || 9477);
const bind = (process.env.SIDECAR_BIND || "127.0.0.1").trim();
const authToken = process.env.SIDECAR_AUTH_TOKEN || "";
const isLocalBind = bind === "127.0.0.1" || bind === "localhost" || bind === "::1";

if (!isLocalBind && !authToken) {
  console.error("[sidecar] SIDECAR_BIND is not localhost but SIDECAR_AUTH_TOKEN is empty.");
  console.error("");
  console.error("  Önce hub'dan eşleştir (daemon kapalı olabilir):");
  console.error("    1. https://asistan.huseyinalav.com → Ayarlar → Felix Desktop");
  console.error("    2. Kod oluştur → Cihaz eşleştir → baseUrl = SIDECAR_PUBLIC_URL");
  console.error("    3. authToken'ı ~/.config/felix-desktop/env → SIDECAR_AUTH_TOKEN=...");
  console.error("    4. Tekrar: npm run sidecar:daemon");
  console.error("");
  console.error("  Geliştirme için geçici: SIDECAR_BIND=127.0.0.1 (sadece bu Mac'ten erişilir)");
  process.exit(1);
}
const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (!validateSidecarRequest(req, authToken)) {
    return res.status(401).json({ ok: false, error: { code: "unauthorized", message: "Invalid sidecar token" } });
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    service: "mcp-hub-sidecar",
    platform: process.platform,
    hostname: os.hostname(),
    authRequired: Boolean(authToken),
    capabilities: ["fs", "terminal", "notify", "desktop", "browser"],
  });
});

app.get("/fs/list", async (req, res) => {
  res.json(await fsList(req.query.path || ".", fsAccessOptsFromRequest(req)));
});

app.get("/fs/read", async (req, res) => {
  if (!req.query.path) return res.status(400).json({ ok: false, error: "path required" });
  res.json(
    await fsRead(req.query.path, {
      maxSize: parseInt(req.query.maxSize, 10) || 1048576,
      ...fsAccessOptsFromRequest(req),
    })
  );
});

app.post("/fs/write", async (req, res) => {
  const { path, content } = req.body || {};
  if (!path || content === undefined) {
    return res.status(400).json({ ok: false, error: "path and content required" });
  }
  res.json(await fsWrite(path, content, fsAccessOptsFromRequest(req)));
});

app.get("/fs/hash", async (req, res) => {
  if (!req.query.path) return res.status(400).json({ ok: false, error: "path required" });
  res.json(await fsHash(req.query.path, fsAccessOptsFromRequest(req)));
});

app.get("/fs/stat", async (req, res) => {
  if (!req.query.path) return res.status(400).json({ ok: false, error: "path required" });
  res.json(await fsStat(req.query.path, fsAccessOptsFromRequest(req)));
});

app.get("/fs/recent", async (req, res) => {
  res.json(
    await fsRecent(req.query.path || ".", {
      limit: parseInt(req.query.limit, 10) || 20,
      maxDepth: parseInt(req.query.maxDepth, 10) || 3,
      ...fsAccessOptsFromRequest(req),
    })
  );
});

app.get("/fs/search", async (req, res) => {
  res.json(
    await fsSearch(req.query.path || ".", {
      pattern: req.query.pattern,
      extension: req.query.extension,
      maxResults: parseInt(req.query.maxResults, 10) || 50,
      maxDepth: parseInt(req.query.maxDepth, 10) || 4,
      ...fsAccessOptsFromRequest(req),
    })
  );
});

app.post("/fs/copy", async (req, res) => {
  const { source, destination } = req.body || {};
  if (!source || !destination) {
    return res.status(400).json({ ok: false, error: "source and destination required" });
  }
  res.json(await fsCopy(source, destination, fsAccessOptsFromRequest(req)));
});

app.post("/fs/move", async (req, res) => {
  const { source, destination } = req.body || {};
  if (!source || !destination) {
    return res.status(400).json({ ok: false, error: "source and destination required" });
  }
  res.json(await fsMove(source, destination, fsAccessOptsFromRequest(req)));
});

app.post("/fs/delete-to-trash", async (req, res) => {
  const { path } = req.body || {};
  if (!path) return res.status(400).json({ ok: false, error: "path required" });
  res.json(await fsDeleteToTrash(path, fsAccessOptsFromRequest(req)));
});

app.post("/terminal/sessions", (req, res) => {
  const session = createTerminalSession({ cwd: req.body?.cwd || process.cwd() });
  res.json({ ok: true, data: session });
});

app.get("/terminal/sessions", (_req, res) => {
  res.json({ ok: true, data: { sessions: listTerminalSessions() } });
});

app.post("/terminal/sessions/:id/exec", async (req, res) => {
  const result = await execInSession(req.params.id, req.body?.command, {
    timeoutMs: req.body?.timeoutMs || 30_000,
  });
  res.json(result);
});

app.delete("/terminal/sessions/:id", (req, res) => {
  const removed = closeTerminalSession(req.params.id);
  res.json({ ok: removed, deleted: removed ? req.params.id : null });
});

app.post("/terminal/exec", async (req, res) => {
  const result = await execTerminalCommand(req.body?.command, {
    cwd: req.body?.cwd,
    timeoutMs: req.body?.timeoutMs || 30_000,
  });
  res.json(result);
});

app.post("/notify", async (req, res) => {
  res.json(await sendDesktopNotification(req.body || {}));
});

app.get("/desktop/screenshot", async (req, res) => {
  const shot = await captureScreenshot({ format: req.query.format || "png" });
  res.json(await screenshotWithContextGuard(shot));
});

app.get("/desktop/screenshot/region", async (req, res) => {
  const { x, y, width, height, format } = req.query;
  const shot = await captureRegionScreenshot({
    x: parseInt(x, 10),
    y: parseInt(y, 10),
    width: parseInt(width, 10),
    height: parseInt(height, 10),
    format: format || "png",
  });
  res.json(await screenshotWithContextGuard(shot));
});

app.get("/desktop/screenshot/window", async (req, res) => {
  const shot = await captureWindowScreenshot({ format: req.query.format || "png" });
  res.json(await screenshotWithContextGuard(shot));
});

app.get("/desktop/active-window", async (_req, res) => {
  res.json(await getActiveWindow());
});

app.post("/desktop/ocr", async (req, res) => {
  res.json(await ocrScreenRegion(req.body || {}));
});

app.post("/desktop/click", async (req, res) => {
  const { x, y, button } = req.body || {};
  res.json(await desktopClick({ x, y, button }));
});

app.post("/desktop/type", async (req, res) => {
  res.json(await desktopType(req.body || {}));
});

app.post("/desktop/scroll", async (req, res) => {
  res.json(await desktopScroll(req.body || {}));
});

app.post("/desktop/hotkey", async (req, res) => {
  res.json(await desktopHotkey(req.body || {}));
});

app.post("/desktop/drag", async (req, res) => {
  res.json(await desktopDrag(req.body || {}));
});

app.post("/desktop/focus-app", async (req, res) => {
  res.json(await desktopFocusApp(req.body || {}));
});

app.get("/clipboard/read", async (_req, res) => {
  res.json(await clipboardRead());
});

app.post("/clipboard/write", async (req, res) => {
  res.json(await clipboardWrite(req.body || {}));
});

app.get("/health/dependencies", async (_req, res) => {
  res.json(await checkSidecarDependencies());
});

app.get("/desktop/permissions", async (_req, res) => {
  res.json(await checkDesktopPermissions());
});

app.post("/browser/open", async (req, res) => {
  res.json(await browserOpenUrl(req.body || {}));
});

app.get("/browser/snapshot", async (_req, res) => {
  res.json(await browserSnapshot());
});

app.get("/browser/screenshot", async (_req, res) => {
  res.json(await browserScreenshot());
});

app.get("/browser/extract-links", async (req, res) => {
  res.json(await browserExtractLinks({ maxLinks: parseInt(req.query.maxLinks, 10) || 50 }));
});

app.get("/browser/extract-table", async (req, res) => {
  res.json(await browserExtractTable({ maxTables: parseInt(req.query.maxTables, 10) || 3 }));
});

app.get("/browser/find-text", async (req, res) => {
  if (!req.query.query) return res.status(400).json({ ok: false, error: "query required" });
  res.json(
    await browserFindText({
      query: req.query.query,
      maxMatches: parseInt(req.query.maxMatches, 10) || 10,
    })
  );
});

app.post("/browser/click", async (req, res) => {
  res.json(await browserClick(req.body || {}));
});

app.post("/browser/type", async (req, res) => {
  res.json(await browserType(req.body || {}));
});

app.listen(port, bind, () => {
  const listenHost = bind === "0.0.0.0" ? "all interfaces" : bind;
  console.log(`[sidecar] listening on ${listenHost}:${port}`);
  console.log(`[sidecar] auth: ${authToken ? "enabled (SIDECAR_AUTH_TOKEN set)" : "disabled (dev only)"}`);
  const hub = process.env.FELIX_HUB_URL || process.env.HUB_URL || "";
  const publicUrl = process.env.SIDECAR_PUBLIC_URL || "";
  if (hub) {
    console.log(`[sidecar] hub: ${hub}`);
  }
  if (publicUrl) {
    console.log(`[sidecar] pair baseUrl: ${publicUrl.replace(/\/$/, "")}`);
  } else if (isLocalBind) {
    console.log(`[sidecar] Local health: curl http://127.0.0.1:${port}/health`);
    console.log(`[sidecar] Remote hub + static IP? Set SIDECAR_BIND=0.0.0.0 and SIDECAR_PUBLIC_URL=http://YOUR_IP:${port}`);
  } else {
    console.log(`[sidecar] Remote access enabled — pair with http://YOUR_PUBLIC_IP:${port} (or SIDECAR_PUBLIC_URL)`);
  }
});
