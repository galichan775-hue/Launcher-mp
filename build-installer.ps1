$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$distDir = Join-Path $projectRoot 'dist'
$artworkScript = Join-Path $projectRoot 'tools\CreateLauncherArtwork.ps1'
try {
    $npmCmd = Get-Command npm.cmd -ErrorAction Stop
    $npm = $npmCmd.Source
} catch {
    Write-Host "Node.js / npm не найдены в PATH. Установи Node.js LTS (https://nodejs.org/) и перезапусти PowerShell, затем снова запусти этот скрипт."
    throw 'NPM_NOT_FOUND'
}

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
    throw 'package.json was not found. Run this script from the project directory.'
}

New-Item -ItemType Directory -Force -Path $distDir, (Join-Path $projectRoot 'build') | Out-Null
$installer = Join-Path $distDir 'AOC-2-Multiplayer-Setup.exe'
$innoInstaller = Join-Path $distDir 'AOC-2-Multiplayer-Inno-Setup.exe'
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
    # Edge writes progress lines to stderr; under $ErrorActionPreference = 'Stop' a native
    # command writing to stderr raises a terminating NativeCommandError, so relax it here and
    # rely on the exit code plus the presence of the generated artwork files instead.
    $savedErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $artworkScript 2>&1 | Out-Null
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }
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

    $innoScript = Join-Path $projectRoot 'installer\AOC-2-Multiplayer.iss'
    if (Test-Path $innoScript) {
        $iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if (-not $iscc) {
            foreach ($candidate in @(
                'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
                'C:\Program Files\Inno Setup 6\ISCC.exe',
                (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
                'D:\Inno Setup 6\ISCC.exe'
            )) {
                if (Test-Path $candidate) { $iscc = @{ Source = $candidate }; break }
            }
        }
        if ($iscc) {
            if (Test-Path $innoInstaller) {
                Remove-Item -Path $innoInstaller -Force
            }
            & $iscc.Source $innoScript
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $innoInstaller)) {
                throw 'Building the Inno Setup installer failed.'
            }
        } else {
            Write-Host 'Inno Setup (ISCC.exe) not found, skipping the Inno Setup installer.'
        }
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $installer)) {
    throw "The Windows installer was not generated: $installer"
}

Write-Host "Windows installer created: $installer"

if (Test-Path $innoInstaller) {
    Write-Host "Inno Setup installer created: $innoInstaller"
}
