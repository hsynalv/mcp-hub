# Database Plugin

MSSQL, PostgreSQL ve MongoDB için birleşik veritabanı API'si.

## Bağlantı

| Type | Env |
|------|-----|
| `postgres` | `PG_CONNECTION_STRING` veya `PG_HOST`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` |
| `mssql` | `MSSQL_CONNECTION_STRING` veya `MSSQL_HOST`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE` |
| `mongodb` | `MONGODB_URI` |

## Endpoint'ler

- `GET /database/tables?type=` — Tablo/collection listesi
- `GET /database/tables/:name/schema?type=` — Şema (sütunlar, primary key)
- `POST /database/query` — Raw SQL (pg: $1,$2; mssql: @p0,@p1) veya MongoDB aggregation
- `POST /database/crud/insert` — `{ type, table, data }`
- `POST /database/crud/select` — `{ type, table, where?, limit? }`
- `POST /database/crud/update` — `{ type, table, where, data }`
- `POST /database/crud/delete` — `{ type, table, where }`
- `GET /database/health`

## MongoDB Query

```json
{ "type": "mongodb", "query": { "collection": "users", "pipeline": [{ "$limit": 10 }] } }
```
veya
```json
{ "type": "mongodb", "query": { "collection": "users", "filter": { "active": true }, "options": { "limit": 10 } } }
```
