#!/bin/sh
# Retire l'overlay budget-tokens de macOS : l'arrête, enlève son lancement
# automatique et ses fichiers. Le mod de Claude Code, lui, n'est pas touché.
LABEL=dev.kaliso.budget-tokens-overlay
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
pkill -f 'budget-tokens-overlay[.]js' 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/budget-tokens"
echo "Overlay budget-tokens retiré."
