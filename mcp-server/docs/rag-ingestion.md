# RAG Ingestion

Document ingestion pipeline for the RAG plugin: load → normalize → chunk → enrich → index.

## Pipeline Overview

1. **Load** — Load document by format (markdown, text, pdf)
2. **Normalize** — Clean and standardize content
3. **Chunk** — Split into chunks (fixed, sliding, heading, semantic)
4. **Enrich** — Add metadata (documentId, sourceType, etc.)
5. **Embed** — Generate embeddings (optional)
6. **Index** — Store chunks in vector store

## Supported Formats

- **markdown** — Markdown documents
- **text** — Plain text
- **pdf** — PDF documents (text-based or scanned)

## OCR Integration

The pipeline supports **scanned PDFs** via an optional OCR provider. When PDF text extraction returns no text (image-based PDF), the loader falls back to OCR.

### Behavior

| PDF Type      | Extraction Method | Requirement                    |
|---------------|-------------------|--------------------------------|
| Text-based    | pdf-parse         | None (built-in)                |
| Scanned       | OCR provider      | `RAG_OCR_PROVIDER` configured  |

### Configuration

Set the optional environment variable to use a registered OCR provider:

```env
RAG_OCR_PROVIDER=tesseract
```

The provider must be registered via `registerOcrProvider()` before ingestion. If not configured, scanned PDFs will fail with a clear error.

### Provider Registry

- **`getOcrProvider(name?)`** — Resolve provider by name, or use `RAG_OCR_PROVIDER` when `name` is omitted
- **`registerOcrProvider(name, instance)`** — Register an OCR implementation
- **`listOcrProviders()`** — List registered provider names

### Provider Interface

Implementations must extend `OcrProvider` and provide:

- `checkHealth()` — Returns `true` if the provider is available
- `extractFromImage(buffer, options)` — Extract text from an image buffer
- `extractFromPdfPage(pdfBuffer, pageIndex)` — Extract text from a PDF page

### Example

```js
import { registerOcrProvider } from "./plugins/rag-ingestion/ocr/index.js";
import { MyOcrProvider } from "./my-ocr-provider.js";

const provider = new MyOcrProvider({ language: "eng" });
registerOcrProvider("tesseract", provider);
// Set RAG_OCR_PROVIDER=tesseract in .env
```

### Multi-Page Support

When OCR is used, the loader processes **all pages** of the PDF and concatenates the extracted text.
