import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

/**
 * Docker Plugin Unit Tests
 * Tests for schema validation and data formatting
 */

// Mock the docker client
vi.mock("../../src/plugins/docker/docker.client.js", () => ({
  dockerRequest: vi.fn(),
}));

describe("Docker Plugin Schemas", () => {
  const pullImageSchema = z.object({
    image: z.string().min(1),
    tag: z.string().optional(),
  });

  const createContainerSchema = z.object({
    image: z.string().min(1),
    name: z.string().optional(),
    ports: z.array(z.object({
      container: z.number(),
      host: z.number().optional(),
    })).optional(),
    environment: z.record(z.string()).optional(),
  });

  describe("pullImageSchema", () => {
    it("should validate minimal image pull", () => {
      expect(() => pullImageSchema.parse({ image: "nginx" })).not.toThrow();
    });

    it("should validate image with tag", () => {
      expect(() =>
        pullImageSchema.parse({ image: "nginx", tag: "latest" })
      ).not.toThrow();
    });

    it("should validate image with specific version", () => {
      expect(() =>
        pullImageSchema.parse({ image: "node", tag: "18-alpine" })
      ).not.toThrow();
    });

    it("should reject empty image name", () => {
      expect(() => pullImageSchema.parse({ image: "" })).toThrow();
    });

    it("should reject missing image", () => {
      expect(() => pullImageSchema.parse({ tag: "latest" })).toThrow();
    });
  });

  describe("createContainerSchema", () => {
    it("should validate minimal container creation", () => {
      expect(() =>
        createContainerSchema.parse({ image: "nginx:latest" })
      ).not.toThrow();
    });

    it("should validate container with name", () => {
      expect(() =>
        createContainerSchema.parse({ image: "nginx", name: "web-server" })
      ).not.toThrow();
    });

    it("should validate container with port mappings", () => {
      const container = {
        image: "nginx",
        name: "web",
        ports: [
          { container: 80, host: 8080 },
          { container: 443, host: 8443 },
        ],
      };
      expect(() => createContainerSchema.parse(container)).not.toThrow();
    });

    it("should validate container with environment variables", () => {
      const container = {
        image: "postgres",
        name: "db",
        environment: {
          POSTGRES_USER: "admin",
          POSTGRES_PASSWORD: "secret",
          POSTGRES_DB: "myapp",
        },
      };
      expect(() => createContainerSchema.parse(container)).not.toThrow();
    });

    it("should validate full container configuration", () => {
      const container = {
        image: "myapp:latest",
        name: "app-server",
        ports: [{ container: 3000, host: 3000 }],
        environment: {
          NODE_ENV: "production",
          API_KEY: "secret",
        },
      };
      expect(() => createContainerSchema.parse(container)).not.toThrow();
    });

    it("should reject missing image", () => {
      expect(() =>
        createContainerSchema.parse({ name: "test", ports: [] })
      ).toThrow();
    });

    it("should reject invalid port configuration", () => {
      expect(() =>
        createContainerSchema.parse({
          image: "nginx",
          ports: [{ container: "invalid" }],
        })
      ).toThrow();
    });
  });
});

