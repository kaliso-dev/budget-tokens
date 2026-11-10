#!/bin/sh
# Installe l'overlay budget-tokens sous Linux (X11) : il s'affiche dès que
# Claude Desktop est ouvert, et se relance à chaque ouverture de session.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$DIR/budget_tokens_overlay.py"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/budget-tokens-overlay.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=budget-tokens
Comment=Barre du quota hebdomadaire Claude au-dessus des fenêtres
Exec=python3 "$SCRIPT"
X-GNOME-Autostart-enabled=true
EOF
for pid in $(ps -C python3 -o pid=,args= | awk '/budget_tokens_overlay[.]py/ {print $1}'); do kill "$pid" 2>/dev/null; done
nohup python3 "$SCRIPT" >/dev/null 2>&1 &
echo "Overlay budget-tokens installé : il s'affiche dès que Claude Desktop est ouvert."
echo "Pour le retirer : sh \"$DIR/uninstall.sh\""
