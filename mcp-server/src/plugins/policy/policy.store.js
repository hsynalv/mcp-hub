/**
 * Policy store — JSON file storage for policy rules and approval queue.
 * Stored at: {CATALOG_CACHE_DIR}/policy.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

function storePath() {
  const dir = process.env.CATALOG_CACHE_DIR || "./cache";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "policy.json");
}

function load() {
  const p = storePath();
  if (!existsSync(p)) return { rules: [], approvals: [] };
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { rules: [], approvals: [] }; }
}

function save(data) {
  writeFileSync(storePath(), JSON.stringify(data, null, 2));
}

function makeId(prefix) {
  return `${prefix}-${createHash("sha256").update(String(Date.now() + Math.random())).digest("hex").slice(0, 8)}`;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export function listRules() {
  return load().rules;
}

export function getRule(id) {
  return load().rules.find((r) => r.id === id) ?? null;
}

export function addRule(rule) {
  const data = load();
  const id = rule.id ?? makeId("rule");
  const newRule = {
    id,
    pattern:     rule.pattern,
    action:      rule.action,
    scope:       rule.scope ?? "write",
    description: rule.description ?? "",
    limit:       rule.limit,
    window:      rule.window,
    enabled:     rule.enabled ?? true,
    createdAt:   new Date().toISOString(),
  };
  data.rules.push(newRule);
  save(data);
  return newRule;
}

export function removeRule(id) {
  const data = load();
  const idx = data.rules.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  data.rules.splice(idx, 1);
  save(data);
  return true;
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export function listApprovals({ status } = {}) {
  const data = load();
  const approvals = data.approvals ?? [];
  return status ? approvals.filter((a) => a.status === status) : approvals;
}

export function createApproval({ ruleId, path, method, body, requestedBy }) {
  const data = load();
  data.approvals ??= [];

  const approval = {
    id:          makeId("approval"),
    ruleId,
    path,
    method,
    body:        body ?? null,
    requestedBy: requestedBy ?? "agent",
    status:      "pending",
    createdAt:   new Date().toISOString(),
    decidedAt:   null,
    decidedBy:   null,
  };
  data.approvals.push(approval);
  save(data);
  return approval;
}

export function updateApprovalStatus(id, status, decidedBy = "manual") {
  const data = load();
  const approval = (data.approvals ?? []).find((a) => a.id === id);
  if (!approval) return null;

  approval.status    = status;
  approval.decidedAt = new Date().toISOString();
  approval.decidedBy = decidedBy;
  save(data);
  return approval;
}

// ─── Rate limit counters ───────────────────────────────────────────────────────

const rateCounters = new Map(); // ruleId → { count, windowStart }

export function checkPolicyRateLimit(rule) {
  if (!rule.limit || !rule.window) return { allowed: true };

  const windowMs = parseWindow(rule.window);
  const now = Date.now();

  if (!rateCounters.has(rule.id)) {
    rateCounters.set(rule.id, { count: 1, windowStart: now });
    return { allowed: true };
  }

  const state = rateCounters.get(rule.id);
  if (now - state.windowStart > windowMs) {
    state.count = 1;
    state.windowStart = now;
    return { allowed: true };
  }

  if (state.count >= rule.limit) {
    return { allowed: false, reason: "policy_rate_limit", rule: rule.id, limit: rule.limit, window: rule.window };
  }

  state.count += 1;
  return { allowed: true };
}

function parseWindow(window) {
  if (window === "1m")  return 60_000;
  if (window === "1h")  return 3_600_000;
  if (window === "1d")  return 86_400_000;
  // Parse "Nd" / "Nh" / "Nm"
  const m = String(window).match(/^(\d+)(m|h|d)$/);
  if (m) {
    const n = parseInt(m[1]);
    if (m[2] === "m") return n * 60_000;
    if (m[2] === "h") return n * 3_600_000;
    if (m[2] === "d") return n * 86_400_000;
  }
  return 60_000;
}
