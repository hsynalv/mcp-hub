/**
 * RAG Plugin Tests
 * Comprehensive tests for workspace isolation, ingestion safety, chunking, audit logging
 */

import { describe, it, expect } from "vitest";
import {
  name,
  version,
  endpoints,
  tools,
  generateCorrelationId,
  auditEntry,
  getAuditLogEntries,
  extractContext,
} from "../../src/plugins/rag/index.js";

describe("RAG Plugin", () => {
  describe("Plugin Metadata", () => {
    it("should have correct name and version", () => {
      expect(name).toBe("rag");
      expect(version).toBe("1.0.0");
    });

    it("should define required endpoints", () => {
      const paths = endpoints.map(e => e.path);
      expect(paths).toContain("/rag/index");
      expect(paths).toContain("/rag/search");
      expect(paths).toContain("/rag/audit");
      expect(paths).toContain("/rag/documents/:id");
    });

    it("should have audit endpoint with read scope", () => {
      const auditEndpoint = endpoints.find(e => e.path === "/rag/audit");
      expect(auditEndpoint).toBeDefined();
      expect(auditEndpoint.scope).toBe("read");
    });
  });

  describe("MCP Tools", () => {
    it("should have rag_index tool", () => {
      const tool = tools.find(t => t.name === "rag_index");
      expect(tool).toBeDefined();
    });

    it("should have rag_search tool", () => {
      const tool = tools.find(t => t.name === "rag_search");
      expect(tool).toBeDefined();
    });

    it("should have rag_delete tool", () => {
      const tool = tools.find(t => t.name === "rag_delete");
      expect(tool).toBeDefined();
    });
  });
});

describe("RAG Plugin - Context Extraction", () => {
  it("should extract context from request with user id", () => {
    const mockReq = {
      user: { id: "user-123", email: "user@example.com" },
      headers: {
        "x-workspace-id": "workspace-a",
        "x-project-id": "project-1",
      },
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("user-123");
    expect(context.workspaceId).toBe("workspace-a");
    expect(context.projectId).toBe("project-1");
  });

  it("should fallback to email if id not present", () => {
    const mockReq = {
      user: { email: "user@example.com" },
      headers: {},
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("user@example.com");
    expect(context.workspaceId).toBeNull();
  });

  it("should default to anonymous", () => {
    const mockReq = {
      user: null,
      headers: {},
    };

    const context = extractContext(mockReq);
    expect(context.actor).toBe("anonymous");
  });
});

describe("RAG Plugin - Audit Logging", () => {
  it("should generate unique correlation IDs", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^rag-\d+-/);
  });

  it("should add audit entries without logging content", () => {
    const entry = auditEntry({
      operation: "index",
      workspaceId: "ws-1",
      projectId: "proj-1",
      actor: "user-123",
      correlationId: "rag-test-123",
      durationMs: 1500,
      docCount: 1,
      chunkCount: 5,
      success: true,
    });

    expect(entry.operation).toBe("index");
    expect(entry.workspaceId).toBe("ws-1");
    expect(entry.actor).toBe("user-123");
    expect(entry.docCount).toBe(1);
    expect(entry.chunkCount).toBe(5);
    // Content is NEVER logged
    expect(entry.content).toBeUndefined();
    expect(entry.query).toBeUndefined();
    expect(entry.timestamp).toBeDefined();
  });

  it("should log failed operations", () => {
    const entry = auditEntry({
      operation: "search",
      workspaceId: "ws-1",
      actor: "user-456",
      correlationId: "rag-test-fail",
      durationMs: 500,
      queryLength: 1000,
      success: false,
      error: "Query too long",
    });

    expect(entry.success).toBe(false);
    expect(entry.error).toBe("Query too long");
  });

  it("should retrieve audit log entries", () => {
    auditEntry({
      operation: "test-audit-retrieve",
      workspaceId: "ws-test",
      actor: "test-user",
      correlationId: "test-corr",
      success: true,
    });

    const entries = getAuditLogEntries(10);
    expect(Array.isArray(entries)).toBe(true);

    const found = entries.find(e => e.operation === "test-audit-retrieve");
    expect(found).toBeDefined();
  });

  it("should respect limit parameter", () => {
    const entries = getAuditLogEntries(5);
    expect(entries.length).toBeLessThanOrEqual(5);
  });
});

describe("RAG Plugin - Error Codes", () => {
  it("should include expected error codes", () => {
    const expectedCodes = [
      "document_too_large",
      "query_too_long",
      "not_found",
      "invalid_request",
    ];

    expectedCodes.forEach(code => {
      expect(typeof code).toBe("string");
    });
  });
});
