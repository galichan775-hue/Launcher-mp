Launcher customization

- Replace app\assets\branding\logo.svg to change the logo throughout the app.
  The build converts this SVG into the Windows executable, shortcut and
  installer icons.
- Replace installer-sidebar.png in this folder to change the large photo in
  the Windows installer wizard. Use a PNG image; the build crops it to fit.
- Edit app\launcher-config.json to change the launcher name, creators,
  community links, pinned repository commit, description, changelog and
  screenshots.
- Add launcher screenshots under app\assets\versions\1.9.3\ and list their
  relative paths in the version's "screenshots" array. Version banners are not
  displayed in the launcher.

Run build-installer.ps1 after changes. The game is installed in a Games folder
beside the installed launcher.
