# Tech Detector Plugin

Teknoloji stack tespiti.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/tech/detect` | POST | Repo/dizin analiz et |
| `/tech/report` | GET | Detaylı rapor |

## Tespit Edilen Teknolojiler

- Programlama dilleri
- Framework'ler
- Veritabanları
- Build araçları
- CI/CD sistemleri
- Cloud sağlayıcılar

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `tech_detect_stack` | Proje stack'ini analiz et |
| `tech_detect_dependencies` | Bağımlılıkları analiz et |
| `tech_generate_report` | Detaylı rapor oluştur |

## Örnek

```json
{
  "path": "./my-project",
  "includeDevDependencies": true
}
```
