# LLM Router Plugin

Multi-LLM gateway with routing, fallback, and cost control.

## Overview

This plugin routes LLM tasks to the optimal provider based on:
- Task type (coding, analysis, documentation, etc.)
- Provider capabilities
- Cost efficiency
- Availability (with automatic fallback)

## Supported Providers

| Provider | Models | Cost Tier | Key Strength |
|----------|--------|-----------|--------------|
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4-turbo | medium | general, coding, image-gen |
| Anthropic | claude-3-opus, claude-3-sonnet, claude-3-haiku | high | reasoning, long-context |
| Google | gemini-1.5-pro, gemini-1.5-flash | low | multilingual, summarization |
| Mistral | mistral-large, mistral-small | low | cost-effective |
| Ollama | llama3, codellama, mistral | free | local, privacy |

## Routing Logic

Tasks are automatically routed to the best provider:

| Task Type | Primary | Fallback |
|-----------|---------|----------|
| backend_api | anthropic/claude-3-opus | openai/gpt-4o |
| frontend_component | openai/gpt-4o | anthropic/claude-3-sonnet |
| code_review | anthropic/claude-3-sonnet | openai/gpt-4o |
| debugging | anthropic/claude-3-opus | openai/gpt-4o |
| documentation | openai/gpt-4o-mini | mistral/small |
| testing | openai/gpt-4o | anthropic/claude-3-haiku |
| image_generation | openai/dall-e-3 | none |
| fast | google/gemini-1.5-flash | openai/gpt-4o-mini |
| local | ollama/llama3 | none |
| general | openai/gpt-4o-mini | mistral/small |

## Configuration

```env
# Timeout (default: 60s)
LLM_TIMEOUT_MS=60000

# Token Limits
LLM_MAX_INPUT_TOKENS=128000
LLM_MAX_OUTPUT_TOKENS=4096
LLM_MAX_PROMPT_LENGTH=100000

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
MISTRAL_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
```

## API Endpoints

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| `/llm/route` | POST | write | Route task to LLM |
| `/llm/compare` | POST | write | Compare multiple providers |
| `/llm/models` | GET | read | List available models |
| `/llm/estimate-cost` | POST | read | Estimate cost before routing |
| `/llm/audit` | GET | read | View audit log (prompts never logged) |

## MCP Tools

| Tool | Description |
|------|-------------|
| `llm_route` | Route prompt to optimal provider |
| `llm_route_backend` | Specialized for backend API tasks |
| `llm_route_frontend` | Specialized for frontend component tasks |
| `llm_compare` | Compare responses from multiple providers |
| `llm_list_models` | List all available models |
| `llm_estimate_cost` | Estimate cost for a task |

## Security Features

### 1. Prompt Safety
- **Max prompt length:** 100K chars (configurable via `LLM_MAX_PROMPT_LENGTH`)
- **Max output tokens:** 4096 (configurable via `LLM_MAX_OUTPUT_TOKENS`)
- Validation rejects oversized prompts before sending to provider

### 2. Timeout Governance
- **Default timeout:** 60 seconds (configurable via `LLM_TIMEOUT_MS`)
- AbortController cancels requests exceeding timeout
- Prevents hanging requests and resource exhaustion

### 3. Cost Control
- Cost estimation before routing (`llm_estimate_cost`)
- Token limits enforced
- Provider selection considers cost tier

### 4. Provider Isolation
- API keys never logged
- Keys passed directly to provider SDKs
- No key exposure in error messages

### 5. Audit Logging (Prompts NEVER Logged)

**Logged fields:**
- timestamp, operation, provider, model, task
- inputTokens, outputTokens (counts only)
- promptLength, responseLength (lengths only)
- durationMs, actor, workspaceId, projectId
- correlationId, success, error, fallback, retryCount

**NEVER logged:**
- Prompt content
- LLM response content
- API keys
- Request headers

### 6. Error Normalization

Standardized error codes:
- `prompt_limit_exceeded` - Prompt too large
- `provider_unavailable` - Provider not configured
- `invalid_provider` - Unsupported provider for task
- `llm_error` - General LLM failure
- `comparison_error` - Comparison failed

### 7. Resilience
- Automatic fallback on primary provider failure
- Circuit breaker pattern (via withResilience)
- Retry with exponential backoff (max 2 retries)

## Usage Examples

### Route a task
```bash
curl -X POST /llm/route \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: ws-1" \
  -d '{
    "task": "backend_api",
    "prompt": "Create a REST API for user management",
    "options": { "temperature": 0.7, "maxTokens": 2000 }
  }'
```

### Compare providers
```bash
curl -X POST /llm/compare \
  -H "Content-Type: application/json" \
  -d '{
    "task": "coding",
    "prompt": "Write a function to sort arrays",
    "providers": ["openai", "anthropic"]
  }'
```

### Estimate cost
```bash
curl -X POST /llm/estimate-cost \
  -H "Content-Type: application/json" \
  -d '{
    "task": "backend_api",
    "promptTokens": 1000,
    "responseTokens": 2000
  }'
```

### View audit log
```bash
curl -X GET "/llm/audit?limit=50"
# Returns: { audit: [{ timestamp, provider, model, durationMs, ... }] }
# Note: Prompt content is NEVER included
```

## Production Checklist

- [ ] All required API keys configured
- [ ] `LLM_TIMEOUT_MS` set appropriately (default: 60s)
- [ ] `LLM_MAX_PROMPT_LENGTH` set based on use case
- [ ] `LLM_MAX_OUTPUT_TOKENS` set to prevent runaway costs
- [ ] Audit log monitoring configured
- [ ] Fallback providers verified for critical tasks
- [ ] Cost estimation integrated into workflow
- [ ] Circuit breaker thresholds tuned

## Architecture

```
Request → validatePromptLimits → routeTask
   ↓
Select Provider → Check API Key
   ↓
withResilience (circuit + retry)
   ↓
Provider API Call (with timeout)
   ↓
Audit Log (metadata only) → Return Result
