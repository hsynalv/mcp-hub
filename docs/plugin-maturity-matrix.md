# Plugin Maturity Matrix

This document provides a comprehensive overview of all MCP Hub plugins and their production readiness.

## Overview

| Plugin | Description | Status | Auth | Tests | Docs |
|--------|-------------|--------|------|-------|------|
| github | GitHub repo read/analyze | 🟢 stable | yes | yes | yes |
| notion | Notion pages/databases | 🟢 stable | yes | yes | yes |
| llm-router | LLM routing & cost tracking | 🟢 stable | no | yes | yes |
| slack | Slack messaging/bots | 🟢 stable | yes | yes | yes |
| git | Git operations | 🟢 stable | no | yes | yes |
| database | MSSQL/PostgreSQL/MongoDB | 🟡 beta | no | no | yes |
| file-storage | S3/GDrive/local files | 🟡 beta | no | no | yes |
| rag | Document indexing/search | 🟡 beta | no | no | yes |
| http | Controlled outbound HTTP | 🟡 beta | no | no | yes |
| policy | Policy engine/guardrails | 🟡 beta | no | no | yes |
| secrets | Secret reference system | 🟡 beta | no | no | yes |
| workspace | File operations | 🟡 beta | no | no | yes |
| observability | Health/metrics/dashboard | 🟡 beta | no | no | yes |
| n8n | n8n workflow management | 🟡 beta | yes | no | yes |
| docker | Container management | 🟡 beta | yes | no | yes |
| shell | Shell command execution | 🔴 experimental | yes | no | yes |
| email | SMTP/IMAP email | 🔴 experimental | yes | no | yes |
| openapi | OpenAPI spec analyzer | 🔴 experimental | no | no | yes |
| brain | Knowledge memory | 🔴 experimental | no | no | yes |
| code-review | Automated code review | 🔴 experimental | no | no | yes |
| file-watcher | File change monitoring | 🔴 experimental | no | no | yes |
| github-pattern-analyzer | Pattern detection | 🔴 experimental | no | no | yes |
| image-gen | Image generation | 🔴 experimental | yes | no | yes |
| local-sidecar | Local service bridge | 🔴 experimental | no | no | yes |
| marketplace | Plugin marketplace | 🔴 experimental | no | no | yes |
| n8n-credentials | n8n credential mgmt | 🔴 experimental | yes | no | yes |
| n8n-workflows | n8n workflow templates | 🔴 experimental | no | no | yes |
| notifications | Multi-channel notifications | 🔴 experimental | yes | no | yes |
| project-orchestrator | Project automation | 🔴 experimental | no | no | yes |
| projects | Project management | 🔴 experimental | no | no | yes |
| prompt-registry | Prompt templates | 🔴 experimental | no | no | yes |
| repo-intelligence | Repo analysis | 🔴 experimental | no | no | yes |
| tech-detector | Technology detection | 🔴 experimental | no | no | yes |
| tests | Test runner plugin | 🔴 experimental | no | no | yes |
| video-gen | Video generation | 🔴 experimental | yes | no | yes |

## Status Legend

- 🟢 **stable** - Production ready, well tested, documented
- 🟡 **beta** - Functional but may have edge cases
- 🔴 **experimental** - Early development, use with caution

## Plugin Categories

### Core / Production Ready (🟢 stable)

These plugins have comprehensive documentation, tests, and metadata:

| Plugin | Use Case |
|--------|----------|
| github | Repository analysis, PR management |
| notion | Knowledge base integration |
| llm-router | Cost-effective LLM routing |
| slack | Team notifications |
| git | Repository operations |

### Beta (🟡 beta)

Functional plugins needing more testing or documentation:

| Plugin | Use Case |
|--------|----------|
| database | Multi-database queries |
| file-storage | Cloud/local file operations |
| rag | Document search |
| http | Controlled API calls |
| policy | Guardrails & approval flows |
| secrets | Secure credential management |
| workspace | Project file operations |
| observability | Monitoring & metrics |
| n8n | Workflow automation |
| docker | Container management |

### Experimental (🔴 experimental)

Early stage plugins:

| Plugin | Use Case |
|--------|----------|
| shell | Command execution (dangerous) |
| email | Email automation |
| openapi | API spec analysis |
| image-gen | AI image generation |
| video-gen | AI video generation |
| brain | Knowledge memory |
| code-review | Automated reviews |
| All others | Various specialized functions |

## Authentication Requirements

Plugins marked **yes** in the Auth column require environment variables to be set:

- **github** - `GITHUB_TOKEN`
- **notion** - `NOTION_API_KEY`
- **slack** - `SLACK_BOT_TOKEN`
- **database** - Connection strings per DB type
- **n8n** - `N8N_API_KEY`
- **docker** - `DOCKER_HOST`
- **shell** - None (but sandboxed)
- **email** - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- **image-gen** - Provider API keys
- **video-gen** - Provider API keys
- **n8n-credentials** - `N8N_API_KEY`
- **notifications** - Various service tokens

## Using This Matrix

When selecting plugins for production:

1. **Start with stable plugins** - They have the most testing
2. **Check auth requirements** - Ensure env vars are configured
3. **Review docs** - Each plugin has a README with examples
4. **Test beta plugins** - In staging before production
5. **Avoid experimental** - Unless you need specific features

## Contributing

To improve a plugin's maturity status:

1. Add `plugin.meta.json` following the schema
2. Create comprehensive tests
3. Update README with examples
4. Submit PR for review
