# Database Plugin

Veritabanı sorgu desteği.

## Desteklenen Veritabanları

- PostgreSQL
- Microsoft SQL Server
- MongoDB

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/database/query` | POST | SQL/NoSQL sorgu çalıştır |
| `/database/connections` | GET | Bağlantı durumu |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `database_query` | SQL/NoSQL sorgu çalıştır |
| `database_list_tables` | Tabloları listele |
| `database_describe_table` | Tablo şemasını al |

## Konfigürasyon

```env
PG_CONNECTION_STRING=postgresql://...
MSSQL_CONNECTION_STRING=Server=...;Database=...;...
MONGODB_URI=mongodb://...
```
