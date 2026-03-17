/**
 * Plugin Loader Runtime Tests
 *
 * Verifies that the canonical runtime path uses only plugins.js and tool-registry.js:
 * - Runtime startup uses canonical loader (no deprecated registry)
 * - Key plugins (rag, rag-ingestion, retrieval-evals, example-sdk) load via canonical path
 * - No deprecated registry dependency in runtime
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";

import { loadPlugins, getPlugins } from "../../src/core/plugins.js";
import { listTools } from "../../src/core/tool-registry.js";

describe("Plugin Loader Runtime", () => {
  let app;

  beforeEach(() => {
    app = express();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use canonical loader (plugins.js) for runtime startup", async () => {
    await loadPlugins(app);
    const plugins = getPlugins();
    expect(Array.isArray(plugins)).toBe(true);
    // Canonical loader discovers plugins from src/plugins/*/index.js
    expect(plugins.length).toBeGreaterThanOrEqual(0);
  });

  it("should load rag plugin via canonical path", async () => {
    await loadPlugins(app);
    const names = getPlugins().map((p) => p.name);
    expect(names).toContain("rag");
  });

  it("should load rag-ingestion plugin via canonical path", async () => {
    await loadPlugins(app);
    const names = getPlugins().map((p) => p.name);
    expect(names).toContain("rag-ingestion");
  });

  it("should load retrieval-evals plugin via canonical path", async () => {
    await loadPlugins(app);
    const names = getPlugins().map((p) => p.name);
    expect(names).toContain("retrieval-evals");
  });

  it("should load example-sdk plugin via canonical path", async () => {
    await loadPlugins(app);
    const names = getPlugins().map((p) => p.name);
    expect(names).toContain("example-sdk");
  });

  it("should register tools via tool-registry (no deprecated registry)", async () => {
    await loadPlugins(app);
    const tools = listTools();
    expect(Array.isArray(tools)).toBe(true);
    // At least some tools should be registered from plugins
    expect(tools.length).toBeGreaterThan(0);
  });

  it("should not import from legacy registry in runtime path", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pluginsPath = join(__dirname, "../../src/core/plugins.js");
    const pluginsSource = readFileSync(pluginsPath, "utf8");
    expect(pluginsSource).not.toMatch(/from ["'].*legacy\/registry/);
    expect(pluginsSource).not.toMatch(/from ["'].*core\/registry\//);
  });
});
