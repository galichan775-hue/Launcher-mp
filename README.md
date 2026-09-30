# AOC 2 Multiplayer

Desktop launcher for multiplayer versions of Age of History II, for Windows and Linux. The Electron interface is an original design; it does not include Modrinth source code or assets.

## Requirements

- Windows 10 or newer, 64-bit, or a 64-bit Linux distribution (tested against Linux Mint, Debian and Ubuntu package naming)
- Node.js and npm to build the project
- Python 3 only when building the Linux `.deb`, because the packaging step compresses the data archive with the standard library `lzma` module

## Run in development

```powershell
npm install
npm start
```

## Build the Windows installer

Run `build-installer.ps1` or:

```powershell
npm run dist
```

The NSIS installer is written to `dist\AOC-2-Multiplayer-Setup.exe`. It lets users select the installation folder and creates Start-menu and desktop shortcuts. The installer includes the Electron runtime; Java 17 is only needed to run the game mod.

## Build the Linux package

```powershell
npm run dist:deb
```

This downloads the official `electron-linux-x64` runtime, packs `app\`, `electron\`, `package.json` and the production dependency closure into `app.asar`, prunes the unused locales, and assembles `dist\AOC-2-Multiplayer-linux-x64.deb` directly. No Docker or Linux host is required; the `.deb` is an ar archive holding `control.tar.xz` and `data.tar.xz`, both written by `tools\build-deb.mjs`.

The package installs the launcher to `/opt/aoc-2-multiplayer` with a `/usr/bin/aoc-2-multiplayer` symlink, a desktop entry and the hicolor icon set. `chrome-sandbox` is installed setuid root, which is why the post-install step refreshes the icon cache rather than launching the app.

`npm run verify:deb` re-reads the built package and checks the ar container, the control metadata, ownership, file modes, the desktop entry, the icon sizes, every `md5sums` entry, the shipped `app.asar` and the main process `require` graph.

`npm run test:platform` covers the cross-platform helpers in `electron\platform.cjs` (Java discovery, version parsing, per-version platform gating, the manual install command) and `npm run test:ui` drives the real window over the Chrome DevTools Protocol. Both run on Windows, so the Linux-only branches are exercised through injected state rather than a Linux host.

A `.deb` cannot be installed without root, so the in-app updater does not launch an installer on Linux. It downloads the package, shows `sudo apt install ./AOC-2-Multiplayer-linux-x64.deb` and offers a button to open the download folder.

`BEII.exe` is a Windows executable and is marked `platforms: ["win32"]` in `app\launcher-config.json`. On Linux the launcher draws a "Windows only" badge on that version, explains it on hover and refuses to start it.

Launcher updates are checked from GitHub Releases in `galichan775-hue/Launcher-mp`. To publish a release, set a newer version in `package.json`, build with `npm run dist`, commit the installer, and create a published GitHub Release with the matching `v<version>` tag.

The launcher does not use `electron-updater`. It reads the newest version from `update/latest.txt` and `update/Vers-1.txt`, then downloads the platform artifact straight from the repository root through `raw.githubusercontent.com`, so both files have to be committed alongside the installer. Because raw responses are capped at 100 MB, the Linux `.deb` is compressed with xz to stay below that limit; a `latest.yml` or `.blockmap` is neither generated nor used.

The launcher detects its own installation folder from the running application, regardless of where it was installed. It searches the application folder and its subfolders for `AoH2MP.jar` without scanning every drive. New game files are stored in a `Games` folder beside the launcher; if that folder is not writable (for example, under `Program Files`), they are stored in the launcher's user data folder instead. Java 17 or newer is required to play; the launcher checks for Java and offers a download link if it cannot find a compatible runtime. Playtime, last-played time and session counts are stored locally.

If it does not find the game automatically, choose **Choose game folder** and select the folder containing `AoH2MP.jar`. This uses your existing files without moving or deleting them. Failed launches write a diagnostic log under the launcher's user data folder; the launcher provides a button to open it.

The sidebar player profile is visual only. Click it to set a local nickname and avatar.

## Customize the launcher

- `app\launcher-config.json` controls app branding, author names and optional links, community links, version descriptions in Russian and English, changelog entries, and the configured download source. The AoH2MP 1.9.3 and 1.9.4 templates use `galichan775-hue/1.9.3-mp` and `galichan775-hue/1.9.4-mp`; set each version's `commit` to a published 40-character Git commit SHA before its download becomes available.
- `package.json` controls the Windows installer product name and installer filename, and the `build.deb` block holds the Linux package name, dependencies, category and desktop entry.
- `app\assets\branding\logo.svg` is the common launcher, Windows app, shortcut and installer-small-image logo. `build-installer.ps1` regenerates a transparent `.ico` and installer artwork from this SVG.
- Each version's banner is configured in `launcher-config.json` and shown on its card and details page. Replace `app\assets\versions\1.9.3\banner.png`, `app\assets\versions\1.9.3-mp\banner.png`, or `app\assets\versions\1.9.4-mp\banner.png` to customize the corresponding version; a version icon can be configured separately. Edit `description` and `descriptionEn` in the matching version entry to update its Russian and English descriptions.
- Screenshots can be placed under `app\assets\versions\1.9.3\` and listed in that version's `screenshots` array.
- Set `creator` and `community` names and URLs in `launcher-config.json`; links are optional. The interface supports Russian and English.
- After a failed launch, the launcher can save a support report containing the entered description and the latest launch log. The report is saved locally for the user to attach to a support message; it is not uploaded automatically.
- Replace `customization\branding\installer-sidebar.png` to change the large image in the installer wizard. If the file is absent, the installer uses a simple logo and title instead.
- The Windows artwork generation step uses the built-in Microsoft Edge headless renderer and System.Drawing.

`installer\AOC-2-Multiplayer.iss` is an optional Inno Setup alternative. It reads the packaged application from `dist\win-unpacked`.

## Project layout

- `app\` - launcher interface (HTML, CSS, JavaScript)
- `electron\` - desktop runtime, mod installation and launcher APIs; `platform.cjs` holds the OS-specific behaviour
- `tools\` - app icon and installer artwork, the Linux icon generator, the `.deb` builder and verifier, and the platform/UI tests
- `installer\` - optional Inno Setup definition
