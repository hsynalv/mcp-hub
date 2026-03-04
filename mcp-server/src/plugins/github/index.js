import { Router } from "express";
import { z } from "zod";
import { githubRequest, githubPaginate } from "./github.client.js";

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
   * Returns a combined snapshot of the repo for the AI to analyze in ONE call:
   *   - repo metadata
   *   - file tree (depth 3)
   *   - last 15 commits
   *   - open issues (max 20)
   *   - README content (if exists)
   *
   * This is the primary tool for "analyze this repo and create a plan" use case.
   */
  router.get("/repo/:owner/:repo/analyze", async (req, res) => {
    const p = repoParams(req, res);
    if (!p) return;

    const base = `/repos/${p.owner}/${p.repo}`;

    // Fetch all in parallel
    const [repoRes, commitsRes, issuesRes, readmeRes] = await Promise.all([
      githubRequest("GET", base),
      githubPaginate(`${base}/commits?per_page=15`, 15),
      githubPaginate(`${base}/issues?state=open&per_page=20`, 20),
      githubRequest("GET", `${base}/readme`).catch(() => ({ ok: false })),
    ]);

    if (!repoRes.ok) return err(res, 502, repoRes.error, repoRes.details?.message, repoRes.details);

    const branch = repoRes.data.default_branch;
    const treeRes = await githubRequest("GET", `${base}/git/trees/${branch}?recursive=1`);

    // Decode README
    let readme = null;
    if (readmeRes.ok && readmeRes.data?.content) {
      try {
        const full = Buffer.from(readmeRes.data.content, "base64").toString("utf8");
        // Trim to first 3000 chars to avoid token bloat
        readme = full.length > 3000 ? full.slice(0, 3000) + "\n\n[...truncated...]" : full;
      } catch {
        readme = null;
      }
    }

    // Filter tree to depth 3
    const tree = (treeRes.data?.tree ?? [])
      .filter((item) => item.path.split("/").length <= 3)
      .map(formatTreeItem);

    const issues = (issuesRes.data ?? []).map(formatIssue).filter((i) => !i.isPR);
    const prs = (issuesRes.data ?? []).map(formatIssue).filter((i) => i.isPR);

    res.json({
      ok: true,
      repo: formatRepo(repoRes.data),
      tree: { branch, count: tree.length, items: tree },
      commits: { count: commitsRes.data?.length ?? 0, items: (commitsRes.data ?? []).map(formatCommit) },
      issues: { open: issues.length, items: issues.slice(0, 20) },
      pullRequests: { open: prs.length, items: prs.slice(0, 10) },
      readme,
    });
  });

  // ── Flat analyze endpoint (AI-friendly, no path params) ─────────────────────

  /**
   * GET /github/analyze?repo=owner/repo
   * POST /github/analyze  body: { "repo": "owner/repo" }
   * Same as GET /github/repo/:owner/:repo/analyze but easier for AI agents.
   */
  router.get("/analyze", async (req, res) => {
    const raw = req.query.repo ?? "";
    const parts = raw.replace("https://github.com/", "").replace(/\/$/, "").split("/");

    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return err(res, 400, "invalid_repo", 'Provide ?repo=owner/repo e.g. ?repo=expressjs/express');
    }

    const [owner, repo] = parts;
    const base = `/repos/${owner}/${repo}`;

    const [repoRes, commitsRes, issuesRes, readmeRes] = await Promise.all([
      githubRequest("GET", base),
      githubPaginate(`${base}/commits?per_page=15`, 15),
      githubPaginate(`${base}/issues?state=open&per_page=20`, 20),
      githubRequest("GET", `${base}/readme`).catch(() => ({ ok: false })),
    ]);

    if (!repoRes.ok) return err(res, 502, repoRes.error, repoRes.details?.message, repoRes.details);

    const branch = repoRes.data.default_branch;
    const treeRes = await githubRequest("GET", `${base}/git/trees/${branch}?recursive=1`);

    let readme = null;
    if (readmeRes.ok && readmeRes.data?.content) {
      try {
        const full = Buffer.from(readmeRes.data.content, "base64").toString("utf8");
        readme = full.length > 3000 ? full.slice(0, 3000) + "\n\n[...truncated...]" : full;
      } catch { readme = null; }
    }

    const tree = (treeRes.data?.tree ?? [])
      .filter((item) => item.path.split("/").length <= 3)
      .map(formatTreeItem);

    const issues = (issuesRes.data ?? []).map(formatIssue).filter((i) => !i.isPR);
    const prs    = (issuesRes.data ?? []).map(formatIssue).filter((i) =>  i.isPR);

    res.json({
      ok: true,
      repo: formatRepo(repoRes.data),
      tree: { branch, count: tree.length, items: tree },
      commits: { count: commitsRes.data?.length ?? 0, items: (commitsRes.data ?? []).map(formatCommit) },
      issues: { open: issues.length, items: issues.slice(0, 20) },
      pullRequests: { open: prs.length, items: prs.slice(0, 10) },
      readme,
    });
  });

  router.post("/analyze", async (req, res) => {
    const raw = req.body?.repo ?? req.query.repo ?? "";
    const parts = raw.replace("https://github.com/", "").replace(/\/$/, "").split("/");

    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return err(res, 400, "invalid_repo", 'Provide { "repo": "owner/repo" } e.g. { "repo": "expressjs/express" }');
    }

    const [owner, repo] = parts;
    const base = `/repos/${owner}/${repo}`;

    const [repoRes, commitsRes, issuesRes, readmeRes] = await Promise.all([
      githubRequest("GET", base),
      githubPaginate(`${base}/commits?per_page=15`, 15),
      githubPaginate(`${base}/issues?state=open&per_page=20`, 20),
      githubRequest("GET", `${base}/readme`).catch(() => ({ ok: false })),
    ]);

    if (!repoRes.ok) return err(res, 502, repoRes.error, repoRes.details?.message, repoRes.details);

    const branch = repoRes.data.default_branch;
    const treeRes = await githubRequest("GET", `${base}/git/trees/${branch}?recursive=1`);

    let readme = null;
    if (readmeRes.ok && readmeRes.data?.content) {
      try {
        const full = Buffer.from(readmeRes.data.content, "base64").toString("utf8");
        readme = full.length > 3000 ? full.slice(0, 3000) + "\n\n[...truncated...]" : full;
      } catch { readme = null; }
    }

    const tree = (treeRes.data?.tree ?? [])
      .filter((item) => item.path.split("/").length <= 3)
      .map(formatTreeItem);

    const issues = (issuesRes.data ?? []).map(formatIssue).filter((i) => !i.isPR);
    const prs    = (issuesRes.data ?? []).map(formatIssue).filter((i) =>  i.isPR);

    res.json({
      ok: true,
      repo: formatRepo(repoRes.data),
      tree: { branch, count: tree.length, items: tree },
      commits: { count: commitsRes.data?.length ?? 0, items: (commitsRes.data ?? []).map(formatCommit) },
      issues: { open: issues.length, items: issues.slice(0, 20) },
      pullRequests: { open: prs.length, items: prs.slice(0, 10) },
      readme,
    });
  });

  app.use("/github", router);
}
