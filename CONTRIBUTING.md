# Contributing to AI-Hub

Thank you for your interest in contributing to AI-Hub! This document provides guidelines and information for contributors.

## 🚀 Quick Start

1. **Fork the repository**
   ```bash
   git clone [https://github.com/your-username/ai-hub.git](https://github.com/hsynalv/mcp-hub.git)
   cd ai-hub
   ```

2. **Install dependencies**
   ```bash
   cd mcp-server
   npm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

## 📋 How to Contribute

### 🐛 Bug Reports

- Use [GitHub Issues](https://github.com/your-org/ai-hub/issues) for bug reports
- Include:
  - Clear description of the issue
  - Steps to reproduce
  - Expected vs actual behavior
  - Environment details (OS, Node.js version, etc.)
  - Relevant logs

### 💡 Feature Requests

- Open an issue with the `enhancement` label
- Describe the use case and proposed solution
- Consider if it fits the project's vision

### 🔧 Plugin Development

We welcome new plugins! See [Plugin Development Guide](./mcp-server/docs/plugin-development.md).

**Plugin Ideas:**
- **CI/CD**: GitHub Actions, GitLab CI, Jenkins
- **Vector DB**: Pinecone, Chroma, Weaviate
- **Monitoring**: Datadog, New Relic, Prometheus
- **Email**: SendGrid, AWS SES, Gmail
- **Calendar**: Google Calendar, Outlook
- **Analytics**: Google Analytics, Mixpanel

### 📚 Documentation

- Improve existing documentation
- Add new examples and use cases
- Fix typos and clarify confusing sections
- Add translations (if applicable)

## 🏗️ Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-number-description
```

### 2. Make Changes

- Follow existing code style and patterns
- Add tests for new functionality
- Update documentation as needed
- Keep commits atomic and focused

### 3. Test Your Changes

```bash
# Run tests
npm test

# Run linting
npm run lint

# Test plugins manually
ENABLE_N8N_PLUGIN=false npm run dev
```

### 4. Commit Changes

```bash
git add .
git commit -m "feat: add new plugin for XYZ service

- Add XYZ plugin with full CRUD operations
- Include comprehensive error handling
- Add unit tests and integration tests
- Update documentation

Closes #123"
```

**Commit Message Format:**
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `style:` for code style changes
- `refactor:` for code refactoring
- `test:` for adding tests
- `chore:` for maintenance tasks

### 5. Create Pull Request

- Push to your fork
- Create PR from your branch to `main`
- Fill out the PR template completely
- Link relevant issues
- Wait for code review

## 🧪 Testing

### Unit Tests

```javascript
// tests/plugins/my-plugin.test.js
import { describe, it } from "node:test";
import assert from "node:assert";

describe("My Plugin", () => {
  it("should handle API errors gracefully", async () => {
    // Test implementation
  });
});
```

### Integration Tests

```javascript
// tests/integration.test.js
import { loadPlugins } from "../src/core/plugins.js";

describe("Plugin Integration", () => {
  it("should load all plugins without errors", async () => {
    const app = express();
    await loadPlugins(app);
    // Test plugin loading
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## 📝 Code Style

### JavaScript/TypeScript

- Use ES6+ features (async/await, destructuring, etc.)
- Follow existing naming conventions
- Add JSDoc comments for public functions
- Use Zod for input validation

### File Organization

```
src/plugins/plugin-name/
├── index.js              # Main plugin file
├── client.js             # API client (if needed)
├── README.md             # Plugin documentation
└── tests/               # Plugin tests
```

### Error Handling

- Use consistent error response format: `{ ok: false, error, message, details }`
- Include proper HTTP status codes
- Log errors with context
- Handle edge cases gracefully

## 🔒 Security

### Guidelines

- Never commit API keys or secrets
- Validate all user inputs
- Use environment variables for configuration
- Follow principle of least privilege
- Keep dependencies updated

### Security Reporting

For security vulnerabilities, please email: security@ai-hub.dev

- Do not open public issues
- Include steps to reproduce
- Provide impact assessment
- We'll respond within 48 hours

## 📦 Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):
- `MAJOR.MINOR.PATCH`
- Breaking changes: increment MAJOR
- New features: increment MINOR
- Bug fixes: increment PATCH

### Release Checklist

- [ ] All tests passing
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped
- [ ] Integration tests pass
- [ ] Security review completed

## 🤝 Community

### Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please:

- Be respectful and considerate
- Use inclusive language
- Focus on constructive feedback
- Help others learn and grow

### Getting Help

- **Discussions**: Use GitHub Discussions for questions
- **Issues**: For bugs and feature requests
- **Discord**: Join our community Discord (link in README)
- **Documentation**: Check [docs/](./docs/) first

## 🏆 Recognition

Contributors are recognized in:

- **README.md**: Contributors section
- **CHANGELOG.md**: Attributed changes
- **Releases**: Thank you notes
- **Website**: Featured contributors (coming soon)

## 📧 Contact

- **Maintainers**: maintainers@ai-hub.dev
- **Security**: security@ai-hub.dev
- **General**: hello@ai-hub.dev

---

Thank you for contributing to AI-Hub! Every contribution helps make AI agents more powerful and accessible. 🚀
