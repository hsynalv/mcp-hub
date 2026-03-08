/**
 * GitHub Source Connector for RAG
 * 
 * Indexes GitHub repositories: code files, READMEs, issues, PRs
 */

import { SourceConnector, SourceDocument } from "./rag-connectors.js";

export class GitHubConnector extends SourceConnector {
  constructor(config) {
    super(config);
    this.name = "github";
    this.type = "github";
    this.token = config.token || process.env.GITHUB_TOKEN;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch || "main";
    this.includeIssues = config.includeIssues ?? true;
    this.includePRs = config.includePRs ?? true;
    this.filePatterns = config.filePatterns || ["*.md", "*.js", "*.ts", "*.py", "*.go", "*.java", "README*"];
    this.excludePatterns = config.excludePatterns || ["node_modules/**", ".git/**", "dist/**", "build/**"];
  }

  async checkHealth() {
    if (!this.token) return false;
    try {
      const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}`, {
        headers: { Authorization: `token ${this.token}` },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async crawl(options = {}) {
    const docs = [];
    const since = options.since;

    // Crawl repository files
    const tree = await this.getRepoTree();
    for (const item of tree) {
      if (this.shouldIncludeFile(item.path)) {
        docs.push(new SourceDocument(
          `github:${this.owner}/${this.repo}:${item.sha}`,
          this.name,
          "file",
          item.path,
          {
            title: item.path.split("/").pop(),
            size: item.size,
            language: this.detectLanguage(item.path),
            tags: ["code", this.branch],
          }
        ));
      }
    }

    // Crawl issues if enabled
    if (this.includeIssues) {
      const issues = await this.getIssues(since);
      for (const issue of issues) {
        docs.push(new SourceDocument(
          `github:issue:${issue.number}`,
          this.name,
          "issue",
          `issues/${issue.number}`,
          {
            title: issue.title,
            author: issue.user.login,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            tags: ["issue", issue.state],
          }
        ));
      }
    }

    // Crawl PRs if enabled
    if (this.includePRs) {
      const prs = await this.getPRs(since);
      for (const pr of prs) {
        docs.push(new SourceDocument(
          `github:pr:${pr.number}`,
          this.name,
          "pull_request",
          `pull/${pr.number}`,
          {
            title: pr.title,
            author: pr.user.login,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            tags: ["pr", pr.state],
          }
        ));
      }
    }

    return docs;
  }

  async hasChanged(doc, lastIndexedAt) {
    if (!doc.metadata.updatedAt) return true;
    return new Date(doc.metadata.updatedAt) > new Date(lastIndexedAt);
  }

  async extract(doc) {
    switch (doc.type) {
      case "file":
        return this.extractFile(doc);
      case "issue":
        return this.extractIssue(doc);
      case "pull_request":
        return this.extractPR(doc);
      default:
        throw new Error(`Unknown document type: ${doc.type}`);
    }
  }

  async getMetadata(doc) {
    return doc.metadata;
  }

  // GitHub API helpers
  async getRepoTree() {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${this.branch}?recursive=1`;
    const response = await fetch(url, {
      headers: { Authorization: `token ${this.token}` },
    });
    if (!response.ok) throw new Error(`Failed to get repo tree: ${response.status}`);
    const data = await response.json();
    return data.tree || [];
  }

  async getFileContent(path) {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
    const response = await fetch(url, {
      headers: { Authorization: `token ${this.token}` },
    });
    if (!response.ok) throw new Error(`Failed to get file: ${response.status}`);
    const data = await response.json();
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  async getIssues(since) {
    let url = `https://api.github.com/repos/${this.owner}/${this.repo}/issues?state=all&per_page=100`;
    if (since) url += `&since=${since}`;
    const response = await fetch(url, {
      headers: { Authorization: `token ${this.token}` },
    });
    if (!response.ok) throw new Error(`Failed to get issues: ${response.status}`);
    return response.json();
  }

  async getPRs(since) {
    let url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls?state=all&per_page=100`;
    if (since) url += `&since=${since}`;
    const response = await fetch(url, {
      headers: { Authorization: `token ${this.token}` },
    });
    if (!response.ok) throw new Error(`Failed to get PRs: ${response.status}`);
    return response.json();
  }

  async extractFile(doc) {
    try {
      return await this.getFileContent(doc.path);
    } catch (err) {
      console.warn(`[GitHubConnector] Failed to extract ${doc.path}:`, err.message);
      return "";
    }
  }

  async extractIssue(doc) {
    const number = doc.path.split("/").pop();
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${number}`;
    const response = await fetch(url, {
      headers: { Authorization: `token ${this.token}` },
    });
    if (!response.ok) throw new Error(`Failed to get issue: ${response.status}`);
    const data = await response.json();
    return `# ${data.title}\n\n${data.body || ""}`;
  }

  async extractPR(doc) {
    const number = doc.path.split("/").pop();
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${number}`;
    const response = await fetch(url, {
      headers: { Authorization: `token ${this.token}` },
    });
    if (!response.ok) throw new Error(`Failed to get PR: ${response.status}`);
    const data = await response.json();
    return `# ${data.title}\n\n${data.body || ""}`;
  }

  shouldIncludeFile(path) {
    // Check exclude patterns
    for (const pattern of this.excludePatterns) {
      if (this.matchesPattern(path, pattern)) return false;
    }

    // Check include patterns
    for (const pattern of this.filePatterns) {
      if (this.matchesPattern(path, pattern)) return true;
    }

    return false;
  }

  matchesPattern(path, pattern) {
    // Simple glob matching
    const regex = new RegExp(
      "^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"
    );
    return regex.test(path);
  }

  detectLanguage(path) {
    const ext = path.split(".").pop()?.toLowerCase();
    const langMap = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      go: "go",
      java: "java",
      md: "markdown",
      json: "json",
      yml: "yaml",
      yaml: "yaml",
    };
    return langMap[ext] || "text";
  }
}

export default GitHubConnector;
