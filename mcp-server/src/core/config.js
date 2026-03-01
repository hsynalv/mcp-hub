import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 8787,
  n8n: {
    baseUrl: process.env.N8N_BASE_URL || "http://n8n:5678",
    apiBase: process.env.N8N_API_BASE || "/api/v1",
    apiKey: process.env.N8N_API_KEY || "",
    allowWrite: process.env.ALLOW_N8N_WRITE === "true",
  },
  catalog: {
    cacheDir: process.env.CATALOG_CACHE_DIR || "./cache",
    ttlHours: Number(process.env.CATALOG_TTL_HOURS) || 24,
  },
};
