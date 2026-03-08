# Secrets Plugin

Güvenli credential depolama ve referans.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/secrets/list` | GET | Secret isimlerini listele (değer yok) |
| `/secrets/get/:name` | GET | Secret değerini al (auth required) |
| `/secrets/set` | POST | Secret ekle/güncelle |
| `/secrets/delete/:name` | DELETE | Secret sil |

## Özellikler

- Şifreli depolama
- Key-value yapısı
- API key rotasyonu desteği

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `secrets_list` | Mevcut secret'ları listele |
| `secrets_get` | Secret değerini al |

## Konfigürasyon

```env
SECRETS_ENCRYPTION_KEY=xxx  # Secret şifreleme için
```
