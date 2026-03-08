# Local Setup

## Gereksinimler

- Node.js >= 18
- npm >= 9
- Git

## Kurulum

```bash
# Repo'yu klonla
git clone https://github.com/hsynalv/mcp-hub.git
cd mcp-hub/mcp-server

# Bağımlılıkları kur
npm install

# Config oluştur
cp .env.example .env

# .env dosyasını düzenle (gerekli API key'ler)
nano .env
```

## Çalıştırma

```bash
# Geliştirme (auto-reload)
npm run dev

# Production
npm start
```

## Doğrulama

```bash
# Sağlık kontrolü
curl http://localhost:8787/health

# Plugin'leri listele
curl http://localhost:8787/plugins
```
