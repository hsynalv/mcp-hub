# Plugin Development Guide

AI-Hub için yeni plugin geliştirme rehberi.

## Plugin Yapısı

Her plugin `src/plugins/<plugin-name>/` klasöründe bulunur ve şu dosyaları içerir:

```
src/plugins/my-plugin/
├── index.js              # Ana plugin dosyası
├── client.js             # API client (opsiyonel)
├── README.md             # Plugin dokümantasyonu
└── tests/               # Test dosyaları (opsiyonel)
```

## 1. Plugin Manifest

`index.js` dosyasında şu export'lar olmalı:

```javascript
export const name = "my-plugin";                    // Plugin adı
export const version = "1.0.0";                   // Semver versiyon
export const description = "Plugin description";        // Açıklama
export const capabilities = ["read", "write"];         // Yetenekler
export const requires = ["API_KEY"];                 // Gerekli env variable'ler
export const endpoints = [                            // Endpoint listesi
  { 
    method: "GET", 
    path: "/my-plugin/endpoint", 
    description: "Endpoint description", 
    scope: "read" 
  }
];
export const examples = [                              // Kullanım örnekleri
  "GET /my-plugin/endpoint",
  "POST /my-plugin/other-endpoint body: {data}"
];

// Zorunlu register fonksiyonu
export function register(app) {
  const router = Router();
  
  // Route'ları burada tanımla
  router.get("/endpoint", handler);
  
  // Plugin'i app'e mount et
  app.use("/my-plugin", router);
}
```

## 2. Template Plugin

### Basit Plugin Template

```javascript
// src/plugins/my-plugin/index.js
import { Router } from "express";
import { z } from "zod";
import { myApiClient } from "./my-api-client.js";

export const name = "my-plugin";
export const version = "1.0.0";
export const description = "My custom plugin for AI-Hub";
export const capabilities = ["read", "write"];
export const requires = ["MY_API_KEY"];
export const endpoints = [
  { method: "GET",    path: "/my-plugin/data",     description: "Get data from My API", scope: "read" },
  { method: "POST",   path: "/my-plugin/action",    description: "Perform action",         scope: "write" },
];
export const examples = [
  "GET  /my-plugin/data",
  "POST /my-plugin/action  body: {param: 'value'}",
];

// ── Zod schemas ───────────────────────────────────────────────
const actionSchema = z.object({
  param: z.string().min(1),
  option: z.string().optional(),
});

// ── Helpers ───────────────────────────────────────────────────
function err(res, status, error, message, details) {
  return res.status(status).json({ 
    ok: false, 
    error, 
    message, 
    details 
  });
}

function validate(schema, data, res) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    err(res, 400, "invalid_request", "Validation failed", parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

// ── Plugin register ───────────────────────────────────────────────
export function register(app) {
  const router = Router();

  /**
   * GET /my-plugin/data
   * Get data from My API
   */
  router.get("/data", async (req, res) => {
    try {
      const result = await myApiClient.getData();
      res.json({ ok: true, data: result });
    } catch (error) {
      err(res, 502, "api_error", "Failed to fetch data", error.message);
    }
  });

  /**
   * POST /my-plugin/action
   * Perform action with parameters
   */
  router.post("/action", async (req, res) => {
    const data = validate(actionSchema, req.body, res);
    if (!data) return;

    try {
      const result = await myApiClient.performAction(data);
      res.json({ ok: true, result });
    } catch (error) {
      err(res, 502, "action_failed", "Action failed", error.message);
    }
  });

  app.use("/my-plugin", router);
}
```

### API Client Template

```javascript
// src/plugins/my-plugin/my-api-client.js
import { config } from "../../core/config.js";

const MY_API_KEY = process.env.MY_API_KEY || "";
const MY_API_BASE = process.env.MY_API_BASE || "https://api.example.com";

/**
 * My API client
 */
export async function myApiClientRequest(method, endpoint, data = null) {
  try {
    if (!MY_API_KEY) {
      return {
        ok: false,
        error: "missing_api_key",
        details: { message: "MY_API_KEY environment variable is required" }
      };
    }

    const url = `${MY_API_BASE}/${endpoint}`;
    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${MY_API_KEY}`,
        "Content-Type": "application/json",
      },
    };

    if (data && (method === "POST" || method === "PUT")) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    const responseData = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: "api_error",
        details: {
          status: response.status,
          statusText: response.statusText,
          data: responseData,
        },
      };
    }

    return { ok: true, data: responseData };
  } catch (error) {
    return {
      ok: false,
      error: "connection_error",
      details: { message: error.message },
    };
  }
}

