# GitHub Plugin

GitHub API entegrasyonu.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/github/repos` | GET | Kullanıcının repoları |
| `/github/analyze?repo=owner/repo` | GET | Repo analizi |
| `/github/pulls` | POST | PR oluştur |
| `/github/pulls?repo=owner/repo` | GET | PR'ları listele |
| `/github/branches` | POST | Branch oluştur |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `github_analyze_repo` | Repo analizi yap |
| `github_create_pr` | PR oluştur |
| `github_list_prs` | PR'ları listele |
| `github_create_branch` | Branch oluştur |

## Konfigürasyon

```env
GITHUB_TOKEN=ghp_xxx  # Private repolar için gerekli
```
