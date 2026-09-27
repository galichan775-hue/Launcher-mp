$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$distDir = Join-Path $projectRoot 'dist'
$artworkScript = Join-Path $projectRoot 'tools\CreateLauncherArtwork.ps1'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
    throw 'package.json was not found. Run this script from the project directory.'
}

New-Item -ItemType Directory -Force -Path $distDir, (Join-Path $projectRoot 'build') | Out-Null
$installer = Join-Path $distDir 'AOC-2-Multiplayer-Setup.exe'
if (Test-Path $installer) {
    Remove-Item -Path $installer -Force
}
Push-Location $projectRoot
try {
    if (Test-Path (Join-Path $projectRoot 'package-lock.json')) {
        & $npm ci
    } else {
        & $npm install
    }
    if ($LASTEXITCODE -ne 0) {
        throw 'Installing Electron project dependencies failed.'
    }

    if (-not (Test-Path $artworkScript)) {
        throw "Launcher artwork generator not found: $artworkScript"
    }
    foreach ($artwork in @('aoc2.ico', 'installer-sidebar.bmp', 'installer-small.bmp')) {
        $artworkPath = Join-Path $projectRoot "build\$artwork"
        if (Test-Path $artworkPath) {
            Remove-Item -Path $artworkPath -Force
        }
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $artworkScript
    if ($LASTEXITCODE -ne 0) {
        throw 'Generating app icon and installer artwork failed.'
    }
    foreach ($artwork in @('aoc2.ico', 'installer-sidebar.bmp', 'installer-small.bmp')) {
        $artworkPath = Join-Path $projectRoot "build\$artwork"
        if (-not (Test-Path $artworkPath)) {
            throw "Generated installer artwork is missing: $artworkPath"
        }
    }

    & $npm run dist
    if ($LASTEXITCODE -ne 0) {
        throw 'Building the Windows app and installer failed.'
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $installer)) {
    throw "The Windows installer was not generated: $installer"
}

Write-Host "Windows installer created: $installer"
