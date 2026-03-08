# Observability Plugin

Sağlık kontrolleri ve metrikler.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/health` | GET | Server sağlığı (core'da) |
| `/observability/dashboard` | GET | Web dashboard |
| `/observability/metrics` | GET | Prometheus metrikleri |
| `/audit/logs` | GET | Audit logları |
| `/audit/stats` | GET | Audit istatistikleri |

## Dashboard

Web UI: `http://localhost:8787/observability/dashboard`

## Metrikler

- Request latency
- Error rate
- Plugin load durumu
- Job kuyruk boyutu
