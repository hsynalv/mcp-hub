# Environment Variables

Copy `.env.example` to `.env` and configure.

> **Security**: Never commit `.env` or real credentials. All values below are placeholders. Replace with your own keys from the respective service dashboards.

## Server

```env
PORT=8787
NODE_ENV=development
```

## Auth

```env
HUB_READ_KEY=your-read-key
HUB_WRITE_KEY=your-write-key
HUB_ADMIN_KEY=your-admin-key
```

## Project Context

```env
REQUIRE_PROJECT_HEADERS=false
DEFAULT_PROJECT_ID=default-project
DEFAULT_ENV=default-env
```

## GitHub

```env
GITHUB_TOKEN=ghp_xxx
```

## Notion

```env
NOTION_API_KEY=secret_xxx
NOTION_ROOT_PAGE_ID=xxx
NOTION_PROJECTS_DB_ID=xxx
NOTION_TASKS_DB_ID=xxx
```

## n8n

```env
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=n8n_api_xxx
ENABLE_N8N_PLUGIN=true
ENABLE_N8N_CREDENTIALS=true
ENABLE_N8N_WORKFLOWS=true
```

## Database

```env
PG_CONNECTION_STRING=postgresql://...
MSSQL_CONNECTION_STRING=Server=...;Database=...;...
MONGODB_URI=mongodb://...
```

## File Storage

```env
FILE_STORAGE_LOCAL_ROOT=./storage
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
S3_BUCKET_NAME=my-bucket
```

## LLM

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## RAG (Document indexing)

```env
RAG_VECTOR_STORE_TYPE=memory
RAG_EMBEDDING_MODEL=text-embedding-3-small
# Optional: OCR for scanned PDFs. Set to "tesseract" to enable.
RAG_OCR_PROVIDER=
# Tesseract language (default: eng)
RAG_OCR_TESSERACT_LANG=eng
```

**OCR prerequisites:** When `RAG_OCR_PROVIDER=tesseract`, install `tesseract.js` and `pdf2pic` (npm), plus GraphicsMagick or ImageMagick (system).

## Redis (Optional)

```env
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=mcp-hub:
```

## Sentry (Optional)

```env
SENTRY_DSN=https://...
```