export const myApiClient = {
  getData: () => myApiClientRequest("GET", "data"),
  performAction: (data) => myApiClientRequest("POST", "action", data),
};
```

## 3. Advanced Plugin Özellikleri

### 3.1 Authentication

```javascript
// src/core/config.js'den config al
import { config } from "../../core/config.js";

export function register(app) {
  const router = Router();

  // Authentication middleware
  router.use((req, res, next) => {
    // Custom auth logic
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== config.myPlugin.apiKey) {
      return res.status(401).json({
        ok: false,
        error: "unauthorized",
        message: "Invalid API key"
      });
    }
    next();
  });

  // Route'lar...
}
```

### 3.2 Caching

```javascript
import { writeFile, readFile } from "fs/promises";
import { join } from "path";

const CACHE_DIR = join(process.cwd(), "cache", "my-plugin");

class CacheManager {
  static async get(key) {
    try {
      const filePath = join(CACHE_DIR, `${key}.json`);
      const data = await readFile(filePath, "utf8");
      const parsed = JSON.parse(data);
      
      // TTL kontrolü
      if (Date.now() > parsed.expiresAt) {
        return null;
      }
      
      return parsed.data;
    } catch {
      return null;
    }
  }

  static async set(key, data, ttlMinutes = 60) {
    await mkdir(CACHE_DIR, { recursive: true });
    
    const filePath = join(CACHE_DIR, `${key}.json`);
    const cacheData = {
      data,
      expiresAt: Date.now() + (ttlMinutes * 60 * 1000),
    };
    
    await writeFile(filePath, JSON.stringify(cacheData, null, 2));
  }
}

// Kullanımı
router.get("/cached-data", async (req, res) => {
  const cacheKey = "my-data";
  let data = await CacheManager.get(cacheKey);
  
  if (!data) {
    // Cache'te yoksa API'den çek
    data = await myApiClient.getData();
    await CacheManager.set(cacheKey, data, 30); // 30 dakika
  }
  
  res.json({ ok: true, data, cached: !!data });
});
```

### 3.3 Rate Limiting

```javascript
class RateLimiter {
  constructor(maxRequests = 60, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  isAllowed(clientId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.requests.has(clientId)) {
      this.requests.set(clientId, []);
    }
    
    const clientRequests = this.requests.get(clientId);
    
    // Eski request'leri temizle
    const validRequests = clientRequests.filter(time => time > windowStart);
    this.requests.set(clientId, validRequests);
    
    return validRequests.length < this.maxRequests;
  }

  getRemainingRequests(clientId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    const clientRequests = this.requests.get(clientId) || [];
    const validRequests = clientRequests.filter(time => time > windowStart);
    
    return Math.max(0, this.maxRequests - validRequests.length);
  }
}

const rateLimiter = new RateLimiter(30, 60000); // 30 request per minute

router.use((req, res, next) => {
  const clientId = req.ip || req.headers['x-forwarded-for'];
  
  if (!rateLimiter.isAllowed(clientId)) {
    return res.status(429).json({
      ok: false,
      error: "rate_limit_exceeded",
      message: "Too many requests",
      details: {
        remaining: rateLimiter.getRemainingRequests(clientId),
        resetIn: "1 minute"
      }
    });
  }
  
  // Rate limit headers
  res.set({
    'X-RateLimit-Limit': rateLimiter.maxRequests,
    'X-RateLimit-Remaining': rateLimiter.getRemainingRequests(clientId),
    'X-RateLimit-Reset': new Date(Date.now() + rateLimiter.windowMs).toISOString()
  });
  
  next();
});
```

### 3.4 Error Handling

```javascript
// Custom error sınıfları
export class PluginError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.details = details;
  }
}

export class APIError extends PluginError {
  constructor(message, apiResponse, details = null) {
    super(message, "api_error", details);
    this.apiResponse = apiResponse;
  }
}

// Error handling middleware
export function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] Plugin Error:`, err);

  if (err instanceof PluginError) {
    return res.status(400).json({
      ok: false,
      error: err.code,
      message: err.message,
      details: err.details
    });
  }

  if (err instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: "validation_error",
      message: "Invalid request data",
      details: err.errors
    });
  }

  // Genel error
  res.status(500).json({
    ok: false,
    error: "internal_error",
    message: "Internal server error"
  });
}

// Plugin'de kullanımı
router.use(errorHandler);
```

## 4. Testing

