import { Router } from "express";
import { z } from "zod";
import {
  githubRequest,
  githubPaginate,
  createPullRequest,
  listPullRequests,
  getPullRequest,
  createPRComment,
  createBranch,
  getFileContent,
} from "./github.client.js";
import { validateBody, validateQuery } from "../../core/validate.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";
import { auditLog } from "../../core/audit.js";
import { createMetadata, PluginStatus, RiskLevel } from "../../core/plugins/index.js";

const pluginError = createPluginErrorHandler("github");

// ── Plugin metadata ───────────────────────────────────────────────────────────

export const metadata = createMetadata({
  name: "github",
  version: "1.1.0",
  description: "GitHub repository management — read access + PR/branch/comment write operations",
  status: PluginStatus.STABLE,
  capabilities: ["read", "write"],
  riskLevel: RiskLevel.MEDIUM,
  owner: "platform-team",
  requiresAuth: false,
  supportsAudit: true,
  tags: ["github", "git", "vcs", "repository", "pull-request"],
  requires: [],
  since: "1.0.0",
  notes: "GITHUB_TOKEN is optional for public repos. Required for private repos and write operations.",
});

export const name        = "github";
export const version     = "1.1.0";
export const description = "GitHub repository management — read access + PR/branch/comment write operations";
export const capabilities = ["read", "write"];
export const requires    = [];

export const endpoints = [
  { method: "GET",  path: "/github/repos",                               description: "List authenticated user repos",             scope: "read"  },
  { method: "GET",  path: "/github/users/:username/repos",               description: "List public repos for any user/org",        scope: "read"  },
  { method: "GET",  path: "/github/analyze",                             description: "Full repo snapshot (flat, AI-friendly)",    scope: "read"  },
  { method: "POST", path: "/github/analyze",                             description: "Full repo snapshot (POST variant)",         scope: "read"  },
  { method: "GET",  path: "/github/repo/:owner/:repo",                   description: "Repo metadata",                             scope: "read"  },
  { method: "GET",  path: "/github/repo/:owner/:repo/analyze",           description: "Full repo snapshot (path params)",          scope: "read"  },
  { method: "GET",  path: "/github/repo/:owner/:repo/tree",              description: "File tree",                                 scope: "read"  },
  { method: "GET",  path: "/github/repo/:owner/:repo/file",              description: "File content",                              scope: "read"  },
  { method: "GET",  path: "/github/repo/:owner/:repo/commits",           description: "Recent commits",                            scope: "read"  },
  { method: "GET",  path: "/github/repo/:owner/:repo/issues",            description: "Open issues and PRs",                       scope: "read"  },
  { method: "GET",  path: "/github/repo/:owner/:repo/pulls",             description: "List pull requests",                        scope: "read"  },
  { method: "POST", path: "/github/repo/:owner/:repo/pulls",             description: "Create a pull request",                    scope: "write" },
  { method: "POST", path: "/github/repo/:owner/:repo/pulls/:n/comments", description: "Comment on a pull request",                scope: "write" },
  { method: "POST", path: "/github/repo/:owner/:repo/branches",          description: "Create a new branch",                      scope: "write" },
];

export const examples = [
  "GET /github/repos?sort=pushed&limit=20",
  "GET /github/analyze?repo=hsynalv/mcp-hub",
  'POST /github/repo/owner/repo/pulls body: {"title":"Fix bug","head":"fix/bug","base":"main"}',
];

// ── In-memory cache for analyzeRepo (5-minute TTL) ───────────────────────────

const repoCache = new Map(); // key: "owner/repo", value: { data, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  const entry = repoCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  repoCache.delete(key);
  return null;
}

