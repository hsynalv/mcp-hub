# Tests Plugin

Test çalıştırma ve sonuç raporlama.

## Desteklenen Test Framework'leri

- Jest
- Vitest
- Mocha
- Pytest (Python)

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/tests/run` | POST | Testleri çalıştır |
| `/tests/status/:id` | GET | Test durumu |
| `/tests/results/:id` | GET | Test sonuçları |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `tests_run` | Belirli test dosyasını çalıştır |
| `tests_run_suite` | Tüm test suite'i çalıştır |
| `tests_get_results` | Son test sonuçlarını al |

## Örnek Kullanım

```json
{
  "framework": "vitest",
  "path": "./tests",
  "pattern": "*.test.js"
}
```
