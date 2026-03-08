# Repo Intelligence Plugin

Repo analizi ve AI özeti.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/repo/analyze` | POST | Detaylı repo analizi |
| `/repo/summary` | GET | AI-generated özet |
| `/repo/insights` | GET | Kod kalitesi içgörüleri |

## Analiz İçeriği

- Kod karmaşıklığı
- Test coverage
- Bağımlılık ağacı
- Contributor aktivitesi
- Issue/PR istatistikleri

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `repo_analyze` | Detaylı repo analizi yap |
| `repo_get_summary` | AI özet al |
| `repo_get_insights` | Kalite içgörüleri al |

## Entegrasyon

GitHub plugin ile birlikte çalışır.
