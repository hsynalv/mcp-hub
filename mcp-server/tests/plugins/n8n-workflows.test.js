import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/config.js", () => ({
  config: {
    n8n: {
      baseUrl: "http://localhost:5678",
      apiBase: "/api/v1",
      apiKey: "test-key",
    },
  },
}));

import { tools } from "../../src/plugins/n8n-workflows/index.js";

function getTool(name) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
}

describe("n8n-workflows plugin", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("n8n_create_workflow should fail validation if workflow_json is invalid", async () => {
    const tool = getTool("n8n_create_workflow");
    const res = await tool.handler({
      workflow_json: { name: "wf", nodes: [] },
      explanation: "test",
    });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("invalid_workflow");
  });

  it("n8n_create_workflow should POST to /workflows and return workflow_url", async () => {
    const tool = getTool("n8n_create_workflow");

    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "123", name: "My Workflow", active: false }),
    });

    const res = await tool.handler({
      workflow_json: {
        name: "My Workflow",
        nodes: [{ id: "node-1", type: "n8n-nodes-base.manualTrigger" }],
        connections: {},
      },
      explanation: "create for test",
    });

    expect(res.ok).toBe(true);
    expect(res.data.workflow_id).toBe("123");
    expect(res.data.workflow_url).toBe("http://localhost:5678/workflow/123");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:5678/api/v1/workflows");
    expect(options.method).toBe("POST");
    expect(options.headers["X-N8N-API-KEY"]).toBe("test-key");
  });
});
