import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 8787,
  auth: {
    readKey:  process.env.HUB_READ_KEY?.trim()  || "",
    writeKey: process.env.HUB_WRITE_KEY?.trim() || "",
    adminKey: process.env.HUB_ADMIN_KEY?.trim() || "",
  },
  audit: {
    logToFile: process.env.AUDIT_LOG_FILE === "true",
  },
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
  notion: {
    apiKey: process.env.NOTION_API_KEY || "",
    rootPageId: process.env.NOTION_ROOT_PAGE_ID || "",
    projectsDbId: process.env.NOTION_PROJECTS_DB_ID || "",
    tasksDbId: process.env.NOTION_TASKS_DB_ID || "",
  },
  http: {
    allowedDomains:   process.env.HTTP_ALLOWED_DOMAINS || "",
    blockedDomains:   process.env.HTTP_BLOCKED_DOMAINS || "",
    maxResponseSizeKb:Number(process.env.HTTP_MAX_RESPONSE_SIZE_KB) || 512,
    defaultTimeoutMs: Number(process.env.HTTP_DEFAULT_TIMEOUT_MS) || 10000,
    rateLimitRpm:     Number(process.env.HTTP_RATE_LIMIT_RPM) || 60,
    cacheTtlSeconds:  Number(process.env.HTTP_CACHE_TTL_SECONDS) || 300,
  },
  openapi: {
    cacheDir: process.env.OPENAPI_CACHE_DIR || "./cache/openapi",
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || "",
  },
  fileStorage: {
    localRoot: process.env.FILE_STORAGE_LOCAL_ROOT || "./cache/files",
    maxFileSizeMb: Number(process.env.FILE_STORAGE_MAX_MB) || 50,
  },
  database: {
    mssqlConnectionString: process.env.MSSQL_CONNECTION_STRING || "",
    pgConnectionString: process.env.PG_CONNECTION_STRING || "",
    mongodbUri: process.env.MONGODB_URI || "",
  },
  plugins: {
    enableN8n: process.env.ENABLE_N8N_PLUGIN !== "false",
    enableN8nCredentials: process.env.ENABLE_N8N_CREDENTIALS !== "false", 
    enableN8nWorkflows: process.env.ENABLE_N8N_WORKFLOWS !== "false",
  },
  redis: {
    url: process.env.REDIS_URL || "",
    enabled: !!process.env.REDIS_URL,
    keyPrefix: process.env.REDIS_PREFIX || "mcp-hub:",
    ttlSeconds: Number(process.env.REDIS_TTL_SECONDS) || 86400, // 24 hours
  },
};
