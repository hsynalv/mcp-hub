# Plugin: brain

Semantic Kernel-inspired AI service for LLM integration. Provides skills, context memory, chat sessions, and task orchestration.

**Primary use cases:**
- AI summarizes long documents
- AI classifies text into categories
- AI extracts entities (person, org, date, email)
- AI answers questions based on context
- AI creates step-by-step plans for goals

---

## Setup

Add OpenAI API key to `.env`:

```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
# Optional overrides:
BRAIN_LLM_API_KEY=sk-xxxx  # Alternative key
BRAIN_LLM_URL=https://api.openai.com/v1  # Alternative endpoint
BRAIN_LLM_MODEL=gpt-4o-mini  # Default model
```

---

## Skills

| Skill | Description | Inputs | Outputs |
|-------|-------------|--------|---------|
| `summarize` | Summarize text | `text`, `maxLength` | `summary` |
| `classify` | Classify into categories | `text`, `categories` | `classification`, `confidence` |
| `extract_entities` | Extract named entities | `text` | `entities` |
| `ask` | Answer from context | `question`, `context` | `answer` |
| `plan` | Create execution plan | `goal`, `constraints` | `steps` |

---

## Endpoints

### `POST /brain/skills/:name/invoke`

Invoke a skill directly.

```bash
curl -X POST http://localhost:8787/brain/skills/summarize/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "text": "Long article content here...",
      "maxLength": 3
    }
  }'
```

### `POST /brain/chat`

Chat with context preservation.

```bash
curl -X POST http://localhost:8787/brain/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session-001",
    "message": "What did we discuss?",
    "systemPrompt": "You are a helpful assistant."
  }'
```

### `POST /brain/facts`

Store a fact in memory.

```bash
curl -X POST http://localhost:8787/brain/facts \
  -H "Content-Type: application/json" \
  -d '{
    "key": "api_url",
    "value": "https://api.example.com",
    "sessionId": "session-001"
  }'
```

### `GET /brain/facts`

Query stored facts by key prefix.

```bash
curl "http://localhost:8787/brain/facts?prefix=api_"
```

### `POST /brain/planner`

Create an execution plan (async or sync).

```bash
# Sync
curl -X POST http://localhost:8787/brain/planner \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Build a user authentication system",
    "constraints": "Use JWT tokens, no external services"
  }'

# Async (returns job ID)
curl -X POST http://localhost:8787/brain/planner \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "...",
    "async": true
  }'
```

### `POST /brain/generate`

Raw LLM text generation.

```bash
curl -X POST http://localhost:8787/brain/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a haiku about coding",
    "system": "You are a poet",
    "temperature": 0.9
  }'
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `brain_invoke_skill` | Invoke any registered skill |
| `brain_chat` | Chat with context and memory |
| `brain_store_fact` | Store a fact |
| `brain_recall_facts` | Query stored facts |
| `brain_list_skills` | List all available skills |
| `brain_generate` | Raw LLM generation |

---

## Architecture Notes

- **Context**: Per-session conversation history (last 20 messages)
- **Facts**: Key-value storage with timestamps
- **Skills**: Pure functions with defined inputs/outputs
- **Planner**: Uses `plan` skill with optional async job queue
