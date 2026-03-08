# Marketplace Plugin

Plugin market yönetimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/marketplace/plugins` | GET | Mevcut plugin'leri listele |
| `/marketplace/install` | POST | Plugin kur |
| `/marketplace/uninstall` | POST | Plugin kaldır |
| `/marketplace/update` | POST | Plugin güncelle |

## Özellikler

- Official registry
- Third-party plugin desteği
- Version management
- Dependency resolution

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `marketplace_list_plugins` | Mevcut plugin'leri listele |
| `marketplace_install` | Plugin kur |
| `marketplace_check_updates` | Güncelleme kontrolü |
