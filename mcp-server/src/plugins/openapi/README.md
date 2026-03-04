# Plugin: openapi

Load any OpenAPI/Swagger spec (by URL or raw body) and instantly generate n8n HTTP Request node JSON, curl commands, or JavaScript fetch snippets for any operation.

---

## Quick Start

### 1. Load a spec

```bash
# From URL
curl -X POST http://localhost:8787/openapi/load \
  -H "Content-Type: application/json" \
  -d '{"name": "petstore", "url": "https://petstore3.swagger.io/api/v3/openapi.json"}'

# From raw body (JSON or YAML string)
curl -X POST http://localhost:8787/openapi/load \
  -H "Content-Type: application/json" \
  -d '{"name": "my-api", "spec": {"openapi":"3.0.0","info":{"title":"My API","version":"1.0"},"paths":{}}}'
```

Response:
```json
{
  "ok": true,
  "id": "a1b2c3d4",
  "name": "petstore",
  "title": "Swagger Petstore - OpenAPI 3.0",
  "endpointCount": 19,
  "authTypes": [{"name":"petstore_auth","type":"oauth2","flows":["implicit"]},{"name":"api_key","type":"apiKey","in":"header","paramName":"api_key"}]
}
```

### 2. List specs

```bash
curl http://localhost:8787/openapi/specs
```

### 3. List endpoints

```bash
curl "http://localhost:8787/openapi/specs/a1b2c3d4/endpoints?method=GET&q=pet"
```

```json
{
  "ok": true,
  "count": 3,
  "endpoints": [
    { "operationId": "getPetById", "method": "GET", "path": "/pet/{petId}", "summary": "Find pet by ID", "tags": ["pet"] }
  ]
}
```

### 4. Generate code

```bash
curl -X POST http://localhost:8787/openapi/specs/a1b2c3d4/generate \
  -H "Content-Type: application/json" \
  -d '{"operationId": "getPetById", "target": "n8n"}'
```

```json
{
  "ok": true,
  "operationId": "getPetById",
  "target": "n8n",
  "code": {
    "type": "n8n-nodes-base.httpRequest",
    "parameters": {
      "method": "GET",
      "url": "https://petstore3.swagger.io/api/v3/pet/{petId}"
    }
  }
}
```

Or fetch the operation detail with all three targets at once:

```bash
curl http://localhost:8787/openapi/specs/a1b2c3d4/endpoints/getPetById
```

---

## Endpoints

| Method   | Path                                 | Scope    | Description                       |
|----------|--------------------------------------|----------|-----------------------------------|
| `POST`   | `/openapi/load`                      | `write`  | Load spec from URL or body        |
| `GET`    | `/openapi/specs`                     | `read`   | List all loaded specs             |
| `GET`    | `/openapi/specs/:id`                 | `read`   | Spec detail + auth types          |
| `GET`    | `/openapi/specs/:id/endpoints`       | `read`   | List all operations                |
| `GET`    | `/openapi/specs/:id/endpoints/:opId` | `read`   | Operation detail + code examples  |
| `POST`   | `/openapi/specs/:id/generate`        | `read`   | Generate code for an operation    |
| `DELETE` | `/openapi/specs/:id`                 | `danger` | Remove spec from disk             |
| `GET`    | `/openapi/health`                    | `read`   | Plugin health                     |

---

## Code Generation Targets

| Target  | Output                                   |
|---------|------------------------------------------|
| `n8n`   | `n8n-nodes-base.httpRequest` node JSON   |
| `curl`  | Ready-to-run curl command                |
| `fetch` | JavaScript `fetch()` snippet             |

---

## Endpoint Filtering

`GET /openapi/specs/:id/endpoints` supports optional query filters:

- `?q=text` — search in operationId, summary, path
- `?tag=pet` — filter by tag
- `?method=GET` — filter by HTTP method

---

## Configuration

```env
OPENAPI_CACHE_DIR=./cache/openapi   # where specs are stored
```

Specs are stored at `{OPENAPI_CACHE_DIR}/{id}.json`. IDs are derived from the spec name and are stable across reloads.

---

## Auth Type Detection

The plugin reads `securitySchemes` from the spec and returns detected auth types:

```json
[
  { "name": "api_key",  "type": "apiKey", "in": "header", "paramName": "X-API-Key" },
  { "name": "bearerAuth","type": "bearer" }
]
```

This tells the AI which credentials the target API requires.
