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
} from "./github.client.js";
import { validateBody, validateQuery } from "../../core/validate.js";
import { ToolTags } from "../../core/tool-registry.js";
import { createPluginErrorHandler } from "../../core/error-standard.js";

const pluginError = createPluginErrorHandler("github");

export const name = "github";
export const version = "1.0.0";
export const description = "Read access to public and private GitHub repositories";
export const capabilities = ["read"];
export const requires = ["GITHUB_TOKEN"];
export const endpoints = [
  { method: "GET",  path: "/github/repos",                       description: "List authenticated user repos (public + private)", scope: "read" },
  { method: "GET",  path: "/github/users/:username/repos",       description: "List public repos for any user/org",               scope: "read" },
  { method: "GET",  path: "/github/analyze",                     description: "Full repo snapshot (tree, commits, issues, readme)", scope: "read" },
  { method: "GET",  path: "/github/repo/:owner/:repo",           description: "Repo metadata",                                   scope: "read" },
  { method: "GET",  path: "/github/repo/:owner/:repo/tree",      description: "File tree",                                       scope: "read" },
  { method: "GET",  path: "/github/repo/:owner/:repo/file",      description: "File content",                                    scope: "read" },
  { method: "GET",  path: "/github/repo/:owner/:repo/commits",   description: "Recent commits",                                  scope: "read" },
  { method: "GET",  path: "/github/repo/:owner/:repo/issues",    description: "Open issues and PRs",                             scope: "read" },
];
export const examples = [
  "GET /github/repos?sort=pushed&limit=20",
  "GET /github/analyze?repo=hsynalv/mcp-hub",
];

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
  const prs = (issuesRes.data ?? []).map(formatIssue).filter((i) => i.isPR);

  return {
    repo: formatRepo(repoRes.data),
    tree: { branch, count: tree.length, items: tree },
    commits: { count: commitsRes.data?.length ?? 0, items: (commitsRes.data ?? []).map(formatCommit) },
    issues: { open: issues.length, items: issues.slice(0, 20) },
    pullRequests: { open: prs.length, items: prs.slice(0, 10) },
    readme,
  };
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
  };
}

// ── MCP Tools export ─────────────────────────────────────────────────────────

