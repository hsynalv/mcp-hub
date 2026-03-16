# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MCP-Hub, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainers or use GitHub Security Advisories if available
3. Include a description of the vulnerability and steps to reproduce
4. Allow time for a fix before public disclosure

We will acknowledge your report and work on a fix. We appreciate responsible disclosure.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Security Practices

- **Secrets**: Never commit API keys, tokens, or credentials. Use `.env` and ensure it is in `.gitignore`
- **Auth**: Use strong, unique values for `HUB_READ_KEY`, `HUB_WRITE_KEY`, `HUB_ADMIN_KEY`
- **Network**: Run behind HTTPS in production; avoid exposing MCP-Hub directly to the internet without auth
- **Plugins**: Review plugin permissions; use `allowedPlugins` and `allowed_operations` for workspace isolation

See [Workspace Security](mcp-server/docs/workspace-security-model.md) and [Security Model](docs/security-model.md) for more details.
