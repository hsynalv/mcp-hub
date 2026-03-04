# Slack Plugin

Slack team communication ve bot entegrasyonu için AI-Hub plugin'i.

## Kurulum

Environment variable'i ayarlayın:

```bash
# Slack Bot Token (xoxb- ile başlamalı)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
```

Bot Token oluşturmak için:
1. [Slack API](https://api.slack.com/apps) sayfasına gidin
2. "Create New App" → "From scratch"
3. "Bots" bölümüne gidin
4. Bot permissions ekleyin:
   - `channels:read` - Kanal listesi için
   - `channels:history` - Mesaj geçmişi için
   - `chat:write` - Mesaj göndermek için
   - `files:write` - Dosya yüklemek için
   - `reactions:write` - Reaksiyon eklemek için
   - `users:read` - Kullanıcı listesi için
5. "Install to Workspace" butonuna tıklayın
6. Bot token'ı kopyalayın

## Endpoint'ler

### Kanal Yönetimi

#### GET /slack/channels
Bot'un erişebileceği tüm kanalları listeler.

**Query params:**
- `types=public_channel,private_channel,im,mpim` - Kanal tipleri
- `limit=100` - Max sonuç sayısı

**Yanıt:**
```json
{
  "ok": true,
  "count": 5,
  "channels": [
    {
      "id": "C1234567890",
      "name": "general",
      "display_name": "general",
      "purpose": "Company-wide announcements and work-based matters",
      "topic": "Company wide announcements and work based matters",
      "type": "public_channel",
      "is_archived": false,
      "created": 1449252889,
      "member_count": 25
    }
  ]
}
```

#### GET /slack/channels/:id
Belirli bir kanalın detaylarını getirir.

#### GET /slack/conversations/:id/history
Kanalın mesaj geçmişini getirir.

**Query params:**
- `limit=50` - Max mesaj sayısı
- `cursor=abc123` - Sayfalama için cursor

### Mesajlaşma

#### POST /slack/message
Kanala mesaj gönderir.

**Body:**
```json
{
  "channel": "C1234567890",
  "text": "Hello from AI-Hub!",
  "thread_ts": "1234567890.123456",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Hello!* This is a message from AI-Hub."
      }
    }
  ]
}
```

#### POST /slack/reactions/add
Mesaja reaksiyon ekler.

**Body:**
```json
{
  "channel": "C1234567890",
  "timestamp": "1234567890.123456",
  "name": "thumbsup"
}
```

### Kullanıcı Yönetimi

#### GET /slack/users
Workspace'teki tüm kullanıcıları listeler.

**Query params:**
- `limit=100` - Max sonuç sayısı
- `cursor=abc123` - Sayfalama cursor

#### GET /slack/users/:id
Belirli bir kullanıcının bilgilerini getirir.

### Dosya Yönetimi

#### POST /slack/files/upload
Kanala dosya yükler.

**Body:**
```json
{
  "channel": "C1234567890",
  "file": "base64-encoded-file-content",
  "filename": "report.pdf",
  "title": "Monthly Report",
  "initial_comment": "Here's the monthly report"
}
```

## Kullanım Örnekleri

### AI Agent için

```javascript
// Kanalları listele
const channels = await fetch("http://localhost:8787/slack/channels");

// Mesaj gönder
await fetch("http://localhost:8787/slack/message", {
  method: "POST",
  body: JSON.stringify({
    channel: "C1234567890",
    text: "Task completed successfully! 🎉"
  })
});

// Dosya yükle
const fileContent = Buffer.from("file content").toString('base64');
await fetch("http://localhost:8787/slack/files/upload", {
  method: "POST",
  body: JSON.stringify({
    channel: "C1234567890",
    file: fileContent,
    filename: "log.txt",
    title: "Process Log"
  })
});
```

### cURL ile

```bash
# Kanalları listele
curl -s "http://localhost:8787/slack/channels?types=public_channel&limit=10"

# Mesaj gönder
curl -X POST http://localhost:8787/slack/message \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "C1234567890",
    "text": "Hello from AI-Hub!"
  }'

# Dosya yükle
curl -X POST http://localhost:8787/slack/files/upload \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "C1234567890",
    "file": "SGVsbG8gV29ybGQ=", # "Hello World" in base64
    "filename": "hello.txt",
    "title": "Greeting"
  }'
```

## Güvenlik

- Bot token'ı güvenli bir yerde saklayın
- Minimum required permissions verin
- Sensitive verileri mesaj olarak göndermeyin
- Dosya yükleme boyutunu sınırlayın

## Hata Yönetimi

- Token eksik: `missing_token`
- Slack API hatası: `slack_api_error`
- Slack spesifik hata: `slack_error`
- Bağlantı hatası: `slack_connection_error`
- Dosya yükleme hatası: `file_upload_error`

## Rate Limiting

Slack API rate limit'leri vardır:
- Tier 1: 1+ requests/minute
- Tier 2: 20+ requests/minute
- Tier 3: 50+ requests/minute
- Tier 4: 100+ requests/minute

Plugin otomatik olarak rate limit handling yapar.

## Notlar

- Tüm Slack Web API endpoint'lerini destekler
- Real-time mesajlaşma için WebSocket değil HTTP kullanır
- Block Kit desteklenir
- Thread mesajları desteklenir
- Dosya upload için base64 encoding gerekir
