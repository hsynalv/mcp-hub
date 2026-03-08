# Prompt Registry Plugin

Sistem prompt yönetimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/prompts` | GET | Tüm prompt'ları listele |
| `/prompts/:name` | GET | Belirli prompt'u al |
| `/prompts` | POST | Yeni prompt ekle |
| `/prompts/:name` | PUT | Prompt güncelle |
| `/prompts/:name/render` | POST | Değişkenleri doldur ve render et |

## Prompt Formatı

```yaml
name: code-review
version: 1.0.0
template: |
  Review this {{language}} code for:
  - Security issues
  - Performance problems
  - Best practices
  
  Code:
  {{code}}
variables:
  - language
  - code
```

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `prompts_list` | Mevcut prompt'ları listele |
| `prompts_get` | Prompt al |
| `prompts_render` | Değişkenlerle render et |
