# budget-tokens : overlay Windows
#
# Affiche, au-dessus des fenêtres, la même barre que le mod budget-tokens dans
# Claude Code, tant que Claude Desktop est ouvert. La ligne est calculée par le
# mod, qui l'écrit dans son fichier sous %USERPROFILE%\.claude\plugins\store\ ;
# l'overlay ne fait que la dessiner.
#
# Glisser pour déplacer (la position est retenue), clic droit > Quitter.

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# Une seule instance à la fois.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\budget-tokens-overlay', [ref]$created)
if (-not $created) { return }

$configDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$storeDir = Join-Path $configDir 'plugins\store'
$positionFile = Join-Path $env:APPDATA 'budget-tokens-overlay.json'
# Au-delà, le mod ne tourne plus : aucune session Code n'est ouverte.
$silentAfterMs = 120000

$paceColors = @{ ahead = '#2FB26B'; onTrack = '#E0A100'; behind = '#E5484D' }
$dim = '#9A9A9A'
$strong = '#F0F0F0'
$alert = '#FF6B6B'
$converter = New-Object System.Windows.Media.BrushConverter
$font = New-Object System.Windows.Media.FontFamily('Segoe UI')

function New-Brush([string]$hex) { return $converter.ConvertFromString($hex) }

function Test-ClaudeDesktop {
    return [bool](Get-Process -Name 'Claude' -ErrorAction SilentlyContinue)
}

# La ligne la plus récente parmi les fichiers du mod (une copie par installation).
function Read-Display {
    $best = $null
    foreach ($file in @(Get-ChildItem -LiteralPath $storeDir -Filter 'budget-tokens_*.json' -ErrorAction SilentlyContinue)) {
        try {
            $display = (Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).display
            if ($display -and (-not $best -or [double]$display.at -gt [double]$best.at)) { $best = $display }
        } catch { }
    }
    return $best
}

function Format-Age([double]$seconds) {
    if ($seconds -lt 90) { return "à l'instant" }
    $minutes = [Math]::Round($seconds / 60)
    if ($minutes -lt 60) { return "il y a $minutes min" }
    $hours = [Math]::Round($seconds / 3600)
    if ($hours -lt 24) { return "il y a $hours h" }
    return "il y a $([Math]::Round($seconds / 86400)) j"
}

$window = New-Object System.Windows.Window
$window.WindowStyle = 'None'
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.ShowActivated = $false
$window.ResizeMode = 'NoResize'
$window.SizeToContent = 'WidthAndHeight'
$window.WindowStartupLocation = 'Manual'
$window.Title = 'budget-tokens'

$border = New-Object System.Windows.Controls.Border
$border.CornerRadius = New-Object System.Windows.CornerRadius(8)
$border.Background = New-Brush '#F01E1E1E'
$border.Padding = New-Object System.Windows.Thickness(10, 4, 10, 4)
$panel = New-Object System.Windows.Controls.StackPanel
$panel.Orientation = 'Horizontal'
$border.Child = $panel
$window.Content = $border

function Add-Text([string]$text, [string]$hex, [bool]$bold = $false) {
    $block = New-Object System.Windows.Controls.TextBlock
    $block.Text = $text
    $block.Foreground = New-Brush $hex
    $block.FontFamily = $font
    $block.FontSize = 12
    $block.VerticalAlignment = 'Center'
    if ($bold) { $block.FontWeight = [System.Windows.FontWeights]::SemiBold }
    [void]$panel.Children.Add($block)
}

function Add-Rect([System.Windows.Controls.Canvas]$canvas, [double]$left, [double]$top, [double]$width, [double]$height, [string]$hex, [double]$radius) {
    $rect = New-Object System.Windows.Shapes.Rectangle
    $rect.Width = $width
    $rect.Height = $height
    $rect.RadiusX = $radius
    $rect.RadiusY = $radius
    $rect.Fill = New-Brush $hex
    [System.Windows.Controls.Canvas]::SetLeft($rect, $left)
    [System.Windows.Controls.Canvas]::SetTop($rect, $top)
    [void]$canvas.Children.Add($rect)
}

# La jauge : le rempli est ce qui est consommé, le trait est là où l'on "devrait" être.
function Add-Gauge([double]$used, [double]$expected, [string]$hex) {
    $width = 112; $height = 12; $bar = 6; $top = ($height - $bar) / 2
    $canvas = New-Object System.Windows.Controls.Canvas
    $canvas.Width = $width
    $canvas.Height = $height
    $canvas.Margin = New-Object System.Windows.Thickness(8, 0, 8, 0)
    $canvas.VerticalAlignment = 'Center'
    Add-Rect $canvas 0 $top $width $bar '#4A4A4A' 3
    $fill = [Math]::Max(0, [Math]::Min($width, $width * $used / 100))
    if ($fill -gt 0) { Add-Rect $canvas 0 $top $fill $bar $hex 3 }
    $mark = [Math]::Max(1, [Math]::Min($width - 1, $width * $expected / 100))
    Add-Rect $canvas ($mark - 1) 0 2 $height '#BBBBBB' 1
    [void]$panel.Children.Add($canvas)
}

