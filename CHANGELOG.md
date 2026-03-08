# CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Plugin quality standards with `plugin.meta.json` schema
- Contract testing framework for plugins
- Tool chain analysis and parameter sanitization in security-guard
- Workspace entity model with context middleware
- Correlation ID tracking for observability
- RAG source connectors (GitHub, Notion, File)
- LLM Router cost and latency tracking
- Database abstraction layer with repository pattern
- OpenAPI spec generation from tool registry
- README validation tool

### Changed
- Improved plugin loader with metadata validation
- Enhanced error handling with standardized envelopes
- Updated vitest config with coverage thresholds

### Security
- Added security-guard for dangerous tool chain detection
- Implemented parameter sanitization for SQL injection, path traversal
- Added scope-based authorization checks

## [1.0.0] - 2024

### Added
- Plugin-tabanlı mimari
- MCP (Model Context Protocol) desteği
- REST API
- Policy motoru
- Job kuyruğu (Redis/Memory)
- 30+ plugin entegrasyonu
- Auth scope sistemi (read/write/admin)
- Tool registry
- Observability dashboard

### Plugin'ler
- GitHub entegrasyonu
- Notion entegrasyonu
- n8n entegrasyonu
- Veritabanı (PostgreSQL, MSSQL, MongoDB)
- Dosya depolama (S3, Google Drive, Local)
- Slack bildirimleri
- Git operasyonları
- RAG (Retrieval Augmented Generation)
- LLM router (OpenAI, Claude)
- Ve daha fazlası...

### Security
- API key auth
- Policy-based onay workflow'ları
- Rate limiting
- Scope-based yetkilendirme