export const tools = [
  {
    name: "github_analyze_repo",
    description: "Analyze a GitHub repository and return metadata, tree, commits, issues, and README",
    tags: ["READ", "NETWORK", "EXTERNAL_API", "GIT"],
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository name in owner/repo format (e.g., 'hsynalv/mcp-hub')",
        },
      },
      required: ["repo"],
    },
    handler: async (args, context) => {
      const raw = args.repo.replace("https://github.com/", "").replace(/\/$/, "");
      const parts = raw.split("/");
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        return {
          ok: false,
          error: {
            code: "invalid_repo",
            message: 'Provide repo in "owner/repo" format',
          },
        };
      }
      const [owner, repo] = parts;
      const data = await analyzeRepo(owner, repo);
      return { ok: true, data };
    },
  },
  {
    name: "github_list_repos",
    description: "List repositories for the authenticated user",
    tags: [ToolTags.READ, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["all", "owner", "member"],
          default: "owner",
          description: "Filter by repository type",
        },
        sort: {
          type: "string",
          enum: ["created", "updated", "pushed", "full_name"],
          default: "pushed",
          description: "Sort field",
        },
        limit: {
          type: "number",
          default: 30,
          minimum: 1,
          maximum: 100,
          description: "Maximum number of repos to return",
        },
      },
    },
    handler: async (args, context) => {
      const data = await listUserRepos(
        args.type || "owner",
        args.sort || "pushed",
        args.limit || 30
      );
      return { ok: true, data };
    },
  },
  {
    name: "github_pr_create",
    description: "Create a pull request (requires approval for WRITE)",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/repo format" },
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR description" },
        head: { type: "string", description: "Branch with changes" },
        base: { type: "string", description: "Target branch", default: "main" },
      },
      required: ["repo", "title", "head"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) {
        return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      }
      const [owner, repo] = parts;
      const result = await createPullRequest(owner, repo, {
        title: args.title,
        body: args.body,
        head: args.head,
        base: args.base,
      });
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
        repo: { type: "string", description: "Repository in owner/repo format" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        limit: { type: "number", default: 30 },
      },
      required: ["repo"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) {
        return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      }
      return listPullRequests(parts[0], parts[1], { state: args.state, limit: args.limit });
    },
  },
  {
    name: "github_branch_create",
    description: "Create a new branch",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/repo format" },
        branch: { type: "string", description: "New branch name" },
        base: { type: "string", description: "Base branch or SHA", default: "main" },
      },
      required: ["repo", "branch"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) {
        return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      }
      return createBranch(parts[0], parts[1], args.branch, args.base);
    },
  },
  {
    name: "github_pr_comment",
    description: "Add a comment to a pull request",
    tags: [ToolTags.WRITE, ToolTags.NETWORK, ToolTags.EXTERNAL_API, ToolTags.GIT],
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository in owner/repo format" },
        pr: { type: "number", description: "PR number" },
        body: { type: "string", description: "Comment text" },
      },
      required: ["repo", "pr", "body"],
    },
    handler: async (args) => {
      const parts = args.repo.split("/");
      if (parts.length !== 2) {
        return { ok: false, error: { code: "invalid_repo", message: "Format: owner/repo" } };
      }
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
   * List repositories for the authenticated user (requires GITHUB_TOKEN).
   *
   * Query params:
   *   type    = all | owner | member (default: owner)
   *   sort    = created | updated | pushed | full_name (default: pushed)
   *   limit   = max results (default: 30)
   */
  router.get("/repos", async (req, res) => {
    const type = req.query.type ?? "owner";
    const sort = req.query.sort ?? "pushed";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await githubPaginate(
      `/user/repos?type=${type}&sort=${sort}&direction=desc`,
      limit
    );
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, count: result.data.length, repos: result.data.map(formatRepo) });
  });

  // ── List repos for a specific user/org ──────────────────────────────────────

  /**
   * GET /github/users/:username/repos
   * List public repos for any GitHub user or organization.
   * Query: ?sort=pushed&limit=30
   */
  router.get("/users/:username/repos", async (req, res) => {
    const username = req.params.username?.trim();
    if (!username) return err(res, 400, "invalid_username", "Provide a GitHub username");

    const sort  = req.query.sort  ?? "pushed";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await githubPaginate(
      `/users/${encodeURIComponent(username)}/repos?sort=${sort}&direction=desc`,
      limit
    );
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, username, count: result.data.length, repos: result.data.map(formatRepo) });
  });

  // ── Repo summary ────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo
   * Full repository summary — metadata, language, topics, stats.
   */
  router.get("/repo/:owner/:repo", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const result = await githubRequest("GET", `/repos/${p.owner}/${p.repo}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, repo: formatRepo(result.data) });
  });

  // ── File tree ───────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/tree
   * Recursive file tree of the default (or specified) branch.
   *
   * Query params:
   *   branch  = branch name (default: repo default branch)
   *   depth   = max path depth to show (default: 3)
   */
  router.get("/repo/:owner/:repo/tree", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    // Get default branch if not specified
    let branch = req.query.branch;
    if (!branch) {
      const repoRes = await githubRequest("GET", `/repos/${p.owner}/${p.repo}`);
      if (!repoRes.ok) return err(res, 502, repoRes.error, repoRes.details?.message, repoRes.details);
      branch = repoRes.data.default_branch;
    }

    const result = await githubRequest(
      "GET",
      `/repos/${p.owner}/${p.repo}/git/trees/${branch}?recursive=1`
    );
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const maxDepth = Number(req.query.depth ?? 3);
    const items = (result.data.tree ?? [])
      .filter((item) => {
        const depth = item.path.split("/").length;
        return depth <= maxDepth;
      })
      .map(formatTreeItem);

    res.json({
      ok: true,
      branch,
      count: items.length,
      truncated: result.data.truncated ?? false,
      tree: items,
    });
  });

  // ── File content ────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/file
   * Get the decoded content of a single file.
   *
   * Query params:
   *   path    = file path (required) e.g. "src/index.js"
   *   branch  = branch name (default: HEAD)
   */
  router.get("/repo/:owner/:repo/file", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const filePath = req.query.path;
    if (!filePath) {
      return err(res, 400, "invalid_query", "?path= is required");
    }

    const ref = req.query.branch ? `?ref=${req.query.branch}` : "";
    const result = await githubRequest(
      "GET",
      `/repos/${p.owner}/${p.repo}/contents/${filePath}${ref}`
    );
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const data = result.data;
    if (Array.isArray(data)) {
      // It's a directory — list its contents instead
      return res.json({
        ok: true,
        type: "directory",
        items: data.map((f) => ({ name: f.name, type: f.type, path: f.path, size: f.size })),
      });
    }

    // Decode base64 content
    let content = null;
    if (data.encoding === "base64" && data.content) {
      try {
        content = Buffer.from(data.content, "base64").toString("utf8");
      } catch {
        content = "[binary file — cannot decode as text]";
      }
    }

    res.json({
      ok: true,
      type: "file",
      path: data.path,
      size: data.size,
      encoding: data.encoding,
      content,
      url: data.html_url,
    });
  });

  // ── Commits ─────────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/commits
   * Recent commits on the default (or specified) branch.
   *
   * Query params:
   *   branch  = branch name
   *   limit   = max commits (default: 20)
   *   path    = filter commits that touch this file path
   */
  router.get("/repo/:owner/:repo/commits", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    let qs = `per_page=${limit}`;
    if (req.query.branch) qs += `&sha=${req.query.branch}`;
    if (req.query.path) qs += `&path=${encodeURIComponent(req.query.path)}`;

    const result = await githubPaginate(
      `/repos/${p.owner}/${p.repo}/commits?${qs}`,
      limit
    );
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({
      ok: true,
      count: result.data.length,
      commits: result.data.map(formatCommit),
    });
  });

  // ── Issues & PRs ────────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/issues
   * Open issues (and optionally PRs) for a repository.
   *
   * Query params:
   *   state   = open | closed | all (default: open)
   *   type    = issues | prs | all (default: issues)
   *   limit   = max results (default: 30)
   */
  router.get("/repo/:owner/:repo/issues", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const state = req.query.state ?? "open";
    const type = req.query.type ?? "issues";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await githubPaginate(
      `/repos/${p.owner}/${p.repo}/issues?state=${state}&per_page=${limit}`,
      limit
    );
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    let items = result.data.map(formatIssue);

    if (type === "issues") items = items.filter((i) => !i.isPR);
    else if (type === "prs") items = items.filter((i) => i.isPR);

    res.json({ ok: true, count: items.length, issues: items });
  });

  // ── Repo analysis (AI summary helper) ───────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/analyze
   * Returns a combined snapshot of the repo for the AI to analyze in ONE call.
   */
  router.get("/repo/:owner/:repo/analyze", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    try {
      const data = await analyzeRepo(p.owner, p.repo);
      res.json({ ok: true, ...data });
    } catch (err) {
      err(res, 502, "analysis_failed", err.message);
    }
  });

  // ── Flat analyze endpoint (AI-friendly, no path params) ─────────────────────

  /**
   * GET /github/analyze?repo=owner/repo
   * POST /github/analyze  body: { "repo": "owner/repo" }
   * Same as GET /github/repo/:owner/:repo/analyze but easier for AI agents.
   */
  router.get("/analyze", validateQuery(analyzeQuerySchema), async (req, res) => {
    const raw = req.validatedQuery.repo;
    const parts = raw.replace("https://github.com/", "").replace(/\/$/, "").split("/");

    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return err(res, 400, "invalid_repo", 'Provide ?repo=owner/repo e.g. ?repo=expressjs/express');
    }

    const [owner, repo] = parts;
    try {
      const data = await analyzeRepo(owner, repo);
      res.json({ ok: true, ...data });
    } catch (err) {
      err(res, 502, "analysis_failed", err.message);
    }
  });

  router.post("/analyze", validateBody(analyzeBodySchema), async (req, res) => {
    const raw = req.validatedBody.repo;
    const parts = raw.replace("https://github.com/", "").replace(/\/$/, "").split("/");

    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return err(res, 400, "invalid_repo", 'Provide { "repo": "owner/repo" } e.g. { "repo": "expressjs/express" }');
    }

    const [owner, repo] = parts;
    try {
      const data = await analyzeRepo(owner, repo);
      res.json({ ok: true, ...data });
    } catch (err) {
      err(res, 502, "analysis_failed", err.message);
    }
  });

  // ── Pull Requests ───────────────────────────────────────────────────────────

  /**
   * GET /github/repo/:owner/:repo/pulls
   * List pull requests for a repository.
   */
  router.get("/repo/:owner/:repo/pulls", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const state = req.query.state ?? "open";
    const limit = Math.min(Number(req.query.limit ?? 30), 100);

    const result = await listPullRequests(p.owner, p.repo, { state, limit });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, count: result.data.length, pulls: result.data });
  });

  /**
   * POST /github/repo/:owner/:repo/pulls
   * Create a new pull request.
   */
  router.post("/repo/:owner/:repo/pulls", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const { title, body, head, base } = req.body;
    if (!title || !head) {
      return err(res, 400, "missing_fields", "title and head are required");
    }

    const result = await createPullRequest(p.owner, p.repo, {
      title,
      body: body || "",
      head,
      base: base || "main",
    });

    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, pull: result.data });
  });

  /**
   * POST /github/repo/:owner/:repo/pulls/:number/comments
   * Add comment to a pull request.
   */
  router.post("/repo/:owner/:repo/pulls/:number/comments", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const number = parseInt(req.params.number, 10);
    const { body } = req.body;

    if (!body) {
      return err(res, 400, "missing_body", "Comment body is required");
    }

    const result = await createPRComment(p.owner, p.repo, number, body);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, comment: result.data });
  });

  /**
   * POST /github/repo/:owner/:repo/branches
   * Create a new branch.
   */
  router.post("/repo/:owner/:repo/branches", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const { name: branchName, base } = req.body;
    if (!branchName) {
      return err(res, 400, "missing_name", "Branch name is required");
    }

    const result = await createBranch(p.owner, p.repo, branchName, base || "main");
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, branch: result.data });
  });

  app.use("/github", router);
}
