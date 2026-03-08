# Policy Plugin

Kural tabanlı onay sistemi ve policy enforcement.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/policy/rules` | GET | Kuralları listele |
| `/policy/rules` | POST | Kural ekle |
| `/policy/rules/:id` | DELETE | Kural sil |
| `/policy/evaluate` | POST | Kural değerlendir |
| `/approvals/pending` | GET | Bekleyen onaylar |
| `/approve` | POST | Onay ver/reddet |

## Hook Sistemi

Tool execution öncesinde policy kontrolü:

```javascript
// Core hook registration
registerBeforeExecutionHook("policy", evaluator);
```

## Kural Yapısı

```json
{
  "id": "rule-1",
  "toolPattern": "github_*",
  "condition": "WRITE",
  "action": "requireApproval"
}
```

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `policy_list_rules` | Kuralları listele |
| `policy_evaluate` | Tool policy durumunu kontrol et |
| `policy_list_approvals` | Onay taleplerini listele |