function Show-Line($display, [double]$now) {
    $panel.Children.Clear()
    $dot = [string][char]0x25CF

    if (-not $display) {
        Add-Text "$dot budget-tokens" $strong $true
        Add-Text '  en attente du premier relevé : ouvre une session Code dans Claude Desktop' $dim
        return
    }

    $color = $strong
    if ($display.pace -and $paceColors.ContainsKey([string]$display.pace)) { $color = $paceColors[[string]$display.pace] }
    Add-Text "$dot " $color
    Add-Text ([string]$display.status) $color $true
    if ($display.gauge) {
        Add-Gauge ([double]$display.gauge.used) ([double]$display.gauge.expected) $color
    } else {
        Add-Text '  ' $dim
    }

    $isSilent = ($now - [double]$display.at) -gt $silentAfterMs
    $isFirst = $true
    foreach ($runs in @($display.parts)) {
        $list = @($runs)
        # Le mod ne tourne plus : son âge du relevé est figé, on met le nôtre à la fin.
        if ($isSilent -and $list.Count -gt 0 -and ([string]$list[0].text).StartsWith('relevé ')) { continue }
        if (-not $isFirst) { Add-Text '   ' $dim }
        $isFirst = $false
        foreach ($run in $list) {
            switch ([string]$run.tone) {
                'strong' { Add-Text ([string]$run.text) $strong $true }
                'alert' { Add-Text ([string]$run.text) $alert $true }
                'pace' { Add-Text ([string]$run.text) $color $true }
                default { Add-Text ([string]$run.text) $dim }
            }
        }
    }

    if ($isSilent) {
        $age = Format-Age (($now - [double]$display.readingAt) / 1000)
        Add-Text "   relevé $age · ouvre une session Code pour actualiser" $dim
    }
}

# Position retenue, sinon en haut au centre de l'écran principal.
$script:saved = $null
if (Test-Path -LiteralPath $positionFile) {
    try {
        $pos = Get-Content -LiteralPath $positionFile -Raw | ConvertFrom-Json
        $left = [double]$pos.x; $top = [double]$pos.y
        $screen = [System.Windows.SystemParameters]
        $onScreen = $left -ge $screen::VirtualScreenLeft -and $left -lt ($screen::VirtualScreenLeft + $screen::VirtualScreenWidth - 40) -and
            $top -ge $screen::VirtualScreenTop -and $top -lt ($screen::VirtualScreenTop + $screen::VirtualScreenHeight - 20)
        if ($onScreen) { $script:saved = $pos }
    } catch { }
}
if ($script:saved) {
    $window.Left = [double]$script:saved.x
    $window.Top = [double]$script:saved.y
} else {
    $window.Left = -10000
    $window.Top = -10000
}
$window.Add_ContentRendered({
    if (-not $script:saved) {
        $area = [System.Windows.SystemParameters]::WorkArea
        $window.Left = $area.Left + ($area.Width - $window.ActualWidth) / 2
        $window.Top = $area.Top + 6
    }
})

$window.Add_MouseLeftButtonDown({
    try { $window.DragMove() } catch { }
    try {
        @{ x = $window.Left; y = $window.Top } | ConvertTo-Json -Compress | Set-Content -LiteralPath $positionFile -Encoding UTF8
        $script:saved = @{ x = $window.Left; y = $window.Top }
    } catch { }
})

$menu = New-Object System.Windows.Controls.ContextMenu
$quit = New-Object System.Windows.Controls.MenuItem
$quit.Header = 'Quitter budget-tokens'
$quit.Add_Click({
    $timer.Stop()
    $window.Close()
    $window.Dispatcher.InvokeShutdown()
})
[void]$menu.Items.Add($quit)
$border.ContextMenu = $menu

$script:lastKey = $null
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(3)
$timer.Add_Tick({
    try {
        if (Test-ClaudeDesktop) {
            $now = [double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $display = Read-Display
            $key = [string]($display | ConvertTo-Json -Depth 8 -Compress) + '|' + [Math]::Floor($now / 60000)
            if ($key -ne $script:lastKey) {
                $script:lastKey = $key
                Show-Line $display $now
            }
            if (-not $window.IsVisible) { $window.Show() }
        } elseif ($window.IsVisible) {
            $window.Hide()
        }
    } catch { }
})

$timer.Start()
[System.Windows.Threading.Dispatcher]::Run()
$mutex.ReleaseMutex()
