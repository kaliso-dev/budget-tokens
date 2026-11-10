# budget-tokens

Une ligne au-dessus du prompt, dans toutes les sessions Claude Code, qui suit le
quota hebdomadaire du compte Claude — tous appareils confondus.

```
● EN AVANCE  ━━━━┃───────── Semaine 24 % · rythme 48 %  Aujourd'hui ≈2,4 / 20 %  Tient jusqu'au reset sam. 6h  5 h 12 %
```

## Installation

Dans une session Claude Code en terminal :

```
/plugin install budget-tokens --marketplace kaliso-dev/budget-tokens
```

Réponds `y` pour ajouter le marketplace, puis Entrée pour la portée utilisateur
(`user`) : le mod est actif dans tous tes projets, y compris dans l'app desktop.

Depuis un shell :

```bash
claude plugin install budget-tokens --marketplace kaliso-dev/budget-tokens
```

Dans l'app desktop (onglet Code), où `/plugin` ne fonctionne pas : clique sur
**+** à côté de la zone de saisie, puis **Plugins**, **Add marketplace** avec
`kaliso-dev/budget-tokens`, puis **Add plugin**.

## Ce que la barre affiche

- **La couleur** : vert = en avance sur le budget, orange = dans le rythme
  (à ±3 points du rythme idéal), rouge = à ce rythme le quota tombe à zéro
  avant le reset.
- **La jauge** : le rempli est ce qui est consommé, le trait vertical est là où
  on « devrait » être à ce stade de la semaine.
- **Semaine** : consommé, et ce qui était attendu à cette heure-ci.
- **Aujourd'hui** : consommé / budget du jour. `≈` signale une estimation.
- **La projection** : « Tient jusqu'au reset », ou « À sec » avec le jour et
  l'heure où le quota tombera à zéro au rythme actuel.
- Ensuite, si la place le permet : un quota hebdo par modèle plus rempli que
  le global, la fenêtre de 5 h, l'âge du relevé quand il date.

La barre ne passe jamais sur deux lignes : quand la place manque, les blocs les
moins importants s'effacent. Elle n'a pas de bouton et reste toujours affichée.

## Temps réel

Toutes les 30 secondes, le mod relit la carte d'usage du compte (celle des
réglages de l'app desktop, par son outil `get_usage`). Elle est calculée côté
serveur : elle voit aussi ce que consomment les autres appareils du compte,
même quand cette machine ne fait rien. Pendant un tour, chaque point gagné
met aussi la barre à jour. Sans l'app desktop (Claude Code seul dans un
terminal), la barre suit les réponses de l'API de cette machine.

Tous les montants sont en pourcentage du quota hebdomadaire : c'est la seule
unité que le compte expose, jamais un nombre de tokens brut.

## Le budget du jour

Le quota hebdomadaire divisé par sept, recalculé chaque jour avec ce qui reste :
ce qui restait au début de la journée, divisé par le nombre de jours restants
avant le reset. Une journée économe agrandit donc le budget des suivantes.

## Où commence une journée

Les sept journées sont alignées sur l'heure du reset, pas sur minuit : si le
quota se réinitialise le samedi à 06:00, chaque journée court de 06:00 à 06:00.
Les sept tranches couvrent la fenêtre exactement, et la dernière se termine pile
au reset. Ce qui est consommé entre minuit et 06:00 compte pour la veille.

## Quand le total du jour est une estimation

Si le compte a consommé pendant que cette machine ne relevait rien, et que le
début de la journée tombe dans ce trou, la consommation est répartie au prorata
du temps entre la veille et aujourd'hui. Le total du jour est alors précédé de
`≈`. Le total de la semaine, lui, est toujours exact.

## Overlay sur le bureau (Windows, macOS et Linux)

La même barre, hors de Claude Code : un petit bandeau posé sur la fenêtre de
Claude Desktop, affiché seulement quand elle est au premier plan (onglet Chat
compris) et caché dès que tu passes à une autre fenêtre. Glisse-le pour le déplacer (sa position est retenue) ; clic droit,
puis **Quitter**, pour le fermer.

Il dessine la ligne que le mod calcule : il se met à jour toutes les 30 secondes
tant qu'**une session de l'onglet Code** est ouverte dans Claude Desktop (elle
peut rester dans un coin, sans rien faire). Sans session Code ouverte, il
affiche le dernier relevé et depuis quand il date.

**Windows** — rien à installer, PowerShell et WPF sont fournis avec Windows :

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\plugins\marketplaces\kaliso-dev\overlay\windows\install.ps1"
```

Il se relance à chaque ouverture de session Windows. Pour le retirer :
`uninstall.ps1`, dans le même dossier.

**macOS** — rien à installer, `osascript` (JavaScript for Automation) et
AppKit sont fournis avec macOS :

```bash
sh ~/.claude/plugins/marketplaces/kaliso-dev/overlay/macos/install.sh
```

Il se relance à chaque ouverture de session (LaunchAgent
`dev.kaliso.budget-tokens-overlay`). macOS peut signaler qu'« osascript » a
ajouté un élément en arrière-plan : c'est lui. Pour le retirer :
`sh ~/.claude/plugins/marketplaces/kaliso-dev/overlay/macos/uninstall.sh`.

**Linux (X11)** — Python 3 avec Tkinter : `sh overlay/linux/install.sh` ; pour
le retirer, `sh overlay/linux/uninstall.sh`.

## Utilisation

- La barre s'affiche d'elle-même, au-dessus du prompt.
- `/budget-tokens` relit le compte et affiche le détail en texte.
- Pour l'éteindre sans le supprimer : `claude plugin disable budget-tokens@kaliso-dev`
  (et `enable` pour le rallumer), ou dans l'app desktop : **+**, puis **Plugins**.
- Pour le retirer : `claude plugin uninstall budget-tokens@kaliso-dev`.
