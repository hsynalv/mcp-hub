# Video Generation Plugin

AI-powered video generation for demos, tutorials, promotional content, and avatar presentations.

## Overview

Generate professional videos using:
- **Runway Gen-3**: High-quality text-to-video and image-to-video
- **Pika Labs**: Fast video generation from prompts
- **HeyGen**: AI avatar videos with realistic speech

## Supported Video Types

| Type | Description | Best For |
|------|-------------|----------|
| `demo` | Product demonstrations | App walkthroughs, features |
| `tutorial` | Educational content | How-to guides, explanations |
| `promo` | Marketing videos | Product launches, ads |
| `intro` | Video intros | Channel intros, presentations |
| `social` | Social media content | Short-form, viral content |
| `general` | Custom videos | Any purpose |

## Providers

| Provider | Models | Max Duration | Features |
|----------|--------|--------------|----------|
| **Runway** | Gen-3, Gen-2 | 10 seconds | Text-to-video, Image-to-video |
| **Pika** | Pika 1.5 | 3 seconds | Fast generation |
| **HeyGen** | Avatar | Varies | Talking head videos |

## MCP Tools

### `video_generate`

Generate a video from text prompt.

**Parameters:**
- `prompt` (string, required): Text description
- `type` (string): Video type (demo, tutorial, promo, intro, social)
- `provider` (string): Provider (runway, pika)
- `duration` (number): Seconds (max 10 for Runway, 3 for Pika)
- `ratio` (string): Aspect ratio (16:9, 9:16, 1:1, 4:3)
- `imageUrl` (string): Optional image for image-to-video

**Example:**
```json
{
  "prompt": "mobile app onboarding flow, smooth camera movements",
  "type": "demo",
  "provider": "runway",
  "duration": 5,
  "ratio": "16:9"
}
```

**Returns:**
```json
{
  "id": "vid-123456",
  "provider": "runway",
  "generationId": "gen-abc123",
  "status": "pending",
  "estimatedTime": 60,
  "message": "Video generation started. Use video_check_status with id \"vid-123456\" to check progress."
}
```

### `video_check_status`

Check video generation status.

**Parameters:**
- `id` (string, required): Video generation ID

**Example:**
```json
{
  "id": "vid-123456"
}
```

**Returns:**
```json
{
  "id": "vid-123456",
  "status": "completed",
  "url": "https://cdn.runwayml.com/video.mp4",
  "progress": 100,
  "provider": "runway"
}
```

### `video_generate_avatar`

Generate avatar/presentation video with HeyGen.

**Parameters:**
- `text` (string, required): Script for avatar to speak
- `avatarId` (string, required): HeyGen avatar ID
- `voiceId` (string): Voice ID (optional)
- `backgroundType` (string): color or image
- `backgroundValue` (string): Hex color or image URL

**Example:**
```json
{
  "text": "Welcome to our product demo. Today I'll show you the key features...",
  "avatarId": "avatar-123",
  "voiceId": "en-US-Standard",
  "backgroundType": "color",
  "backgroundValue": "#f0f0f0"
}
```

### `video_enhance_prompt`

Get enhanced video prompt suggestions.

**Parameters:**
- `basePrompt` (string): Basic description
- `type` (string): Video type

**Example:**
```json
{
  "basePrompt": "app features showcase",
  "type": "demo"
}
```

**Returns:**
```json
{
  "original": "app features showcase",
  "enhanced": "Product demo video: app features showcase. Smooth camera movements, professional lighting...",
  "type": "demo"
}
```

### `video_list`

List generated videos.

**Returns:**
```json
{
  "total": 8,
  "videos": [
    {
      "id": "vid-123",
      "type": "demo",
      "provider": "runway",
      "status": "completed",
      "url": "https://..."
    }
  ]
}
```

## REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/video/generate` | Generate new video |
| GET | `/video/status/:id` | Check generation status |
| POST | `/video/avatar` | Generate avatar video |
| GET | `/video/list` | List generated videos |

## Usage Examples

