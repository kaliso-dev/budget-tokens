#!/bin/sh
# Installe l'overlay budget-tokens sous macOS : il s'affiche quand la fenêtre
# de Claude Desktop est au premier plan, et se relance à chaque ouverture de
# session (LaunchAgent). Rien à installer : osascript et AppKit sont fournis
# avec macOS.
#
#   sh install.sh
set -e
LABEL=dev.kaliso.budget-tokens-overlay
DIR=$(cd "$(dirname "$0")" && pwd)
TARGET_DIR="$HOME/Library/Application Support/budget-tokens"
TARGET="$TARGET_DIR/budget-tokens-overlay.js"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

mkdir -p "$TARGET_DIR" "$HOME/Library/LaunchAgents"
cp "$DIR/budget-tokens-overlay.js" "$TARGET"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

ENVIRONMENT=""
if [ -n "$CLAUDE_CONFIG_DIR" ]; then
  ENVIRONMENT="  <key>EnvironmentVariables</key>
  <dict><key>CLAUDE_CONFIG_DIR</key><string>$(xml "$CLAUDE_CONFIG_DIR")</string></dict>"
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-l</string>
    <string>JavaScript</string>
    <string>$(xml "$TARGET")</string>
  </array>
  <key>RunAtLoad</key><true/>
  <!-- Relancé s'il plante, pas quand on le quitte depuis son menu. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardErrorPath</key><string>$(xml "$TARGET_DIR/overlay.log")</string>
$ENVIRONMENT
</dict>
</plist>
PLIST

# Redémarre l'overlay s'il tournait déjà (une ancienne version), puis le lance.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
pkill -f 'budget-tokens-overlay[.]js' 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

echo "Overlay budget-tokens installé : il s'affiche quand la fenêtre de Claude Desktop est au premier plan."
echo "Lancement automatique : $PLIST"
echo "Pour le retirer : sh \"$DIR/uninstall.sh\""
