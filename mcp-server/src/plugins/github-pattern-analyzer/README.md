# GitHub Pattern Analyzer Plugin

GitHub repo pattern analizi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/github-patterns/analyze` | POST | Pattern analizi |
| `/github-patterns/compare` | POST | Repo karşılaştırma |
| `/github-patterns/trends` | GET | Trend pattern'leri |

## Analiz Türleri

- Commit pattern'leri
- Branch stratejileri
- PR review süreçleri
- Issue kategorizasyonu
- Contributor davranışları

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `github_patterns_analyze` | Pattern analizi yap |
| `github_patterns_compare` | İki repo karşılaştır |
| `github_patterns_get_trends` | Trend analizi al |

## Örnek

```json
{
  "repo": "owner/repo",
  "analysisType": "commit_patterns",
  "timeRange": "last_90_days"
}
```
