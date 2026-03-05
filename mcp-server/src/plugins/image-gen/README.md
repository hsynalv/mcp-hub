# Image Generation Plugin

AI-powered image generation for logos, mockups, diagrams, icons, and UI assets.

## Overview

Generate professional images using:
- **OpenAI DALL-E 3**: High-quality, detailed images
- **OpenAI DALL-E 2**: Cost-effective, fast generation
- **Stability AI**: Alternative provider, Stable Diffusion models

## Supported Image Types

| Type | Description | Best For |
|------|-------------|----------|
| `logo` | Professional logo designs | Branding, apps |
| `mockup` | UI/UX mockups | Dashboards, interfaces |
| `icon` | App icons | iOS, Android, web |
| `diagram` | Technical diagrams | Documentation, presentations |
| `banner` | Marketing banners | Website headers, ads |
| `avatar` | Character avatars | Profiles, bots |
| `general` | Custom images | Any purpose |

## MCP Tools

### `image_generate`

Generate an image from text prompt.

**Parameters:**
- `prompt` (string, required): Text description
- `type` (string): Image type (logo, mockup, icon, etc.)
- `provider` (string): Provider (openai, stability)
- `size` (string): Dimensions (1024x1024, 1792x1024, 1024x1792)
- `quality` (string): DALL-E 3 only (standard, hd)
- `style` (string): DALL-E 3 only (vivid, natural)
- `outputPath` (string): Save path (optional, returns base64 if not set)

**Example:**
```json
{
  "prompt": "modern fintech dashboard",
  "type": "mockup",
  "provider": "openai",
  "size": "1792x1024",
  "quality": "hd",
  "style": "vivid",
  "outputPath": "./assets/dashboard-mockup.png"
}
```

**Returns:**
```json
{
  "id": "img-123456",
  "path": "./assets/dashboard-mockup.png",
  "provider": "openai",
  "model": "dall-e-3",
  "size": "1792x1024",
  "revisedPrompt": "A modern financial technology dashboard interface..."
}
```

### `image_generate_variations`

Generate variations of an existing image (DALL-E 2 only).

**Parameters:**
- `imagePath` (string, required): Path to source image
- `n` (number): Number of variations (1-4)
- `size` (string): 256x256, 512x512, or 1024x1024

**Example:**
```json
{
  "imagePath": "./assets/logo.png",
  "n": 4,
  "size": "1024x1024"
}
```

### `image_enhance_prompt`

Get enhanced prompt suggestions for better results.

**Parameters:**
- `basePrompt` (string): Your basic description
- `type` (string): Image type

**Example:**
```json
{
  "basePrompt": "payment app logo",
  "type": "logo"
}
```

**Returns:**
```json
{
  "original": "payment app logo",
  "enhanced": "Professional logo design: payment app logo. Clean, minimalist, vector style...",
  "type": "logo"
}
```

### `image_list`

List all generated images.

**Returns:**
```json
{
  "total": 15,
  "images": [
    {
      "id": "img-123",
      "prompt": "modern dashboard UI...",
      "provider": "openai",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

## REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/image/generate` | Generate new image |
| POST | `/image/variations` | Generate variations |
| GET | `/image/list` | List generated images |

## Usage Examples

### Generate Logo
```bash
curl -X POST http://localhost:8787/image/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "fintech startup logo",
    "type": "logo",
    "size": "1024x1024"
  }'
```

### Generate UI Mockup
```bash
curl -X POST http://localhost:8787/image/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "e-commerce product page",
    "type": "mockup",
    "size": "1792x1024",
    "quality": "hd"
  }'
```

### Enhance Prompt
```bash
curl -X POST http://localhost:8787/image/enhance \
  -H "Content-Type: application/json" \
  -d '{
    "basePrompt": "mobile app icon",
    "type": "icon"
  }'
```

## Provider Comparison

| Feature | DALL-E 3 | DALL-E 2 | Stability AI |
|---------|----------|----------|--------------|
| Quality | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Speed | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Cost | $$$ | $$ | $$ |
| Variations | ❌ | ✅ | ✅ |
| Sizes | 3 options | 3 options | 3 options |

## Size Options

### DALL-E 3
- `1024x1024` — Square (default)
- `1792x1024` — Landscape
- `1024x1792` — Portrait

### DALL-E 2
- `256x256`
- `512x512`
- `1024x1024`

### Stability AI
- `1024x1024`
- `512x512`
- `768x768`

## Environment Variables

```env
# OpenAI (required for DALL-E)
OPENAI_API_KEY=sk-...

# Stability AI (optional, for alternative provider)
STABILITY_API_KEY=sk-...

# Default output directory
IMAGE_OUTPUT_DIR=./generated/images
```

## Prompt Enhancement

The plugin automatically enhances prompts based on type:

| Type | Enhancement Added |
|------|-------------------|
| `logo` | "Professional logo design... Clean, minimalist, vector style..." |
| `mockup` | "UI/UX mockup... Modern interface design, clean layout..." |
| `icon` | "App icon design... Simple, recognizable, scalable..." |
| `diagram` | "Technical diagram... Clean infographic style..." |
| `banner` | "Marketing banner... Eye-catching, modern design..." |

## Rate Limits

| Provider | Requests/Min | Notes |
|----------|--------------|-------|
| DALL-E 3 | 5 | Images per minute |
| DALL-E 2 | 10 | Images per minute |
| Stability | Varies | Based on plan |

## Cost Estimation

| Provider | Size | Cost |
|----------|------|------|
| DALL-E 3 Standard | 1024x1024 | $0.040 |
| DALL-E 3 HD | 1024x1024 | $0.080 |
| DALL-E 3 HD | 1792x1024 | $0.120 |
| DALL-E 2 | 1024x1024 | $0.020 |
| DALL-E 2 | 512x512 | $0.018 |
| DALL-E 2 | 256x256 | $0.016 |

## Use Cases

### Project Documentation
```json
{
  "prompt": "system architecture diagram",
  "type": "diagram",
  "size": "1792x1024"
}
```

### Marketing Materials
```json
{
  "prompt": "product launch banner",
  "type": "banner",
  "size": "1792x1024"
}
```

### App Development
```json
{
  "prompt": "fitness tracking app",
  "type": "mockup",
  "size": "1024x1792"
}
```
