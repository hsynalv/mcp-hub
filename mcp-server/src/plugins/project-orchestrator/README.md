# Project Orchestrator Plugin

AI destekli proje scaffolding.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/project-orchestrator/create` | POST | Yeni proje oluştur |
| `/project-orchestrator/blueprint` | GET | Blueprint listesi |
| `/project-orchestrator/generate` | POST | Blueprint'ten proje üret |

## Blueprint'ler

- Node.js + Express API
- React + Vite frontend
- Python + FastAPI
- Go + Gin
- Docker + Compose

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `orchestrator_create_project` | Blueprint seç ve proje oluştur |
| `orchestrator_list_blueprints` | Mevcut blueprint'leri listele |
| `orchestrator_customize` | Mevcut projeyi özelleştir |

## Özellikler

- Auto-dependency kurulumu
- Config dosya oluşturma
- README template
- CI/CD config (opsiyonel)
