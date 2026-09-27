#define MyAppName "AOC 2 Multiplayer"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "AOC 2 Multiplayer"
#define MyAppExeName "AOC 2 Multiplayer.exe"
#define BuildAppDir "..\dist\win-unpacked"

#if !DirExists(BuildAppDir)
  #error "Launcher build not found. Run build-installer.ps1 before compiling this installer."
#endif

[Setup]
AppId={{2A2A7A71-C684-4D1C-8D04-39879058A423}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\AOC 2 Multiplayer
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist\inno
OutputBaseFilename=AOC-2-Multiplayer-Inno-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\build\aoc2.ico
WizardImageFile=..\build\installer-sidebar.bmp
WizardSmallImageFile=..\build\installer-small.bmp
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#BuildAppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
