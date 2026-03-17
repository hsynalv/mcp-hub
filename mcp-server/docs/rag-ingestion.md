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

Set the optional environment variable to enable OCR for scanned PDFs:

```env
RAG_OCR_PROVIDER=tesseract
```

When `RAG_OCR_PROVIDER=tesseract`, the rag-ingestion plugin automatically registers the `TesseractOcrProvider` at startup. If not configured, scanned PDFs will fail with a clear error.

### Tesseract Provider (Built-in)

The `tesseract` provider uses tesseract.js and pdf2pic. It is registered automatically when `RAG_OCR_PROVIDER=tesseract`.

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_OCR_PROVIDER` | `""` | Set to `tesseract` to enable OCR |
| `RAG_OCR_TESSERACT_LANG` | `eng` | Tesseract language code |
| `RAG_OCR_PDF_DPI` | `150` | DPI for PDF→image conversion (higher = better quality, slower) |

**Runtime prerequisites:**
- `tesseract.js` and `pdf2pic` (npm packages, included when installed)
- GraphicsMagick or ImageMagick (system dependency for PDF→image conversion)

**Installation:** `npm install tesseract.js pdf2pic`  
**System:** `apt install graphicsmagick` (Ubuntu/Debian) or `brew install graphicsmagick` (macOS)

### Provider Registry

- **`getOcrProvider(name?)`** — Resolve provider by name, or use `RAG_OCR_PROVIDER` when `name` is omitted
- **`registerOcrProvider(name, instance)`** — Register an OCR implementation
- **`listOcrProviders()`** — List registered provider names

### Provider Interface

Implementations must extend `OcrProvider` and provide:

- `checkHealth()` — Returns `true` if the provider is available
- `extractFromImage(buffer, options)` — Extract text from an image buffer
- `extractFromPdfPage(pdfBuffer, pageIndex)` — Extract text from a PDF page

### Example (Tesseract)

```env
RAG_OCR_PROVIDER=tesseract
RAG_OCR_TESSERACT_LANG=eng
```

No code required — the provider is registered automatically when the plugin loads.

### Multi-Page Support

When OCR is used, the loader processes **all pages** of the PDF and concatenates the extracted text.