### Generate Product Demo
```bash
curl -X POST http://localhost:8787/video/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "smooth camera pan across modern dashboard interface",
    "type": "demo",
    "provider": "runway",
    "duration": 10,
    "ratio": "16:9"
  }'
```

### Generate Tutorial Video
```bash
curl -X POST http://localhost:8787/video/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "step-by-step code tutorial visualization",
    "type": "tutorial",
    "provider": "pika",
    "ratio": "16:9"
  }'
```

### Create Avatar Video
```bash
curl -X POST http://localhost:8787/video/avatar \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! Let me introduce our new feature...",
    "avatarId": "avatar-123",
    "backgroundType": "color",
    "backgroundValue": "#ffffff"
  }'
```

### Check Status
```bash
curl http://localhost:8787/video/status/vid-123456
```

## Provider Comparison

| Feature | Runway Gen-3 | Pika Labs | HeyGen |
|---------|--------------|-----------|--------|
| Quality | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Speed | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Duration | 10s max | 3s max | Varies |
| Text-to-Video | ✅ | ✅ | N/A |
| Image-to-Video | ✅ | ✅ | N/A |
| Avatar | ❌ | ❌ | ✅ |
| Cost | $$$ | $$ | $$$ |

## Aspect Ratios

| Ratio | Best For |
|-------|----------|
| `16:9` | YouTube, presentations, widescreen |
| `9:16` | TikTok, Instagram Reels, Stories |
| `1:1` | Instagram, Twitter, square formats |
| `4:3` | Traditional video, slides |

## Prompt Enhancement

The plugin automatically enhances prompts based on type:

| Type | Enhancement Added |
|------|-------------------|
| `demo` | "Product demo video... Smooth camera movements, professional lighting, 4K quality..." |
| `tutorial` | "Tutorial video... Clear and educational, step-by-step visualization..." |
| `promo` | "Promotional video... Dynamic and engaging, marketing style..." |
| `intro` | "Video intro... Short and impactful, logo reveal..." |
| `social` | "Social media video... Attention-grabbing, vertical format optimized..." |

## Generation Time

| Provider | Typical Duration |
|----------|------------------|
| Runway Gen-3 | 60-120 seconds |
| Pika Labs | 30-60 seconds |
| HeyGen | 60-180 seconds |

## Environment Variables

```env
# Runway (required for Runway generation)
RUNWAY_API_KEY=rw-...

# Pika Labs (required for Pika generation)
PIKA_API_KEY=pika-...

# HeyGen (required for avatar videos)
HEYGEN_API_KEY=hg-...

# Default output directory
VIDEO_OUTPUT_DIR=./generated/videos
```

## Cost Estimation

| Provider | Cost per Video | Notes |
|----------|----------------|-------|
| Runway Gen-3 | ~$0.10-0.50 | Based on duration |
| Pika Labs | ~$0.05-0.15 | Per generation |
| HeyGen | ~$0.50-2.00 | Based on video length |

## Use Cases

### Product Marketing
```json
{
  "prompt": "smooth 3D product rotation, elegant lighting",
  "type": "promo",
  "provider": "runway",
  "duration": 10,
  "ratio": "9:16"
}
```

### Educational Content
```json
{
  "prompt": "animated explanation of API workflow",
  "type": "tutorial",
  "provider": "runway",
  "ratio": "16:9"
}
```

### Social Media
```json
{
  "prompt": "viral tech product reveal",
  "type": "social",
  "provider": "pika",
  "ratio": "9:16"
}
```

### Avatar Presentation
```json
{
  "text": "Welcome to our platform. I'm your AI assistant...",
  "avatarId": "avatar-business",
  "voiceId": "en-US-Neural2-F"
}
```

## Async Nature

Video generation is asynchronous. The flow:

1. **Submit**: Call `video_generate` → Get generation ID
2. **Poll**: Call `video_check_status` every 10-30 seconds
3. **Download**: When status is `completed`, download from URL

### Example Polling Script
```bash
#!/bin/bash
ID=$1
while true; do
  STATUS=$(curl -s http://localhost:8787/video/status/$ID | jq -r '.data.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "completed" ]; then
    echo "Video ready!"
    break
  fi
  sleep 30
done
```
