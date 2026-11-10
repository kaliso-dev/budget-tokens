# Retire l'overlay budget-tokens de Windows : l'arrête, enlève son lancement
# automatique et ses fichiers. Le mod de Claude Code, lui, n'est pas touché.

Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*budget-tokens-overlay.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'budget-tokens-overlay.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'budget-tokens') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $env:APPDATA 'budget-tokens-overlay.json') -Force -ErrorAction SilentlyContinue

Write-Host 'Overlay budget-tokens retiré.'
