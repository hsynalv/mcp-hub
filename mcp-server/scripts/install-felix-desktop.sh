#!/usr/bin/env bash
# Felix Desktop — macOS launchd kurulumu (geliştirici / self-hosted).
# Kullanım: ./scripts/install-felix-desktop.sh
# Önkoşul: Node 18+, hub ile eşleştirme yapılmış SIDECAR_AUTH_TOKEN

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="${FELIX_DESKTOP_CONFIG:-$HOME/.config/felix-desktop}"
ENV_FILE="$CONFIG_DIR/env"
PLIST_LABEL="com.felix.desktop"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
NODE_BIN="$(command -v node)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Bu script şu an yalnızca macOS (launchd) içindir."
  echo "Windows için: npm run sidecar:install:win"
  echo "Linux için: SIDECAR_AUTH_TOKEN=... node $MCP_SERVER_DIR/bin/sidecar-daemon.js"
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js bulunamadı. https://nodejs.org kurun (18+)."
  exit 1
fi

mkdir -p "$CONFIG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
# Felix Desktop — düzenleyin ve yeniden: launchctl kickstart -k gui/\$(id -u)/${PLIST_LABEL}
SIDECAR_PORT=9477
SIDECAR_AUTH_TOKEN=
# Hub production'da LOCAL_FS_ON_SERVER=false olmalı
EOF
  echo "Oluşturuldu: $ENV_FILE"
  echo "Eşleştirmeden aldığınız SIDECAR_AUTH_TOKEN değerini bu dosyaya yazın."
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

if [[ -z "${SIDECAR_AUTH_TOKEN:-}" ]]; then
  echo ""
  echo "SIDECAR_AUTH_TOKEN boş. Önce hub'da eşleştirin:"
  echo "  1. Ayarlar → Felix Desktop → Eşleştirme kodu (admin)"
  echo "  2. Pair sonrası authToken'ı $ENV_FILE içine yapıştırın"
  echo "  3. Bu scripti tekrar çalıştırın"
  exit 1
fi

cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${MCP_SERVER_DIR}/bin/sidecar-daemon.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SIDECAR_PORT</key>
    <string>${SIDECAR_PORT:-9477}</string>
    <key>SIDECAR_AUTH_TOKEN</key>
    <string>${SIDECAR_AUTH_TOKEN}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${CONFIG_DIR}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${CONFIG_DIR}/stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/${PLIST_LABEL}"
launchctl kickstart -k "gui/$(id -u)/${PLIST_LABEL}"

echo ""
echo "Felix Desktop kuruldu ve başlatıldı."
echo "  Sağlık: curl -s http://127.0.0.1:${SIDECAR_PORT:-9477}/health"
echo "  Log:    tail -f ${CONFIG_DIR}/stderr.log"
echo "  Kaldır: launchctl bootout gui/\$(id -u)/${PLIST_LABEL}"
