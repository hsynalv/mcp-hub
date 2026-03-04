import { Router } from "express";
import { z } from "zod";
import { dockerRequest } from "./docker.client.js";

export const name = "docker";
export const version = "1.0.0";
export const description = "Docker container and image management";
export const capabilities = ["read", "write"];
export const requires = ["DOCKER_HOST"];
export const endpoints = [
  { method: "GET",    path: "/docker/containers",           description: "List all containers",                     scope: "read"  },
  { method: "GET",    path: "/docker/containers/:id",       description: "Get container details",                    scope: "read"  },
  { method: "POST",   path: "/docker/containers/:id/start", description: "Start a container",                        scope: "write" },
  { method: "POST",   path: "/docker/containers/:id/stop",  description: "Stop a container",                         scope: "write" },
  { method: "POST",   path: "/docker/containers/:id/restart", description: "Restart a container",                      scope: "write" },
  { method: "DELETE", path: "/docker/containers/:id",       description: "Remove a container",                       scope: "write" },
  { method: "GET",    path: "/docker/images",               description: "List all images",                          scope: "read"  },
  { method: "POST",   path: "/docker/images/pull",          description: "Pull an image from registry",              scope: "write" },
  { method: "DELETE", path: "/docker/images/:id",           description: "Remove an image",                          scope: "write" },
  { method: "GET",    path: "/docker/info",                 description: "Docker system information",                 scope: "read"  },
  { method: "GET",    path: "/docker/logs/:id",              description: "Get container logs",                       scope: "read"  },
];
export const examples = [
  "GET  /docker/containers",
  "POST /docker/containers/abc123/start",
  "POST /docker/images/pull  body: { image: 'nginx:latest' }",
];

// ── Zod schemas ───────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(res, status, error, message, details) {
  return res.status(status).json({ ok: false, error, message, details });
}

function validate(schema, data, res) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    err(res, 400, "invalid_request", "Validation failed", parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

function formatContainer(container) {
  return {
    id: container.Id?.slice(0, 12) ?? "",
    name: container.Names?.[0]?.replace(/^\//, "") ?? "",
    image: container.Image ?? "",
    status: container.Status ?? "",
    state: container.State ?? "",
    ports: container.Ports?.map(p => ({
      container: p.PrivatePort,
      host: p.PublicPort,
      hostIp: p.IP,
      type: p.Type,
    })) ?? [],
    created: container.Created ?? null,
    labels: container.Labels ?? {},
  };
}

function formatImage(image) {
  return {
    id: image.Id?.slice(0, 12) ?? "",
    repoTags: image.RepoTags ?? [],
    created: image.Created ?? null,
    size: image.Size ?? 0,
    virtualSize: image.VirtualSize ?? 0,
  };
}

// ── Plugin register ───────────────────────────────────────────────────────────

export function register(app) {
  const router = Router();

  // ── Containers ──────────────────────────────────────────────────────────────

  /**
   * GET /docker/containers
   * List all containers (running and stopped).
   * 
   * Query params:
   *   all = true|false (default: false) - include stopped containers
   */
  router.get("/containers", async (req, res) => {
    const all = req.query.all === "true";
    const result = await dockerRequest("GET", `/containers/json?all=${all}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const containers = (result.data ?? []).map(formatContainer);
    res.json({ ok: true, count: containers.length, containers });
  });

  /**
   * GET /docker/containers/:id
   * Get detailed information about a specific container.
   */
  router.get("/containers/:id", async (req, res) => {
    const containerId = req.params.id;
    const result = await dockerRequest("GET", `/containers/${containerId}/json`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, container: formatContainer(result.data) });
  });

  /**
   * POST /docker/containers/:id/start
   * Start a stopped container.
   */
  router.post("/containers/:id/start", async (req, res) => {
    const containerId = req.params.id;
    const result = await dockerRequest("POST", `/containers/${containerId}/start`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, message: `Container ${containerId} started` });
  });

  /**
   * POST /docker/containers/:id/stop
   * Stop a running container.
   */
  router.post("/containers/:id/stop", async (req, res) => {
    const containerId = req.params.id;
    const result = await dockerRequest("POST", `/containers/${containerId}/stop`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, message: `Container ${containerId} stopped` });
  });

  /**
   * POST /docker/containers/:id/restart
   * Restart a container.
   */
  router.post("/containers/:id/restart", async (req, res) => {
    const containerId = req.params.id;
    const result = await dockerRequest("POST", `/containers/${containerId}/restart`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, message: `Container ${containerId} restarted` });
  });

  /**
   * DELETE /docker/containers/:id
   * Remove a container.
   */
  router.delete("/containers/:id", async (req, res) => {
    const containerId = req.params.id;
    const force = req.query.force === "true";
    const result = await dockerRequest("DELETE", `/containers/${containerId}?force=${force}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, message: `Container ${containerId} removed` });
  });

  // ── Images ───────────────────────────────────────────────────────────────────

  /**
   * GET /docker/images
   * List all available images.
   */
  router.get("/images", async (req, res) => {
    const result = await dockerRequest("GET", "/images/json");
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    const images = (result.data ?? []).map(formatImage);
    res.json({ ok: true, count: images.length, images });
  });

  /**
   * POST /docker/images/pull
   * Pull an image from a registry.
   * 
   * Body: { image: "nginx", tag?: "latest" }
   */
  router.post("/images/pull", async (req, res) => {
    const data = validate(pullImageSchema, req.body, res);
    if (!data) return;

    const imageName = data.tag ? `${data.image}:${data.tag}` : data.image;
    const result = await dockerRequest("POST", "/images/create", null, { fromImage: imageName });
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, message: `Image ${imageName} pulled successfully` });
  });

  /**
   * DELETE /docker/images/:id
   * Remove an image.
   */
  router.delete("/images/:id", async (req, res) => {
    const imageId = req.params.id;
    const force = req.query.force === "true";
    const result = await dockerRequest("DELETE", `/images/${imageId}?force=${force}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, message: `Image ${imageId} removed` });
  });

  // ── System ──────────────────────────────────────────────────────────────────

  /**
   * GET /docker/info
   * Get Docker system information.
   */
  router.get("/info", async (req, res) => {
    const result = await dockerRequest("GET", "/info");
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    res.json({ ok: true, info: result.data });
  });

  /**
   * GET /docker/logs/:id
   * Get logs from a container.
   * 
   * Query params:
   *   tail = number of lines to show from the end (default: 100)
   *   follow = true|false (default: false) - stream logs
   */
  router.get("/logs/:id", async (req, res) => {
    const containerId = req.params.id;
    const tail = req.query.tail ?? "100";
    const follow = req.query.follow === "true";
    
    const params = new URLSearchParams({
      stdout: "true",
      stderr: "true",
      tail: tail,
      follow: follow.toString(),
    });

    const result = await dockerRequest("GET", `/containers/${containerId}/logs?${params}`);
    if (!result.ok) return err(res, 502, result.error, result.details?.message, result.details);

    // Docker logs come as raw stream, parse them
    const logs = (result.data ?? "")
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        // Remove Docker log header (8 bytes)
        if (line.length > 8) {
          return line.slice(8);
        }
        return line;
      });

    res.json({ ok: true, containerId, logs });
  });

  app.use("/docker", router);
}
