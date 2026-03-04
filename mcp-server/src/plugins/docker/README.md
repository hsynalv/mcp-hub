# Docker Plugin

Docker container ve image yönetimi için AI-Hub plugin'i.

## Kurulum

Environment variable'i ayarlayın:

```bash
# Docker socket path (default: /var/run/docker.sock)
DOCKER_HOST=/var/run/docker.sock
```

## Endpoint'ler

### Container Yönetimi

#### GET /docker/containers
Tüm container'ları listeler.

**Query params:**
- `all=true` - Durmuş container'ları da dahil et

**Yanıt:**
```json
{
  "ok": true,
  "count": 2,
  "containers": [
    {
      "id": "abc123456789",
      "name": "my-nginx",
      "image": "nginx:latest",
      "status": "Up 2 hours",
      "state": "running",
      "ports": [
        {
          "container": 80,
          "host": 8080,
          "hostIp": "0.0.0.0",
          "type": "tcp"
        }
      ],
      "created": "2024-01-15T10:30:00.000Z",
      "labels": {}
    }
  ]
}
```

#### GET /docker/containers/:id
Belirli bir container'ın detaylarını getirir.

#### POST /docker/containers/:id/start
Container'ı başlatır.

#### POST /docker/containers/:id/stop
Container'ı durdurur.

#### POST /docker/containers/:id/restart
Container'ı yeniden başlatır.

#### DELETE /docker/containers/:id
Container'ı siler.

**Query params:**
- `force=true` - Zorla sil (çalışan container için)

### Image Yönetimi

#### GET /docker/images
Tüm image'ları listeler.

#### POST /docker/images/pull
Registry'den image çeker.

**Body:**
```json
{
  "image": "nginx",
  "tag": "latest"
}
```

#### DELETE /docker/images/:id
Image'ı siler.

### Sistem Bilgisi

#### GET /docker/info
Docker sistem bilgilerini getirir.

#### GET /docker/logs/:id
Container log'larını getirir.

**Query params:**
- `tail=100` - Sondan kaç satır
- `follow=true` - Log stream'i takip et

## Kullanım Örnekleri

### AI Agent için

```javascript
// Tüm container'ları listele
const containers = await fetch("http://localhost:8787/docker/containers");

// Container başlat
await fetch("http://localhost:8787/docker/containers/abc123/start", {
  method: "POST"
});

// Image çek
await fetch("http://localhost:8787/docker/images/pull", {
  method: "POST",
  body: JSON.stringify({ image: "redis", tag: "alpine" })
});
```

### cURL ile

```bash
# Container'ları listele
curl -s http://localhost:8787/docker/containers?all=true

# Container durdur
curl -X POST http://localhost:8787/docker/containers/my-nginx/stop

# Image çek
curl -X POST http://localhost:8787/docker/images/pull \
  -H "Content-Type: application/json" \
  -d '{"image": "postgres", "tag": "15"}'
```

## Güvenlik

- Docker socket erişimi gerektirir
- Sadece yetkili kullanıcılar kullanmalı
- Container silme işlemleri geri alınamaz

## Hata Yönetimi

- Docker socket erişim hatası: `docker_connection_error`
- API hataları: `docker_api_error`
- Validation hataları: `invalid_request`

## Notlar

- Unix socket üzerinden iletişim kurar
- Tüm Docker API endpoint'lerini destekler
- Real-time log takibi desteklenir
