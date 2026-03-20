import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/core/server.js";

/**
 * Smoke Tests
 * Basic server boot and health checks.
 */

function hubAuthHeaders() {
  const k =
    process.env.HUB_READ_KEY?.trim() ||
    process.env.HUB_WRITE_KEY?.trim() ||
    process.env.HUB_ADMIN_KEY?.trim();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

describe("Smoke Tests", () => {
  let app;
  let server;
  let port;

  beforeAll(async () => {
    app = await createServer();
    await new Promise((resolve, reject) => {
      server = app.listen(0, (err) => { // 0 = random available port
        if (err) return reject(err);
        port = server.address().port;
        resolve();
      });
    });
  }, 30000); // 30 second timeout for server boot

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("should boot without errors", async () => {
    expect(app).toBeDefined();
    expect(port).toBeGreaterThan(0);
  });

  it("should respond to /health", async () => {
    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.data.status).toBe("ok");
  });

  it("should respond to /whoami", async () => {
    const response = await fetch(`http://localhost:${port}/whoami`, {
      headers: hubAuthHeaders(),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.data.auth).toBeDefined();
  });

  it("should return validation error for invalid request", async () => {
    const response = await fetch(`http://localhost:${port}/http/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...hubAuthHeaders() },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(["missing_project_id", "validation_error"]).toContain(data.error.code);
  });

  it("should return 404 for unknown routes", async () => {
    const response = await fetch(`http://localhost:${port}/unknown-route`, {
      headers: hubAuthHeaders(),
    });
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("not_found");
  });
});
