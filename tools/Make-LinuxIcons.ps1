$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ico = 'C:\Users\petel\Desktop\Launcher\build\aoc2.ico'
$outDir = 'C:\Users\petel\Desktop\Launcher\build\icons'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# Pull the largest PNG-embedded frame straight out of the ICO: no resampling for the master.
$bytes = [System.IO.File]::ReadAllBytes($ico)
$pngSignature = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
$count = [BitConverter]::ToUInt16($bytes, 4)
$best = $null
for ($i = 0; $i -lt $count; $i++) {
  $entry = 6 + $i * 16
  $size = [BitConverter]::ToUInt32($bytes, $entry + 8)
  $offset = [BitConverter]::ToUInt32($bytes, $entry + 12)
  $isPng = $true
  for ($k = 0; $k -lt 8; $k++) { if ($bytes[$offset + $k] -ne $pngSignature[$k]) { $isPng = $false; break } }
  if (-not $isPng) { continue }
  if ($null -eq $best -or $size -gt $best.Size) { $best = @{ Size = $size; Offset = $offset } }
}
if ($null -eq $best) { throw 'No PNG frame found in the ICO' }

$master = Join-Path $outDir 'aoc2-master.png'
$stream = [System.IO.MemoryStream]::new($bytes[$best.Offset..($best.Offset + $best.Size - 1)])
[System.IO.File]::WriteAllBytes($master, $stream.ToArray())
$stream.Dispose()

# Read the master from a scratch copy so the generated sizes can overwrite anything in $outDir.
$scratch = Join-Path $env:TEMP 'aoc2-icon-source.png'
Copy-Item -LiteralPath $master -Destination $scratch -Force
$source = [System.Drawing.Image]::FromFile($scratch)
"  master extracted: $($source.Width)x$($source.Height) from $($best.Size) byte PNG frame"

foreach ($size in 16, 24, 32, 48, 64, 128, 256, 512) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($source, 0, 0, $size, $size)
  $graphics.Dispose()
  # electron-builder expects the size to be encoded in the filename (16x16.png).
  $target = Join-Path $outDir ("$($size)x$($size).png")
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  "  {0,-14} {1,8:N0} bytes" -f "$($size)x$($size).png", (Get-Item $target).Length
}
$source.Dispose()
Remove-Item -LiteralPath $scratch, $master -Force -ErrorAction SilentlyContinue

Copy-Item -LiteralPath (Join-Path $outDir '256x256.png') -Destination 'C:\Users\petel\Desktop\Launcher\build\aoc2.png' -Force
"  copied 256x256 -> build\aoc2.png (Linux icon)"
