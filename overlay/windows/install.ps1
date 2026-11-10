# Installe l'overlay budget-tokens sous Windows : il s'affiche quand la fenêtre
# de Claude Desktop est au premier plan, et se relance à chaque ouverture de
# session Windows.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'budget-tokens-overlay.ps1'
$targetDir = Join-Path $env:LOCALAPPDATA 'budget-tokens'
$target = Join-Path $targetDir 'budget-tokens-overlay.ps1'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force
Unblock-File -LiteralPath $target -ErrorAction SilentlyContinue

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$target`""

# Lancement à chaque ouverture de session : un raccourci dans le dossier Démarrage.
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'budget-tokens-overlay.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $targetDir
$shortcut.WindowStyle = 7
$shortcut.Description = 'Overlay budget-tokens : quota hebdomadaire du compte Claude'
$shortcut.Save()

# Redémarre l'overlay s'il tournait déjà (une ancienne version), puis le lance.
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*budget-tokens-overlay.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden

Write-Host "Overlay budget-tokens installé : il s'affiche quand la fenêtre de Claude Desktop est au premier plan."
Write-Host "Lancement automatique : $shortcutPath"
Write-Host "Pour le retirer : powershell -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'uninstall.ps1')`""
