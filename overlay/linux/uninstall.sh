#!/bin/sh
# Retire l'overlay budget-tokens : l'arrête et enlève son lancement automatique.
# Le mod de Claude Code, lui, n'est pas touché.
for pid in $(ps -C python3 -o pid=,args= | awk '/budget_tokens_overlay[.]py/ {print $1}'); do kill "$pid" 2>/dev/null; done
rm -f "$HOME/.config/autostart/budget-tokens-overlay.desktop" "$HOME/.config/budget-tokens-overlay.json"
echo "Overlay budget-tokens retiré."
