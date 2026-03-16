# Contributing to MCP-Hub

Thank you for your interest in contributing to MCP-Hub. This document provides guidelines for contributing.

## Development Setup

```bash
cd mcp-server
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

## Code Style

- **ESLint** and **Prettier** are used for consistency
- Pre-commit hooks run format automatically
- Run `npm run lint` before submitting
- Run `npm run format` to fix formatting

## Testing

```bash
npm test           # Watch mode (development)
npm run test:run   # Single run (CI)
npm run test:coverage  # Coverage report
```

All new features and bug fixes should include tests.

## Commit Messages

Format: `<type>: <description>`

| Type | Use For |
|------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change (no behavior change) |
| `test:` | Adding or updating tests |
| `chore:` | Build, config, dependencies |
| `perf:` | Performance improvement |
| `security:` | Security fix |

**Examples:**
- `feat: add workspace isolation to RAG plugin`
- `fix: prevent path traversal in file-storage`
- `docs: update plugin SDK examples`

## Plugin Development

1. Create `src/plugins/<name>/index.js`
2. Export: `register`, `metadata` (or `name`/`version`), optionally `tools`
3. Add `plugin.meta.json` for metadata validation
4. Write tests in `tests/plugins/<name>.test.js`
5. Add a README in the plugin folder

See [Plugin SDK](mcp-server/docs/plugin-sdk.md) for best practices.

**Scaffold a new plugin:**
```bash
npm run create-plugin my-plugin "My plugin description"
```

## Pull Request Process

1. Create a branch: `git checkout -b feat/your-feature` or `fix/your-fix`
2. Make your changes
3. Run tests: `npm run test:run`
4. Run lint: `npm run lint`
5. Update documentation if needed
6. Open a PR with a clear description
7. Ensure CI passes

## Issue Reporting

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template for bugs
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template for new ideas
- Search existing issues before creating a new one

## Security

- Do not commit secrets, API keys, or credentials
- Report security vulnerabilities privately (see [SECURITY.md](SECURITY.md))
- Use placeholder values in examples (e.g. `sk-xxx`, `ghp_xxx`)

## Questions

- Open a [Discussion](https://github.com/your-org/mcp-hub/discussions) for questions
- Open an [Issue](https://github.com/your-org/mcp-hub/issues) for bugs or features
