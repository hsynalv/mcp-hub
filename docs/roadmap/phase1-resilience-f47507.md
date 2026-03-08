# Phase 1: Retry Logic ve Circuit Breaker Implementasyonu

Dış servis çağrılarına (GitHub, Notion, OpenAI) dayanıklılık katmak için retry mekanizması ve circuit breaker pattern eklenmesi.

---

## Hedefler

1. **Retry logic**: Exponential backoff ile 3-5 deneme
2. **Circuit breaker**: Servis down olduğunda hızlı fail
3. **Error categorization**: Network, rate limit, auth hatalarını ayır
4. **Health check v2**: Detaylı servis durumu endpoint'i

---

## Dosya Değişiklikleri

### Yeni Dosyalar

| Dosya | Amaç |
|-------|------|
| `src/core/resilience.js` | Retry ve circuit breaker fonksiyonları |
| `src/core/error-categories.js` | Hata kategorizasyonu |

### Güncellenecek Dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `src/plugins/github/github.client.js` | Retry + circuit breaker wrapper |
| `src/plugins/notion/index.js` | Retry wrapper ekleme |
| `src/plugins/brain/index.js` | OpenAI çağrılarına retry |
| `src/core/server.js` | Health check v2 endpoint |

---

## Implementasyon Adımları

### 1. Resilience Modülü

```javascript
// src/core/resilience.js
// - withRetry(fn, options)
// - createCircuitBreaker(name, options)
// - getCircuitState(name)
```

Config:
- `RETRY_MAX_ATTEMPTS=3`
- `RETRY_BACKOFF_MS=1000`
- `CIRCUIT_FAILURE_THRESHOLD=5`
- `CIRCUIT_RESET_TIMEOUT_MS=30000`

### 2. Error Kategorizasyonu

```javascript
// src/core/error-categories.js
// - categorizeError(error) -> { category, retryable, message }
// Categories: NETWORK, RATE_LIMIT, AUTH, NOT_FOUND, SERVER_ERROR, UNKNOWN
```

### 3. Client Güncellemeleri

GitHub client:
```javascript
const callWithResilience = withRetry(githubApiCall, {
  maxAttempts: 3,
  backoffMs: 1000,
  circuitBreaker: 'github'
});
```

### 4. Health Check v2

```javascript
// GET /health/detailed
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2024-03-05T...",
  "services": {
    "redis": { "status": "up", "latency_ms": 5 },
    "github": { "status": "up", "circuit_state": "closed" },
    "notion": { "status": "up", "circuit_state": "closed" },
    "openai": { "status": "up", "circuit_state": "closed" }
  }
}
```

---

## Başarı Kriterleri

- [ ] GitHub API timeout'unda 3 deneme yapılıyor
- [ ] 5xx hatası alınca circuit açılıyor
- [ ] Circuit açıkken hızlı fail (retry yok)
- [ ] Health check tüm servisleri gösteriyor
- [ ] Error mesajları kategoriye göre farklı

---

## Riskler

| Risk | Mitigasyon |
|------|-----------|
| Infinite loop | Max attempts limit |
| Memory leak | Circuit state Map ile track |
| Slow startup | Health check async parallel |

---

## Sonraki Adımlar

Bu phase tamamlanınca:
1. Test coverage artırma
2. API key rotation
3. Phase 2'ye geçiş (Jarvis özellikleri)
