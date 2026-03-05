# Tech Stack Detector Plugin

Automatically detect technologies used in a project by analyzing file patterns, dependencies, and configurations.

## Overview

The Tech Stack Detector analyzes project directories to identify:
- **Languages**: JavaScript, TypeScript, Python, Go, Rust, Java, etc.
- **Frameworks**: React, Vue, Next.js, Django, Flask, Express, etc.
- **Databases**: PostgreSQL, MongoDB, Redis, MySQL, etc.
- **Tools**: Docker, Kubernetes, GitHub Actions, etc.
- **Architectures**: Microservices, Monolith, Serverless

## MCP Tools

### `tech_detect`

Analyze a project directory and return detected technologies.

**Parameters:**
- `path` (string, required): Path to project directory
- `options` (object): Detection options (includeDevDependencies, confidenceThreshold)

**Example:**
```json
{
  "path": "./my-project",
  "options": {
    "includeDevDependencies": true,
    "confidenceThreshold": 0.7
  }
}
```

**Returns:**
```json
{
  "technologies": [
    { "name": "Next.js", "type": "framework", "confidence": 0.95 },
    { "name": "TypeScript", "type": "language", "confidence": 0.98 },
    { "name": "PostgreSQL", "type": "database", "confidence": 0.85 }
  ],
  "architecture": "fullstack",
  "recommendations": [...]
}
```

### `tech_recommend`

Get technology stack recommendations based on project requirements.

**Parameters:**
- `type` (string): Project type (web-app, api, mobile, cli)
- `scale` (string): Project scale (small, medium, large)
- `priorities` (array): Priority factors (performance, cost, scalability, developer-experience)

**Example:**
```json
{
  "type": "web-app",
  "scale": "medium",
  "priorities": ["performance", "developer-experience"]
}
```

### `tech_compare`

Compare two technologies with pros/cons.

**Parameters:**
- `optionA` (string): First technology
- `optionB` (string): Second technology

**Example:**
```json
{
  "optionA": "nextjs",
  "optionB": "react"
}
```

## REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/tech/detect` | Detect technologies in project |
| POST | `/tech/recommend` | Get stack recommendations |
| POST | `/tech/compare` | Compare technologies |

## Usage Examples

### Detect Tech Stack
```bash
curl -X POST http://localhost:8787/tech/detect \
  -H "Content-Type: application/json" \
  -d '{"path": "./src"}'
```

### Get Recommendations
```bash
curl -X POST http://localhost:8787/tech/recommend \
  -H "Content-Type: application/json" \
  -d '{
    "type": "api",
    "scale": "large",
    "priorities": ["performance", "scalability"]
  }'
```

### Compare Technologies
```bash
curl -X POST http://localhost:8787/tech/compare \
  -H "Content-Type: application/json" \
  -d '{"optionA": "nextjs", "optionB": "remix"}'
```

## Detection Method

The detector uses multiple signals:
1. **File patterns**: `package.json`, `requirements.txt`, `Cargo.toml`
2. **File extensions**: `.ts`, `.py`, `.go`, `.rs`
3. **Config files**: `tsconfig.json`, `next.config.js`, `Dockerfile`
4. **Dependencies**: Analyzes package names and versions
5. **Heuristics**: Scoring based on file counts and patterns

## Environment Variables

None required. The plugin uses file system access only.

## Supported Technologies

### Languages
- JavaScript, TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP

### Frameworks
- React, Vue, Angular, Svelte, Next.js, Remix, Nuxt
- Express, Fastify, NestJS, Django, Flask, FastAPI
- Spring Boot, ASP.NET, Laravel

### Databases
- PostgreSQL, MySQL, MongoDB, Redis, SQLite, DynamoDB

### Tools & Platforms
- Docker, Kubernetes, AWS, GCP, Azure
- GitHub Actions, GitLab CI, CircleCI
- Jest, Vitest, Cypress, Playwright
