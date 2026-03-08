/**
 * File System Source Connector for RAG
 * 
 * Indexes local files from a workspace directory
 */

import { SourceConnector, SourceDocument } from "../rag-connectors.js";
import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, relative } from "path";

export class FileConnector extends SourceConnector {
  constructor(config) {
    super(config);
    this.name = "file";
    this.type = "file";
    this.rootPath = config.rootPath || process.env.WORKSPACE_PATH || "./workspace";
    this.includePatterns = config.includePatterns || ["*.md", "*.txt", "*.js", "*.ts", "*.py", "*.json"];
    this.excludePatterns = config.excludePatterns || ["node_modules/**", ".git/**", "dist/**", "*.log"];
    this.maxFileSize = config.maxFileSize || 1024 * 1024; // 1MB default
    this.recursive = config.recursive ?? true;
  }

  async checkHealth() {
    return existsSync(this.rootPath);
  }

  async crawl(options = {}) {
    const docs = [];
    const since = options.since;

    const files = this.scanDirectory(this.rootPath);

    for (const filePath of files) {
      const relPath = relative(this.rootPath, filePath);
      const stats = statSync(filePath);

      // Skip if file too large
      if (stats.size > this.maxFileSize) continue;

      // Check modified time for incremental updates
      if (since && stats.mtime <= new Date(since)) continue;

      docs.push(new SourceDocument(
        `file:${relPath}`,
        this.name,
        "file",
        relPath,
        {
          title: relPath.split("/").pop(),
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
          language: this.detectLanguage(relPath),
          tags: ["local"],
        }
      ));
    }

    return docs;
  }

  async hasChanged(doc, lastIndexedAt) {
    if (!doc.metadata.updatedAt) return true;
    return new Date(doc.metadata.updatedAt) > new Date(lastIndexedAt);
  }

  async extract(doc) {
    const fullPath = join(this.rootPath, doc.path);
    
    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    const content = readFileSync(fullPath, "utf-8");
    return content;
  }

  async getMetadata(doc) {
    return doc.metadata;
  }

  scanDirectory(dir, files = []) {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(this.rootPath, fullPath);

      if (entry.isDirectory()) {
        if (this.recursive && !this.shouldExclude(relPath)) {
          this.scanDirectory(fullPath, files);
        }
      } else if (entry.isFile()) {
        if (this.shouldInclude(relPath)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  shouldInclude(path) {
    if (this.shouldExclude(path)) return false;

    for (const pattern of this.includePatterns) {
      if (this.matchesPattern(path, pattern)) return true;
    }

    return false;
  }

  shouldExclude(path) {
    for (const pattern of this.excludePatterns) {
      if (this.matchesPattern(path, pattern)) return true;
    }
    return false;
  }

  matchesPattern(path, pattern) {
    const regex = new RegExp(
      "^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"
    );
    return regex.test(path);
  }

  detectLanguage(path) {
    const ext = path.split(".").pop()?.toLowerCase();
    const langMap = {
      md: "markdown",
      txt: "text",
      js: "javascript",
      ts: "typescript",
      py: "python",
      go: "go",
      java: "java",
      json: "json",
      yaml: "yaml",
      yml: "yaml",
      html: "html",
      css: "css",
    };
    return langMap[ext] || "text";
  }
}

export default FileConnector;