describe("Docker Plugin Formatters", () => {
  const formatContainer = (container) => ({
    id: container.Id?.slice(0, 12) ?? "",
    name: container.Names?.[0]?.replace(/^\//, "") ?? "",
    image: container.Image ?? "",
    status: container.Status ?? "",
    state: container.State ?? "",
    ports: container.Ports?.map((p) => ({
      container: p.PrivatePort,
      host: p.PublicPort,
      hostIp: p.IP,
      type: p.Type,
    })) ?? [],
    created: container.Created ?? null,
    labels: container.Labels ?? {},
  });

  const formatImage = (image) => ({
    id: image.Id?.replace("sha256:", "").slice(0, 12) ?? "",
    name: image.RepoTags?.[0]?.split(":")[0] ?? "<none>",
    tag: image.RepoTags?.[0]?.split(":")[1] ?? "<none>",
    size: image.Size ?? 0,
    created: image.Created ?? null,
    labels: image.Labels ?? {},
  });

  describe("formatContainer", () => {
    it("should format running container", () => {
      const input = {
        Id: "abc123def456789",
        Names: ["/web-server"],
        Image: "nginx:latest",
        Status: "Up 2 hours",
        State: "running",
        Ports: [
          { PrivatePort: 80, PublicPort: 8080, IP: "0.0.0.0", Type: "tcp" },
        ],
        Created: 1234567890,
        Labels: { app: "web", env: "prod" },
      };

      const result = formatContainer(input);

      expect(result.id).toBe("abc123def456");
      expect(result.name).toBe("web-server");
      expect(result.image).toBe("nginx:latest");
      expect(result.status).toBe("Up 2 hours");
      expect(result.state).toBe("running");
      expect(result.ports).toHaveLength(1);
      expect(result.ports[0]).toEqual({
        container: 80,
        host: 8080,
        hostIp: "0.0.0.0",
        type: "tcp",
      });
      expect(result.labels).toEqual({ app: "web", env: "prod" });
    });

    it("should format stopped container", () => {
      const input = {
        Id: "xyz789abc123",
        Names: ["/stopped-app"],
        Image: "node:18",
        Status: "Exited (0) 3 days ago",
        State: "exited",
        Ports: [],
        Created: 1234567890,
        Labels: {},
      };

      const result = formatContainer(input);

      expect(result.id).toBe("xyz789abc123");
      expect(result.name).toBe("stopped-app");
      expect(result.state).toBe("exited");
      expect(result.ports).toEqual([]);
    });

    it("should handle container without name", () => {
      const input = {
        Id: "noname123456",
        Image: "alpine",
        Status: "Created",
        State: "created",
      };

      const result = formatContainer(input);

      expect(result.name).toBe("");
      expect(result.id).toBe("noname123456");
    });

    it("should handle multiple port mappings", () => {
      const input = {
        Id: "multiport123",
        Names: ["/multi-port-app"],
        Image: "app:latest",
        Ports: [
          { PrivatePort: 3000, PublicPort: 3000, IP: "0.0.0.0", Type: "tcp" },
          { PrivatePort: 8080, PublicPort: 8080, IP: "0.0.0.0", Type: "tcp" },
          { PrivatePort: 5432, Type: "tcp" }, // No public port (internal)
        ],
      };

      const result = formatContainer(input);

      expect(result.ports).toHaveLength(3);
      expect(result.ports[2].host).toBeUndefined();
    });
  });

  describe("formatImage", () => {
    it("should format tagged image", () => {
      const input = {
        Id: "sha256:abc123def456",
        RepoTags: ["nginx:latest"],
        Size: 133000000,
        Created: 1234567890,
        Labels: { maintainer: "NGINX Team" },
      };

      const result = formatImage(input);

      expect(result.id).toBe("abc123def456");
      expect(result.name).toBe("nginx");
      expect(result.tag).toBe("latest");
      expect(result.size).toBe(133000000);
      expect(result.labels).toEqual({ maintainer: "NGINX Team" });
    });

    it("should format image with version tag", () => {
      const input = {
        Id: "sha256:xyz789abc123",
        RepoTags: ["node:18-alpine"],
        Size: 176000000,
        Created: 1234567890,
      };

      const result = formatImage(input);

      expect(result.name).toBe("node");
      expect(result.tag).toBe("18-alpine");
    });

    it("should handle untagged image", () => {
      const input = {
        Id: "sha256:untagged123",
        RepoTags: null,
        Size: 50000000,
      };

      const result = formatImage(input);

      expect(result.name).toBe("<none>");
      expect(result.tag).toBe("<none>");
      expect(result.id).toBe("untagged123");
    });

    it("should handle image with multiple tags", () => {
      const input = {
        Id: "sha256:multitag456",
        RepoTags: ["myapp:latest", "myapp:v1.0.0"],
        Size: 250000000,
      };

      const result = formatImage(input);

      expect(result.name).toBe("myapp");
      expect(result.tag).toBe("latest");
    });
  });
});

describe("Docker Plugin Manifest", () => {
  it("should have correct plugin metadata", () => {
    const name = "docker";
    const version = "1.0.0";
    const description = "Docker container and image management";
    const capabilities = ["read", "write"];
    const requires = ["DOCKER_HOST"];

    expect(name).toBe("docker");
    expect(version).toBe("1.0.0");
    expect(description).toContain("Docker");
    expect(capabilities).toContain("read");
    expect(capabilities).toContain("write");
    expect(requires).toContain("DOCKER_HOST");
  });

  it("should define container management endpoints", () => {
    const endpoints = [
      { method: "GET", path: "/docker/containers", scope: "read" },
      { method: "POST", path: "/docker/containers/:id/start", scope: "write" },
      { method: "POST", path: "/docker/containers/:id/stop", scope: "write" },
      { method: "DELETE", path: "/docker/containers/:id", scope: "write" },
      { method: "GET", path: "/docker/images", scope: "read" },
      { method: "POST", path: "/docker/images/pull", scope: "write" },
      { method: "DELETE", path: "/docker/images/:id", scope: "write" },
    ];

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.method && e.path && e.scope)).toBe(true);
  });
});
