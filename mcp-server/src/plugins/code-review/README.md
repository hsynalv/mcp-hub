# Code Review Plugin

Otomatik kod inceleme ve analiz.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/code-review/analyze` | POST | Kod analizi yap |
| `/code-review/pr` | POST | PR inceleme |
| `/code-review/suggest` | POST | İyileştirme önerileri |

## Desteklenen Diller

- JavaScript/TypeScript
- Python
- Go
- Java
- C/C++

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `code_review_analyze` | Dosya veya kod snippet'i analiz et |
| `code_review_pr` | GitHub PR incele |
| `code_review_suggest_fixes` | Otomatik düzeltme öner |

## Özellikler

- Security issue tespiti
- Performance analizi
- Style guide uyumluluğu
- Best practice önerileri
