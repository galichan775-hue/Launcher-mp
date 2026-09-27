const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aocLauncher', Object.freeze({
  getConfig: () => ipcRenderer.invoke('launcher:get-config'),
  getModStatus: () => ipcRenderer.invoke('mod:get-status'),
  getGameStats: versionId => ipcRenderer.invoke('game:get-stats', versionId),
  getJava: () => ipcRenderer.invoke('launcher:get-java'),
  downloadJava: () => ipcRenderer.invoke('launcher:download-java'),
  checkForUpdates: () => ipcRenderer.invoke('launcher:check-updates'),
  installUpdate: () => ipcRenderer.invoke('launcher:install-update'),
  checkRepoUpdate: () => ipcRenderer.invoke('launcher:check-repo-update'),
  applyRepoUpdate: () => ipcRenderer.invoke('launcher:apply-repo-update'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openLaunchLog: versionId => ipcRenderer.invoke('launcher:open-launch-log', versionId),
  openLastCrash: () => ipcRenderer.invoke('launcher:open-last-crash'),
  openLogsFolder: () => ipcRenderer.invoke('launcher:open-logs-folder'),
  createCrashReport: report => ipcRenderer.invoke('launcher:create-crash-report', report),
  sendCrashReport: report => ipcRenderer.invoke('launcher:send-crash-report', report),
  openModCommits: versionId => ipcRenderer.invoke('mod:commits', versionId),
  installModCommit: payload => ipcRenderer.invoke('mod:install-commit', payload),
  checkModUpdates: () => ipcRenderer.invoke('mod:check-updates'),
  downloadMod: versionId => ipcRenderer.invoke('mod:download', versionId),
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
