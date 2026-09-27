const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aocLauncher', Object.freeze({
  getConfig: () => ipcRenderer.invoke('launcher:get-config'),
  getModStatus: () => ipcRenderer.invoke('mod:get-status'),
  getGameStats: versionId => ipcRenderer.invoke('game:get-stats', versionId),
  getJava: () => ipcRenderer.invoke('launcher:get-java'),
  downloadJava: () => ipcRenderer.invoke('launcher:download-java'),
  checkForUpdates: () => ipcRenderer.invoke('launcher:check-updates'),
  getVersionUpdates: () => ipcRenderer.invoke('launcher:get-version-updates'),
  getVersionHistory: versionId => ipcRenderer.invoke('launcher:get-version-history', versionId),
  rollbackVersion: (versionId, commit) => ipcRenderer.invoke('mod:rollback-version', versionId, commit),
  installUpdate: () => ipcRenderer.invoke('launcher:install-update'),
  openExternal: url => ipcRenderer.invoke('launcher:open-external', url),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openLaunchLog: versionId => ipcRenderer.invoke('launcher:open-launch-log', versionId),
  getLastCrashLog: () => ipcRenderer.invoke('launcher:get-last-crash-log'),
  openCrashLog: logPath => ipcRenderer.invoke('launcher:open-crash-log', logPath),
  createCrashReport: report => ipcRenderer.invoke('launcher:create-crash-report', report),
  downloadMod: (versionId, commitOverride) => ipcRenderer.invoke('mod:download', versionId, commitOverride),
  deleteMod: versionId => ipcRenderer.invoke('mod:delete', versionId),
  launchMod: versionId => ipcRenderer.invoke('mod:launch', versionId),
  stopMod: versionId => ipcRenderer.invoke('mod:stop', versionId),
  openModFolder: versionId => ipcRenderer.invoke('mod:open-folder', versionId),
  selectGameFolder: versionId => ipcRenderer.invoke('mod:select-game-folder', versionId),
  resetGameFolder: versionId => ipcRenderer.invoke('mod:reset-game-folder', versionId),
  onGameExit: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('game:exited', listener)
    return () => ipcRenderer.removeListener('game:exited', listener)
  },
  onDownloadProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('mod:download-progress', listener)
    return () => ipcRenderer.removeListener('mod:download-progress', listener)
  },
  onGameDiscovery: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('mod:game-discovery', listener)
    return () => ipcRenderer.removeListener('mod:game-discovery', listener)
  },
  onUpdateStatus: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('launcher:update-status', listener)
    return () => ipcRenderer.removeListener('launcher:update-status', listener)
  }
}))
