# Docker Plugin

Docker container yönetimi.

## Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/docker/containers` | GET | Container'ları listele |
| `/docker/containers` | POST | Container başlat |
| `/docker/containers/:id/stop` | POST | Container durdur |
| `/docker/containers/:id/logs` | GET | Container logları |
| `/docker/images` | GET | Image'ları listele |

## MCP Araçları

| Araç | Açıklama |
|------|----------|
| `docker_list_containers` | Container'ları listele |
| `docker_start_container` | Container başlat |
| `docker_stop_container` | Container durdur |
| `docker_get_logs` | Logları al |

## Gereksinimler

Docker daemon erişimi gerekli.
