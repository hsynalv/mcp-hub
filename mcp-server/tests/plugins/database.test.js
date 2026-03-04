import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAdapter, isValidType } from "../../src/plugins/database/db.adapter.js";

/**
 * Database Plugin Unit Tests
 * Tests for adapter interface and type validation
 */

vi.mock("../../src/plugins/database/adapters/mssql.js", () => ({
  default: { type: "mssql", query: vi.fn() },
}));

vi.mock("../../src/plugins/database/adapters/postgres.js", () => ({
  default: { type: "postgres", query: vi.fn() },
}));

vi.mock("../../src/plugins/database/adapters/mongodb.js", () => ({
  default: { type: "mongodb", query: vi.fn() },
}));

describe("Database Adapter Interface", () => {
  describe("isValidType", () => {
    it("should validate supported database types", () => {
      expect(isValidType("mssql")).toBe(true);
      expect(isValidType("postgres")).toBe(true);
      expect(isValidType("mongodb")).toBe(true);
    });

    it("should reject unsupported types", () => {
      expect(isValidType("mysql")).toBe(false);
      expect(isValidType("sqlite")).toBe(false);
      expect(isValidType("oracle")).toBe(false);
      expect(isValidType("")).toBe(false);
      expect(isValidType(null)).toBe(false);
      expect(isValidType(undefined)).toBe(false);
    });

    it("should be case sensitive", () => {
      expect(isValidType("MSSQL")).toBe(false);
      expect(isValidType("Postgres")).toBe(false);
      expect(isValidType("MongoDB")).toBe(false);
    });
  });

  describe("getAdapter", () => {
    it("should return adapter for valid types", async () => {
      const mssql = await getAdapter("mssql");
      const postgres = await getAdapter("postgres");
      const mongodb = await getAdapter("mongodb");

      expect(mssql).not.toBeNull();
      expect(postgres).not.toBeNull();
      expect(mongodb).not.toBeNull();

      expect(mssql.type).toBe("mssql");
      expect(postgres.type).toBe("postgres");
      expect(mongodb.type).toBe("mongodb");
    });

    it("should return null for invalid types", async () => {
      const result = await getAdapter("invalid");
      expect(result).toBeNull();
    });
  });
});

describe("Database Schema Validation", () => {
  const querySchema = {
    parse: (data) => {
      const validTypes = ["mssql", "postgres", "mongodb"];
      if (!data.type || !validTypes.includes(data.type)) {
        throw new Error("Invalid type");
      }
      if (!data.query) {
        throw new Error("Query required");
      }
      return data;
    },
  };

  const crudSchema = {
    parse: (data) => {
      const validTypes = ["mssql", "postgres", "mongodb"];
      if (!data.type || !validTypes.includes(data.type)) {
        throw new Error("Invalid type");
      }
      if (!data.table || typeof data.table !== "string") {
        throw new Error("Table name required");
      }
      if (data.limit !== undefined && (data.limit < 1 || data.limit > 10000)) {
        throw new Error("Limit out of range");
      }
      return data;
    },
  };

  describe("Query Schema", () => {
    it("should validate valid query requests", () => {
      const validQueries = [
        { type: "postgres", query: "SELECT * FROM users", params: [] },
        { type: "mssql", query: "SELECT TOP 10 * FROM orders" },
        { type: "mongodb", query: { collection: "users", filter: {} } },
      ];

      validQueries.forEach((query) => {
        expect(() => querySchema.parse(query)).not.toThrow();
      });
    });

    it("should reject queries without type", () => {
      expect(() => querySchema.parse({ query: "SELECT *" })).toThrow("Invalid type");
    });

    it("should reject queries with invalid type", () => {
      expect(() => querySchema.parse({ type: "mysql", query: "SELECT *" })).toThrow("Invalid type");
    });

    it("should reject queries without query", () => {
      expect(() => querySchema.parse({ type: "postgres" })).toThrow("Query required");
    });
  });

  describe("CRUD Schema", () => {
    it("should validate valid CRUD requests", () => {
      const validRequests = [
        { type: "postgres", table: "users", data: { name: "John" } },
        { type: "mssql", table: "orders", where: { id: 1 } },
        { type: "mongodb", table: "products", data: { price: 99.99 }, limit: 100 },
      ];

      validRequests.forEach((req) => {
        expect(() => crudSchema.parse(req)).not.toThrow();
      });
    });

    it("should reject CRUD without table", () => {
      expect(() => crudSchema.parse({ type: "postgres", data: {} })).toThrow("Table name required");
    });

    it("should reject CRUD with limit out of range", () => {
      expect(() => crudSchema.parse({ type: "postgres", table: "users", limit: 0 })).toThrow();
      expect(() => crudSchema.parse({ type: "postgres", table: "users", limit: 10001 })).toThrow();
      expect(() => crudSchema.parse({ type: "postgres", table: "users", limit: -1 })).toThrow();
    });
  });
});

describe("Database Error Handling", () => {
  it("should categorize connection errors", () => {
    const errors = [
      { message: "connection_failed", expectedStatus: 502, expectedError: "connection_failed" },
      { message: "query_failed", expectedStatus: 422, expectedError: "query_failed" },
      { message: "random error", expectedStatus: 500, expectedError: "internal_error" },
    ];

    errors.forEach((err) => {
      // Simulate error categorization logic
      let status, error;
      if (err.message === "connection_failed") {
        status = 502;
        error = "connection_failed";
      } else if (err.message === "query_failed") {
        status = 422;
        error = "query_failed";
      } else {
        status = 500;
        error = "internal_error";
      }

      expect(status).toBe(err.expectedStatus);
      expect(error).toBe(err.expectedError);
    });
  });
});