function setCache(key, data) {
  repoCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const repoParamSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const analyzeQuerySchema = z.object({
  repo: z.string().min(1),
});

const analyzeBodySchema = z.object({
  repo: z.string().min(1),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(res, status, error, message, details) {
  return res.status(status).json({ ok: false, error, message, details });
}

function repoParams(req, res) {
  const parsed = repoParamSchema.safeParse(req.params);
  if (!parsed.success) {
    err(res, 400, "invalid_params", "owner and repo are required");
    return null;
  }
  return parsed.data;
}

function githubAudit(req, operation, success, meta = {}) {
  auditLog({
    plugin: "github",
    operation,
    actor: req.actor || req.user?.id || "anonymous",
    projectId: req.projectId || null,
    allowed: true,
    success,
    metadata: meta,
  });
}

function formatRepo(r) {
  return {
    id: r.id,
    fullName: r.full_name,
    description: r.description ?? null,
    language: r.language ?? null,
    topics: r.topics ?? [],
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    defaultBranch: r.default_branch,
    private: r.private,
    url: r.html_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
  };
}

function formatCommit(c) {
  return {
    sha: c.sha?.slice(0, 7),
    message: c.commit?.message?.split("\n")[0] ?? "",
    author: c.commit?.author?.name ?? null,
    date: c.commit?.author?.date ?? null,
    url: c.html_url,
  };
}

function formatIssue(i) {
  return {
    number: i.number,
    title: i.title,
    state: i.state,
    labels: (i.labels ?? []).map((l) => l.name),
    author: i.user?.login ?? null,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    url: i.html_url,
    isPR: !!i.pull_request,
  };
}

function formatTreeItem(item) {
  return {
    path: item.path,
    type: item.type, // "blob" | "tree"
    size: item.size ?? null,
  };
}

// ── Tool handlers (shared between REST and MCP) ───────────────────────────────

async function analyzeRepo(owner, repo) {
  const cacheKey = `${owner}/${repo}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const base = `/repos/${owner}/${repo}`;

  const [repoRes, commitsRes, issuesRes, readmeRes] = await Promise.all([
    githubRequest("GET", base),
    githubPaginate(`${base}/commits?per_page=15`, 15),
    githubPaginate(`${base}/issues?state=open&per_page=20`, 20),
    githubRequest("GET", `${base}/readme`).catch(() => ({ ok: false })),
  ]);

  if (!repoRes.ok) {
    throw pluginError.external("GitHub API", repoRes.error || "Failed to fetch repo");
  }

  const branch = repoRes.data.default_branch;
  const treeRes = await githubRequest("GET", `${base}/git/trees/${branch}?recursive=1`);

  let readme = null;
  if (readmeRes.ok && readmeRes.data?.content) {
    try {
      const full = Buffer.from(readmeRes.data.content, "base64").toString("utf8");
      readme = full.length > 3000 ? full.slice(0, 3000) + "\n\n[...truncated...]" : full;
    } catch {
      readme = null;
    }
  }

  const tree = (treeRes.data?.tree ?? [])
    .filter((item) => item.path.split("/").length <= 3)
    .map(formatTreeItem);

  const issues = (issuesRes.data ?? []).map(formatIssue).filter((i) => !i.isPR);
  const prs    = (issuesRes.data ?? []).map(formatIssue).filter((i) => i.isPR);

  const result = {
    repo: formatRepo(repoRes.data),
    tree: { branch, count: tree.length, items: tree },
    commits: { count: commitsRes.data?.length ?? 0, items: (commitsRes.data ?? []).map(formatCommit) },
    issues: { open: issues.length, items: issues.slice(0, 20) },
    pullRequests: { open: prs.length, items: prs.slice(0, 10) },
    readme,
    rateLimit: repoRes.rateLimit ?? null,
  };

  setCache(cacheKey, result);
  return result;
}

async function listUserRepos(type = "owner", sort = "pushed", limit = 30) {
  const result = await githubPaginate(
    `/user/repos?type=${type}&sort=${sort}&direction=desc`,
    Math.min(limit, 100)
  );
  if (!result.ok) {
    throw pluginError.external("GitHub API", result.error || "Failed to list repos");
  }
  return {
    count: result.data.length,
    repos: result.data.map(formatRepo),
    rateLimit: result.rateLimit ?? null,
  };
}

function parseRepo(raw) {
  const parts = raw.replace("https://github.com/", "").replace(/\/$/, "").split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

// ── MCP Tools ─────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: "github_analyze_repo",
    description: "Analyze a GitHub repository and return metadata, file tree, commits, issues, and README. Results are cached for 5 minutes.",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository name in owner/repo format (e.g. 'hsynalv/mcp-hub') or full GitHub URL",
        },
      },
      required: ["repo"],
    },
    handler: async (args) => {
      const parsed = parseRepo(args.repo);
      if (!parsed) {
        return { ok: false, error: { code: "invalid_repo", message: 'Provide repo in "owner/repo" format' } };
      }
      const data = await analyzeRepo(parsed.owner, parsed.repo);
      return { ok: true, data };
    },
  },
  {
    name: "github_list_repos",
    description: "List repositories for the authenticated GitHub user",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        type:  { type: "string", enum: ["all", "owner", "member"], default: "owner" },
        sort:  { type: "string", enum: ["created", "updated", "pushed", "full_name"], default: "pushed" },
        limit: { type: "number", default: 30, minimum: 1, maximum: 100 },
      },
    },
    handler: async (args) => {
      const data = await listUserRepos(args.type || "owner", args.sort || "pushed", args.limit || 30);
      return { ok: true, data };
    },
  },
  {
    name: "github_get_file",
    description: "Get the decoded text content of a specific file from a GitHub repository",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo:   { type: "string", description: "Repository in owner/repo format" },
        path:   { type: "string", description: "File path, e.g. 'src/index.js' or 'README.md'" },
        branch: { type: "string", description: "Branch name (default: repo default branch)" },
      },
      required: ["repo", "path"],
    },
    handler: async (args) => {
      const parsed = parseRepo(args.repo);
      if (!parsed) {
        return { ok: false, error: { code: "invalid_repo", message: 'Provide repo in "owner/repo" format' } };
      }
      const result = await getFileContent(parsed.owner, parsed.repo, args.path, args.branch);
      if (!result.ok) return result;

      const data = result.data;
      if (Array.isArray(data)) {
        return { ok: true, data: { type: "directory", items: data.map(f => ({ name: f.name, type: f.type, path: f.path, size: f.size })) } };
      }

      let content = null;
      if (data.encoding === "base64" && data.content) {
        try {
          const raw = Buffer.from(data.content, "base64").toString("utf8");
          content = raw.length > 50_000 ? raw.slice(0, 50_000) + "\n\n[...truncated — file too large...]" : raw;
        } catch {
          content = "[binary file — cannot decode as text]";
        }
      }

      return { ok: true, data: { type: "file", path: data.path, size: data.size, content, url: data.html_url, rateLimit: result.rateLimit } };
    },
  },
  {
    name: "github_pr_create",
    description: "Create a pull request. Requires GITHUB_TOKEN with write access.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo:  { type: "string", description: "Repository in owner/repo format" },
        title: { type: "string", description: "PR title" },
        body:  { type: "string", description: "PR description" },
        head:  { type: "string", description: "Branch with changes" },
        base:  { type: "string", description: "Target branch", default: "main" },
        explanation: { type: "string", description: "Explain the purpose of this PR" },
      },
      required: ["repo", "title", "head", "explanation"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      const [owner, repo] = parts;
      const result = await createPullRequest(owner, repo, { title: args.title, body: args.body, head: args.head, base: args.base || "main" });
      if (!result.ok) return result;
      return { ok: true, data: { prNumber: result.data.number, url: result.data.html_url } };
    },
  },
  {
    name: "github_pr_list",
    description: "List pull requests for a repository",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo:  { type: "string", description: "Repository in owner/repo format" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        limit: { type: "number", default: 30 },
      },
      required: ["repo"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      return listPullRequests(parts[0], parts[1], { state: args.state, limit: args.limit });
    },
  },
  {
    name: "github_branch_create",
    description: "Create a new branch from an existing branch or commit SHA. Requires GITHUB_TOKEN.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo:   { type: "string", description: "Repository in owner/repo format" },
        branch: { type: "string", description: "New branch name" },
        base:   { type: "string", description: "Base branch or SHA", default: "main" },
        explanation: { type: "string", description: "Explain why you are creating this branch" },
      },
      required: ["repo", "branch", "explanation"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      return createBranch(parts[0], parts[1], args.branch, args.base || "main");
    },
  },
  {
    name: "github_pr_comment",
    description: "Add a comment to a pull request. Requires GITHUB_TOKEN.",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/repo format" },
        pr:   { type: "number", description: "PR number" },
        body: { type: "string", description: "Comment text" },
        explanation: { type: "string", description: "Explain the purpose of this comment" },
      },
      required: ["repo", "pr", "body", "explanation"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      return createPRComment(parts[0], parts[1], args.pr, args.body);
    },
  },
];

// ── Plugin register ───────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // ── User repos ──────────────────────────────────────────────────────────────

  /**
   * GET /github/repos
   * List repos for the authenticated user. Requires GITHUB_TOKEN.
   *
   * Query: type=all|owner|member  sort=created|updated|pushed|full_name  limit=30
   */
  router.get("/repos", async (req, res) => {
    const type  = req.query.type  ?? "owner";
    const sort  = req.query.sort  ?? "pushed";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await githubPaginate(`/user/repos?type=${type}&sort=${sort}&direction=desc`, limit);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, count: result.data.length, repos: result.data.map(formatRepo), rateLimit: result.rateLimit });
  });

  // ── List repos for a specific user/org ──────────────────────────────────────

  /**
   * GET /github/users/:username/repos
   * List public repos for any GitHub user or organization.
   */
  router.get("/users/:username/repos", async (req, res) => {
    const username = req.params.username?.trim();
    if (!username) return err(res, 400, "invalid_username", "Provide a GitHub username");

    const sort  = req.query.sort  ?? "pushed";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await githubPaginate(`/users/${encodeURIComponent(username)}/repos?sort=${sort}&direction=desc`, limit);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, username, count: result.data.length, repos: result.data.map(formatRepo), rateLimit: result.rateLimit });
  });

  // ── Repo summary ────────────────────────────────────────────────────────────

  router.get("/repo/:owner/:repo", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const result = await githubRequest("GET", `/repos/${p.owner}/${p.repo}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, repo: formatRepo(result.data), rateLimit: result.rateLimit });
  });

  // ── File tree ───────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/tree
   * Query: branch=main  depth=3
   */
  router.get("/repo/:owner/:repo/tree", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    let branch = req.query.branch;
    if (!branch) {
      const repoRes = await githubRequest("GET", `/repos/${p.owner}/${p.repo}`);
      if (!repoRes.ok) return err(res, 502, repoRes.error, repoRes.details?.message, repoRes.details);
      branch = repoRes.data.default_branch;
    }

    const result = await githubRequest("GET", `/repos/${p.owner}/${p.repo}/git/trees/${branch}?recursive=1`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const maxDepth = Number(req.query.depth ?? 3);
    const items = (result.data.tree ?? [])
      .filter((item) => item.path.split("/").length <= maxDepth)
      .map(formatTreeItem);

    res.json({ ok: true, branch, count: items.length, truncated: result.data.truncated ?? false, tree: items, rateLimit: result.rateLimit });
  });

  // ── File content ────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/file
   * Query: path=src/index.js  branch=main
   */
  router.get("/repo/:owner/:repo/file", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const filePath = req.query.path;
    if (!filePath) return err(res, 400, "invalid_query", "?path= is required");

    const result = await getFileContent(p.owner, p.repo, filePath, req.query.branch);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const data = result.data;
    if (Array.isArray(data)) {
      return res.json({ ok: true, type: "directory", items: data.map((f) => ({ name: f.name, type: f.type, path: f.path, size: f.size })) });
    }

    let content = null;
    if (data.encoding === "base64" && data.content) {
      try {
        content = Buffer.from(data.content, "base64").toString("utf8");
      } catch {
        content = "[binary file — cannot decode as text]";
      }
    }

    res.json({ ok: true, type: "file", path: data.path, size: data.size, encoding: data.encoding, content, url: data.html_url, rateLimit: result.rateLimit });
  });

  // ── Commits ─────────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/commits
   * Query: branch=main  limit=20  path=src/index.js
   */
  router.get("/repo/:owner/:repo/commits", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    let qs = `per_page=${limit}`;
    if (req.query.branch) qs += `&sha=${req.query.branch}`;
    if (req.query.path)   qs += `&path=${encodeURIComponent(req.query.path)}`;

    const result = await githubPaginate(`/repos/${p.owner}/${p.repo}/commits?${qs}`, limit);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, count: result.data.length, commits: result.data.map(formatCommit), rateLimit: result.rateLimit });
  });

  // ── Issues & PRs ────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/issues
   * Query: state=open|closed|all  type=issues|prs|all  limit=30
   */
  router.get("/repo/:owner/:repo/issues", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const state = req.query.state ?? "open";
    const type  = req.query.type  ?? "issues";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await githubPaginate(`/repos/${p.owner}/${p.repo}/issues?state=${state}&per_page=${limit}`, limit);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    let items = result.data.map(formatIssue);
    if (type === "issues") items = items.filter((i) => !i.isPR);
    else if (type === "prs") items = items.filter((i) => i.isPR);

    res.json({ ok: true, count: items.length, issues: items, rateLimit: result.rateLimit });
  });

  // ── Repo analysis ────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/analyze
   * Combined repo snapshot — cached 5 minutes.
   */
  router.get("/repo/:owner/:repo/analyze", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    try {
      const data = await analyzeRepo(p.owner, p.repo);
      res.json({ ok: true, ...data });
    } catch (e) {
      err(res, 502, "analysis_failed", e.message);
    }
  });

  /**
   * GET /github/analyze?repo=owner/repo
   * POST /github/analyze  body: { "repo": "owner/repo" }
   * AI-friendly flat endpoint — no path params needed.
   */
  router.get("/analyze", validateQuery(analyzeQuerySchema), async (req, res) => {
    const parsed = parseRepo(req.validatedQuery.repo);
    if (!parsed) return err(res, 400, "invalid_repo", 'Provide ?repo=owner/repo e.g. ?repo=expressjs/express');

    try {
      const data = await analyzeRepo(parsed.owner, parsed.repo);
      res.json({ ok: true, ...data });
    } catch (e) {
      err(res, 502, "analysis_failed", e.message);
    }
  });

  router.post("/analyze", validateBody(analyzeBodySchema), async (req, res) => {
    const parsed = parseRepo(req.validatedBody.repo);
    if (!parsed) return err(res, 400, "invalid_repo", 'Provide { "repo": "owner/repo" }');

    try {
      const data = await analyzeRepo(parsed.owner, parsed.repo);
      res.json({ ok: true, ...data });
    } catch (e) {
      err(res, 502, "analysis_failed", e.message);
    }
  });

  // ── Pull Requests ────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/pulls
   * Query: state=open|closed|all  limit=30
   */
  router.get("/repo/:owner/:repo/pulls", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const state = req.query.state ?? "open";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await listPullRequests(p.owner, p.repo, { state, limit });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, count: result.data.length, pulls: result.data, rateLimit: result.rateLimit });
  });

  /**
   * POST /github/repo/:owner/:repo/pulls
   * Body: { title, body?, head, base? }
   */
  router.post("/repo/:owner/:repo/pulls", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const { title, body, head, base } = req.body;
    if (!title || !head) return err(res, 400, "missing_fields", "title and head are required");

    const result = await createPullRequest(p.owner, p.repo, { title, body: body || "", head, base: base || "main" });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    githubAudit(req, "create_pull_request", true, { repo: `${p.owner}/${p.repo}`, pr: result.data.number, title });
    res.json({ ok: true, pull: { number: result.data.number, url: result.data.html_url, title: result.data.title } });
  });

  /**
   * POST /github/repo/:owner/:repo/pulls/:number/comments
   * Body: { body }
   */
  router.post("/repo/:owner/:repo/pulls/:number/comments", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const number = parseInt(req.params.number, 10);
    const { body } = req.body;
    if (!body) return err(res, 400, "missing_body", "Comment body is required");

    const result = await createPRComment(p.owner, p.repo, number, body);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    githubAudit(req, "create_pr_comment", true, { repo: `${p.owner}/${p.repo}`, pr: number });
    res.json({ ok: true, comment: { id: result.data.id, url: result.data.html_url } });
  });

  // ── Branches ────────────────────────────────────────────────────────────────

  /**
   * POST /github/repo/:owner/:repo/branches
   * Body: { name, base? }
   */
  router.post("/repo/:owner/:repo/branches", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const { name: branchName, base } = req.body;
    if (!branchName) return err(res, 400, "missing_name", "Branch name is required");

    const result = await createBranch(p.owner, p.repo, branchName, base || "main");
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    githubAudit(req, "create_branch", true, { repo: `${p.owner}/${p.repo}`, branch: branchName, base: base || "main" });
    res.json({ ok: true, branch: { name: branchName, sha: result.data?.object?.sha ?? null } });
  });

  // ── PR detail ────────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/pulls/:number
   */
  router.get("/repo/:owner/:repo/pulls/:number", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const number = parseInt(req.params.number, 10);
    const result = await getPullRequest(p.owner, p.repo, number);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, pull: result.data });
  });

  app.use("/github", router);
}
