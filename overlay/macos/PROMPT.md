# Prompt à coller dans l'onglet **Code** de Claude Desktop (macOS)

Installe pour moi, au niveau utilisateur (actif dans tous mes projets), le mod Claude Code **budget-tokens** et son **overlay macOS**, depuis le dépôt GitHub public `kaliso-dev/budget-tokens`. C'est une barre qui suit le quota hebdomadaire de mon compte Claude ; l'overlay l'affiche sur la fenêtre de Claude Desktop quand elle est au premier plan (onglet Chat compris), et la cache dès que je passe à une autre app.

1. Dans le Terminal : `claude plugin install budget-tokens --marketplace kaliso-dev/budget-tokens --scope user`, puis vérifie avec `claude plugin list` que `budget-tokens@kaliso-dev` est `enabled`, scope `user`. S'il est déjà installé, mets-le à jour : `claude plugin marketplace update kaliso-dev` puis `claude plugin update budget-tokens@kaliso-dev`.
   Si la commande `claude` n'existe pas sur ma machine, arrête-toi et dis-moi de l'ajouter depuis l'app : bouton **+** à côté de la zone de saisie, puis **Plugins**, **Add marketplace** avec `kaliso-dev/budget-tokens`, puis **Add plugin**. Reprends ensuite à l'étape 2.
2. Installe l'overlay :
   `sh ~/.claude/plugins/marketplaces/kaliso-dev/overlay/macos/install.sh`
   Il se relance tout seul à chaque ouverture de session macOS. Si macOS affiche une notification « osascript a ajouté un élément en arrière-plan », c'est normal : c'est l'overlay.
3. Dis-moi de quitter complètement Claude Desktop (⌘Q, ou clic droit sur son icône dans le Dock, puis Quitter), de le rouvrir, et de laisser **une session de l'onglet Code ouverte** : c'est elle qui actualise la barre toutes les 30 secondes.

Si une étape échoue, montre-moi l'erreur exacte sans modifier les fichiers du mod. Si l'overlay ne s'affiche pas, montre-moi le contenu de `~/Library/Application Support/budget-tokens/overlay.log`.

Pour retirer l'overlay plus tard : `sh ~/.claude/plugins/marketplaces/kaliso-dev/overlay/macos/uninstall.sh`.
