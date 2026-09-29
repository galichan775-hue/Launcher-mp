$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path $PSScriptRoot -Parent
$brandingDirectory = Join-Path $projectRoot 'customization\branding'
$logoPath = Join-Path $projectRoot 'app\assets\branding\logo.svg'
$sidebarPhotoPath = Join-Path $brandingDirectory 'installer-sidebar.png'
$buildDirectory = Join-Path $projectRoot 'build'
$edgeCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) {
    throw 'Microsoft Edge is required to render the SVG logo and installer artwork.'
}
if (-not (Test-Path $logoPath)) {
    throw "Launcher logo not found: $logoPath"
}

function Invoke-EdgeScreenshot([string]$SvgPath, [string]$OutputPath, [int]$Width, [int]$Height, [string]$ProfilePath) {
    $svgUri = ([System.Uri]$SvgPath).AbsoluteUri
    & $edge --headless=new --hide-scrollbars --no-first-run `
        --run-all-compositor-stages-before-draw --virtual-time-budget=1000 `
        --default-background-color=00000000 "--window-size=$Width,$Height" "--user-data-dir=$ProfilePath" `
        "--screenshot=$OutputPath" $svgUri
    for ($attempt = 0; $attempt -lt 40 -and -not (Test-Path $OutputPath); $attempt++) {
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Path $OutputPath)) {
        throw "Edge could not render artwork: $SvgPath"
    }
}

function Convert-ImageToPngBytes($SourceImage, [int]$Size) {
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object System.IO.MemoryStream
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($SourceImage, 0, 0, $Size, $Size)
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return ,$stream.ToArray()
    } finally {
        $stream.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("aoc2-artwork-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temporaryDirectory, $buildDirectory | Out-Null

try {
    $iconPngPath = Join-Path $temporaryDirectory 'logo.png'
    Invoke-EdgeScreenshot $logoPath $iconPngPath 256 256 (Join-Path $temporaryDirectory 'edge-icon')

    $logoImage = [System.Drawing.Image]::FromFile($iconPngPath)
    try {
        $sizes = @(16, 24, 32, 48, 64, 128, 256)
        $iconImages = @()
        foreach ($size in $sizes) {
            $iconImages += ,(Convert-ImageToPngBytes $logoImage $size)
        }

        $iconStream = New-Object System.IO.MemoryStream
        $writer = New-Object System.IO.BinaryWriter($iconStream)
        try {
            $writer.Write([UInt16]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]$sizes.Count)
            $imageOffset = 6 + (16 * $sizes.Count)
            for ($index = 0; $index -lt $sizes.Count; $index++) {
                $dimension = if ($sizes[$index] -eq 256) { [byte]0 } else { [byte]$sizes[$index] }
                $writer.Write($dimension)
                $writer.Write($dimension)
                $writer.Write([byte]0)
                $writer.Write([byte]0)
                $writer.Write([UInt16]1)
                $writer.Write([UInt16]32)
                $writer.Write([UInt32]$iconImages[$index].Length)
                $writer.Write([UInt32]$imageOffset)
                $imageOffset += $iconImages[$index].Length
            }
            foreach ($image in $iconImages) {
                $writer.Write([byte[]]$image)
            }
            $writer.Flush()
            [System.IO.File]::WriteAllBytes((Join-Path $buildDirectory 'aoc2.ico'), $iconStream.ToArray())
        } finally {
            $writer.Dispose()
            $iconStream.Dispose()
        }

        $smallBitmap = New-Object System.Drawing.Bitmap(55, 55, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $smallGraphics = [System.Drawing.Graphics]::FromImage($smallBitmap)
        try {
            $smallGraphics.Clear([System.Drawing.Color]::FromArgb(34, 36, 40))
            $smallGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $smallGraphics.DrawImage($logoImage, 0, 0, 55, 55)
            $smallBitmap.Save((Join-Path $buildDirectory 'installer-small.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
        } finally {
            $smallGraphics.Dispose()
            $smallBitmap.Dispose()
        }
    } finally {
        $logoImage.Dispose()
    }

    $sidebarBitmap = New-Object System.Drawing.Bitmap(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $sidebarGraphics = [System.Drawing.Graphics]::FromImage($sidebarBitmap)
    $sidebarGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sidebarGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    try {
        if (Test-Path $sidebarPhotoPath) {
            $sidebarImage = [System.Drawing.Image]::FromFile($sidebarPhotoPath)
            try {
                $scale = [Math]::Max(164 / [double]$sidebarImage.Width, 314 / [double]$sidebarImage.Height)
                $drawWidth = [single]($sidebarImage.Width * $scale)
                $drawHeight = [single]($sidebarImage.Height * $scale)
                $drawX = [single]((164 - $drawWidth) / 2)
                $drawY = [single]((314 - $drawHeight) / 2)
                $sidebarGraphics.DrawImage($sidebarImage, $drawX, $drawY, $drawWidth, $drawHeight)
            } finally {
                $sidebarImage.Dispose()
            }
        } else {
            $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
                (New-Object System.Drawing.Rectangle(0, 0, 164, 314)),
                ([System.Drawing.Color]::FromArgb(56, 59, 64)),
                ([System.Drawing.Color]::FromArgb(32, 34, 38)),
                135
            )
            $sidebarGraphics.FillRectangle($background, 0, 0, 164, 314)
            $background.Dispose()
        }
        $brandPanel = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(224, 25, 27, 30))
        $sidebarGraphics.FillRectangle($brandPanel, 0, 245, 164, 69)
        $brandPanel.Dispose()
        $logoImage = [System.Drawing.Image]::FromFile($iconPngPath)
        $sidebarGraphics.DrawImage($logoImage, 12, 258, 42, 42)
        $logoImage.Dispose()
        $brandFont = New-Object System.Drawing.Font('Segoe UI', 7, [System.Drawing.FontStyle]::Bold)
        $captionFont = New-Object System.Drawing.Font('Segoe UI', 6, [System.Drawing.FontStyle]::Regular)
        $brandBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 240, 240))
        $captionBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(174, 177, 182))
        $sidebarGraphics.DrawString('AOC 2 MULTIPLAYER', $brandFont, $brandBrush, 60, 260)
        $sidebarGraphics.DrawString('AGE OF HISTORY II', $captionFont, $captionBrush, 60, 277)
        $captionBrush.Dispose()
        $brandBrush.Dispose()
        $captionFont.Dispose()
        $brandFont.Dispose()
        $sidebarBitmap.Save((Join-Path $buildDirectory 'installer-sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $sidebarGraphics.Dispose()
        $sidebarBitmap.Dispose()
    }
} finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
}
