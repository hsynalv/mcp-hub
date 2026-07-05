/**
 * User auth REST routes: register, login, logout, refresh, me
 */

import { Router } from "express";
import { z } from "zod";
import { rateLimitMiddleware } from "../ratelimit.js";
import {
  createUser,
  verifyUserCredentials,
  findUserById,
  invalidateUsersExistCache,
  changeUserPassword,
  updateUserDisplayName,
} from "./users.service.js";
import {
  createSession,
  rotateSessionByRefresh,
  revokeSessionByToken,
  SESSION_TTL_MS,
  REFRESH_TTL_MS,
} from "./sessions.service.js";
import {
  getCookie,
  setAuthCookies,
  clearAuthCookies,
  SESSION_COOKIE,
  REFRESH_COOKIE,
} from "./cookies.js";
import { auditLog } from "../audit/index.js";
import { refreshAuthEnabledState } from "../auth.js";

const authRateLimit = rateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 10,
  keyGenerator: (req) => `auth:${req.ip ?? "unknown"}`,
});

const registerSchema = z.object({
  email: z.string().email().max(256),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).max(128).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(256),
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

const profileSchema = z.object({
  displayName: z.string().min(1).max(128),
});

function requireSessionUser(req, res) {
  if (!req.user?.userId) {
    res.status(401).json({
      ok: false,
      error: { code: "unauthorized", message: "Oturum gerekli" },
    });
    return null;
  }
  return req.user;
}

function clientMeta(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null,
  };
}

async function issueSessionResponse(res, userId, req) {
  const meta = clientMeta(req);
  const tokens = await createSession({ userId, ...meta });
  setAuthCookies(res, {
    sessionToken: tokens.sessionToken,
    refreshToken: tokens.refreshToken,
    sessionMaxAgeMs: SESSION_TTL_MS,
    refreshMaxAgeMs: REFRESH_TTL_MS,
  });
  const user = await findUserById(userId);
  return user;
}

export function registerAuthRoutes(app) {
  const router = Router();

  router.get("/me", async (req, res) => {
    if (!req.user) {
      return res.status(401).json({
        ok: false,
        error: { code: "unauthorized", message: "Oturum gerekli" },
      });
    }
    const userAuthEnabled = await refreshAuthEnabledState();
    res.json({
      ok: true,
      data: {
        user: {
          id: req.user.userId,
          email: req.user.email,
          displayName: req.user.displayName,
          role: req.user.role,
          namespace: req.user.namespace,
        },
        auth: {
          mode: userAuthEnabled ? "users" : "keys",
          scopes: req.user.scopes ?? req.authScopes ?? [],
        },
      },
    });
  });

  router.post("/register", authRateLimit, async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: { code: "validation_error", message: parsed.error.errors[0]?.message },
        });
      }
      const user = await createUser(parsed.data);
      invalidateUsersExistCache();
      await refreshAuthEnabledState();
      await issueSessionResponse(res, user.id, req);
      await auditLog({
        eventType: "auth",
        operation: "register",
        plugin: "hub",
        actor: `user:${user.email}`,
        allowed: true,
        success: true,
      });
      res.status(201).json({
        ok: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            namespace: user.namespace,
          },
        },
      });
    } catch (err) {
      const code = err.code || "register_failed";
      const status = code === "email_taken" ? 409 : code === "invalid_password" ? 400 : 500;
      res.status(status).json({
        ok: false,
        error: { code, message: err.message },
      });
    }
  });

  router.post("/login", authRateLimit, async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: { code: "validation_error", message: "Geçersiz e-posta veya şifre" },
        });
      }
      const user = await verifyUserCredentials(parsed.data.email, parsed.data.password);
      if (!user) {
        await auditLog({
          eventType: "auth",
          operation: "login_failed",
          plugin: "hub",
          actor: parsed.data.email,
          allowed: true,
          success: false,
        });
        return res.status(401).json({
          ok: false,
          error: { code: "invalid_credentials", message: "E-posta veya şifre hatalı" },
        });
      }
      await issueSessionResponse(res, user.id, req);
      await auditLog({
        eventType: "auth",
        operation: "login",
        plugin: "hub",
        actor: `user:${user.email}`,
        allowed: true,
        success: true,
      });
      res.json({
        ok: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            namespace: user.namespace,
          },
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: { code: "login_failed", message: err.message },
      });
    }
  });

  router.post("/logout", async (req, res) => {
    const sessionToken = getCookie(req, SESSION_COOKIE);
    if (sessionToken) {
      await revokeSessionByToken(sessionToken);
    }
    clearAuthCookies(res);
    res.json({ ok: true, data: { loggedOut: true } });
  });

  router.put("/profile", async (req, res) => {
    const sessionUser = requireSessionUser(req, res);
    if (!sessionUser) return;
    try {
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: { code: "validation_error", message: parsed.error.errors[0]?.message },
        });
      }
      const user = await updateUserDisplayName(sessionUser.userId, parsed.data.displayName);
      res.json({
        ok: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            namespace: user.namespace,
          },
        },
      });
    } catch (err) {
      res.status(err.code === "invalid_display_name" ? 400 : 500).json({
        ok: false,
        error: { code: err.code || "profile_update_failed", message: err.message },
      });
    }
  });

  router.post("/change-password", authRateLimit, async (req, res) => {
    const sessionUser = requireSessionUser(req, res);
    if (!sessionUser) return;
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: { code: "validation_error", message: parsed.error.errors[0]?.message },
        });
      }
      await changeUserPassword(
        sessionUser.userId,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      await auditLog({
        eventType: "auth",
        operation: "password_change",
        plugin: "hub",
        actor: `user:${sessionUser.email}`,
        allowed: true,
        success: true,
      });
      res.json({ ok: true, data: { changed: true } });
    } catch (err) {
      const status =
        err.code === "invalid_credentials" ? 401 : err.code === "invalid_password" ? 400 : 500;
      res.status(status).json({
        ok: false,
        error: { code: err.code || "password_change_failed", message: err.message },
      });
    }
  });

  router.post("/refresh", authRateLimit, async (req, res) => {
    const refreshToken = getCookie(req, REFRESH_COOKIE);
    if (!refreshToken) {
      return res.status(401).json({
        ok: false,
        error: { code: "no_refresh_token", message: "Yenileme token'ı yok" },
      });
    }
    const rotated = await rotateSessionByRefresh(refreshToken, clientMeta(req));
    if (!rotated) {
      clearAuthCookies(res);
      return res.status(401).json({
        ok: false,
        error: { code: "invalid_refresh", message: "Oturum süresi doldu, tekrar giriş yapın" },
      });
    }
    setAuthCookies(res, {
      sessionToken: rotated.sessionToken,
      refreshToken: rotated.refreshToken,
      sessionMaxAgeMs: SESSION_TTL_MS,
      refreshMaxAgeMs: REFRESH_TTL_MS,
    });
    res.json({ ok: true, data: { refreshed: true } });
  });

  app.use("/auth", router);
}