### 4.1 Unit Test Template

```javascript
// tests/my-plugin.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { myApiClient } from "../my-api-client.js";

describe("My Plugin", () => {
  beforeEach(() => {
    // Test setup
    process.env.MY_API_KEY = "test-key";
  });

  afterEach(() => {
    // Test cleanup
    delete process.env.MY_API_KEY;
  });

  describe("API Client", () => {
    it("should make successful API request", async () => {
      const result = await myApiClient.getData();
      
      assert.strictEqual(result.ok, true);
      assert.ok(result.data);
    });

    it("should handle API errors", async () => {
      process.env.MY_API_KEY = "invalid-key";
      
      const result = await myApiClient.getData();
      
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, "api_error");
    });
  });

  describe("Plugin Routes", () => {
    it("should return data from GET /data", async () => {
      const app = express();
      register(app);
      
      const response = await request(app)
        .get("/my-plugin/data")
        .expect(200);
      
      assert.strictEqual(response.body.ok, true);
      assert.ok(response.body.data);
    });
  });
});
```

### 4.2 Integration Test

```javascript
// tests/integration.test.js
import { describe, it } from "node:test";
import assert from "node:assert";
import { loadPlugins } from "../src/core/plugins.js";
import express from "express";

describe("Plugin Integration", () => {
  it("should load plugin successfully", async () => {
    const app = express();
    await loadPlugins(app);
    
    // Plugin'in yüklendiğini kontrol et
    const plugins = getPlugins();
    const myPlugin = plugins.find(p => p.name === "my-plugin");
    
    assert.ok(myPlugin);
    assert.strictEqual(myPlugin.version, "1.0.0");
  });

  it("should register routes correctly", async () => {
    const app = express();
    await loadPlugins(app);
    
    // Route'un çalıştığını test et
    const response = await request(app)
      .get("/my-plugin/data")
      .expect(200);
      
    assert.strictEqual(response.body.ok, true);
  });
});
```

## 5. Configuration

### 5.1 Environment Variables

```javascript
// src/core/config.js'e ekle
export const config = {
  // ... mevcut config
  myPlugin: {
    apiKey: process.env.MY_API_KEY || "",
    baseUrl: process.env.MY_API_BASE || "https://api.example.com",
    timeout: Number(process.env.MY_API_TIMEOUT) || 30000,
    cacheTtl: Number(process.env.MY_CACHE_TTL) || 300,
  },
};
```

### 5.2 .env.example Güncelleme

```bash
# ── My Plugin ───────────────────────────────────────────────────────
# API key for My Service
MY_API_KEY=

# Base URL for My API (optional)
MY_API_BASE=https://api.example.com

# Request timeout in milliseconds (optional)
MY_API_TIMEOUT=30000

# Cache TTL in seconds (optional)
MY_CACHE_TTL=300
```

## 6. Best Practices

### 6.1 Security
- Input validation için Zod kullanın
- API keys'i environment variable'lerde saklayın
- Rate limiting implement edin
- HTTPS kullanın
- Sensitive verileri log'larda göstermeyin

### 6.2 Performance
- Cache mekanizması kurun
- Pagination destekleyin
- Async/await pattern'lerini kullanın
- Memory leak'lerden kaçının

### 6.3 Error Handling
- Consistent error format'ı kullanın
- Proper HTTP status code'leri dönün
- Error log'ları tutun
- User-friendly error mesajları sağlayın

### 6.4 Documentation
- README.md dosyası ekleyin
- Endpoint'leri belgeleyin
- Kullanım örnekleri sunun
- Environment variable'leri açıklayın

## 7. Plugin Submission

Geliştirdiğiniz plugin'i topluluğa katmak için:

1. **Test Edin:** Tüm test'leri geçtiğinden emin olun
2. **Dokümantasyon:** README.md ve inline comments ekleyin
3. **PR Oluşturun:** GitHub'a pull request gönderin
4. **Review:** Community feedback'ini bekleyin

### Plugin Checklist

- [ ] Plugin manifest export'ları tamam
- [ ] Error handling implement edildi
- [ ] Input validation var
- [ ] Rate limiting (gerekirse)
- [ ] Cache mekanizması (gerekirse)
- [ ] Unit test'ler yazıldı
- [ ] Integration test'ler var
- [ ] README.md dokümantasyonu tamam
- [ ] .env.example güncellendi
- [ ] Security review yapıldı

Bu rehber ile AI-Hub için güçlü plugin'ler geliştirebilirsiniz!
