const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const { pipeline } = require('node:stream/promises')
const yauzl = require('yauzl')
const { autoUpdater } = require('electron-updater')
const launcherConfig = require('../app/launcher-config.json')
const JAVA_DOWNLOAD_URL = 'https://adoptium.net/temurin/releases/?version=17'
const TELEGRAM_SUPPORT_URL = 'https://t.me/communityAOC2mp/2682'
// Uncap the compositor so the UI can render above 60 FPS on high refresh displays.
app.commandLine.appendSwitch('disable-frame-rate-limit')
app.commandLine.appendSwitch('disable-gpu-vsync')
// Set TELEGRAM_BOT_TOKEN to send reports automatically instead of copying them to the clipboard.
const TELEGRAM_BOT_TOKEN = ''
const gameStatsPath = path.join(app.getPath('userData'), 'game-stats.json')
const gameLocationsPath = path.join(app.getPath('userData'), 'game-locations.json')
const versionCommitsPath = path.join(app.getPath('userData'), 'version-commits.json')
const activeGames = new Map()
const launchingVersions = new Set()
let gameStats = { versions: {} }
let gameLocations = {}
let versionCommitOverrides = {}
let statsWrite = Promise.resolve()
const gameDiscoveryPromises = new Map()
const gameDiscoveryCompleted = new Set()
let writableVersionsDirectory = null
const discoveryLimits = { directories: 25000, milliseconds: 12000, workers: 8, depth: 5 }
const skippedDirectoryNames = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'node_modules',
  '.git',
  '.svn'
])

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

// --- Simple repo-based updater (reads version file committed in this repository) ---
const https = require('node:https')
const RAW_BASE = 'https://raw.githubusercontent.com/galichan775-hue/Launcher-mp/main/'

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(dest)))
      file.on('error', err => { try{fs.unlinkSync(dest)}catch{}; reject(err) })
    }).on('error', reject)
  })
}

function semverGt(a, b) {
  const pa = (a + '').replace(/^v/, '').split('.').map(n => Number(n) || 0)
  const pb = (b + '').replace(/^v/, '').split('.').map(n => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return true
    if (na < nb) return false
  }
  return false
}

async function resolveRemoteVersion(local) {
  const candidates = [
    'update/Vers-1.txt',
    'update/latest.txt',
    'latest.txt',
    `v${local}.txt`,
    `${local}.txt`
  ]
  for (const candidate of candidates) {
    try {
      const text = (await fetchText(RAW_BASE + candidate)).trim()
      if (text) return text.replace(/^v/, '').trim()
    } catch (e) {
      // ignore and try next
    }
  }
  return null
}

// Reports the repository version without any native dialog: the renderer shows the prompt
// inside the launcher window so it keeps the app typography instead of the Windows theme.
async function checkRepoUpdate() {
  const current = app.getVersion()
  if (!app.isPackaged) return { supported: false, current, latest: null, available: false }
  try {
    const latest = await resolveRemoteVersion(current)
    return { supported: true, current, latest, available: Boolean(latest) && semverGt(latest, current) }
  } catch (error) {
    console.error('Repository update check failed:', error)
    return { supported: true, current, latest: null, available: false }
  }
}

async function applyRepoUpdate() {
  const current = app.getVersion()
  const latest = await resolveRemoteVersion(current)
  if (!latest || !semverGt(latest, current)) throw new Error('Установленная версия уже актуальна.')
  const dest = path.join(app.getPath('temp'), 'AOC-2-Multiplayer-Setup.exe')
  await downloadFile(RAW_BASE + 'AOC-2-Multiplayer-Setup.exe', dest)
  const launchError = await shell.openPath(dest)
  if (launchError) throw new Error(launchError)
  return { started: true, version: latest }
}

// --- end repo-based updater ---

function reportLauncherUpdate(status) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('launcher:update-status', status)
  }
}

autoUpdater.on('checking-for-update', () => reportLauncherUpdate({ phase: 'checking' }))
autoUpdater.on('update-available', info => reportLauncherUpdate({ phase: 'available', version: info.version }))
autoUpdater.on('update-not-available', info => reportLauncherUpdate({ phase: 'current', version: info.version }))
autoUpdater.on('download-progress', progress => reportLauncherUpdate({
  phase: 'downloading',
  percent: Math.round(progress.percent),
  transferred: progress.transferred,
  total: progress.total
}))
autoUpdater.on('update-downloaded', info => reportLauncherUpdate({ phase: 'downloaded', version: info.version }))
autoUpdater.on('error', error => {
  console.error('Launcher update failed:', error)
  reportLauncherUpdate({ phase: 'error', message: error.message })
})

// --- GitHub API helpers (mod update checks, commit history) ---
const repositoryHeads = new Map()

async function fetchGitHubJson(url, etag) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AOC-2-Multiplayer',
        Accept: 'application/vnd.github+json',
        ...(etag ? { 'If-None-Match': etag } : {})
      },
      signal: controller.signal
    })
    if (response.status === 304) return { notModified: true }
    if (response.status === 403) throw new Error('GitHub API вернул ошибку (HTTP 403): исчерпан лимит запросов без токена.')
    if (!response.ok) throw new Error(`GitHub API вернул ошибку (HTTP ${response.status}).`)
    return { etag: response.headers.get('etag'), data: await response.json() }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('GitHub API не ответил за 20 секунд.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function getRepositoryHead(repository) {
  const cached = repositoryHeads.get(repository)
  try {
    const response = await fetchGitHubJson(`https://api.github.com/repos/${repository}/commits/HEAD`, cached?.etag)
    if (response.notModified && cached) return cached
    const entry = {
      sha: response.data.sha,
      date: response.data.commit?.committer?.date || null,
      message: String(response.data.commit?.message || '').split('\n')[0].slice(0, 120)
    }
    repositoryHeads.set(repository, { ...entry, etag: response.etag })
    return entry
  } catch (error) {
    if (cached) return { ...cached, error: error.message }
    return { sha: '', date: null, message: '', error: error.message }
  }
}

function getVersionCommit(version) {
  const override = versionCommitOverrides[version.id]
  return typeof override === 'string' && /^[a-f0-9]{40}$/i.test(override) ? override : version.commit
}

function readVersionCommits() {
  try {
    const saved = JSON.parse(fs.readFileSync(versionCommitsPath, 'utf8'))
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const version of launcherConfig.versions) {
        if (typeof saved[version.id] === 'string') versionCommitOverrides[version.id] = saved[version.id]
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Не удалось прочитать сохранённые коммиты версий: ${error.message}`, { cause: error })
  }
}

async function persistVersionCommits() {
  await fsp.mkdir(path.dirname(versionCommitsPath), { recursive: true })
  const temporaryPath = `${versionCommitsPath}.tmp`
  await fsp.writeFile(temporaryPath, JSON.stringify(versionCommitOverrides, null, 2))
  await fsp.rename(temporaryPath, versionCommitsPath)
}

function readGameLocations() {
  try {
    const saved = JSON.parse(fs.readFileSync(gameLocationsPath, 'utf8'))
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const version of launcherConfig.versions) {
        if (typeof saved[version.id] === 'string') gameLocations[version.id] = path.resolve(saved[version.id])
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Не удалось прочитать выбранные папки игры: ${error.message}`, { cause: error })
  }
}

async function persistGameLocations() {
  await fsp.mkdir(path.dirname(gameLocationsPath), { recursive: true })
  const temporaryPath = `${gameLocationsPath}.tmp`
  await fsp.writeFile(temporaryPath, JSON.stringify(gameLocations, null, 2))
  await fsp.rename(temporaryPath, gameLocationsPath)
}

function readGameStats() {
  try {
    const saved = JSON.parse(fs.readFileSync(gameStatsPath, 'utf8'))
    if (saved && saved.versions && typeof saved.versions === 'object') {
      gameStats = saved
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Не удалось прочитать статистику игры: ${error.message}`, { cause: error })
  }
  for (const stats of Object.values(gameStats.versions)) {
    if (stats.activeSince) {
      stats.playSeconds = Math.max(0, Number(stats.playSeconds) || 0) +
        Math.max(0, Math.floor((Date.now() - stats.activeSince) / 1000))
      stats.activeSince = null
    }
  }
}

function persistGameStats() {
  statsWrite = statsWrite.catch(error => {
    console.error('Previous playtime statistics save failed:', error)
  }).then(async () => {
    await fsp.mkdir(path.dirname(gameStatsPath), { recursive: true })
    const temporaryPath = `${gameStatsPath}.tmp`
    await fsp.writeFile(temporaryPath, JSON.stringify(gameStats, null, 2))
    await fsp.rename(temporaryPath, gameStatsPath)
  })
  return statsWrite
}

async function checkpointGameSessions() {
  const now = Date.now()
  for (const session of activeGames.values()) {
    const record = gameStats.versions[session.versionId]
    if (!record) continue
    record.playSeconds = Math.max(0, Number(record.playSeconds) || 0) +
      Math.max(0, Math.floor((now - session.lastCheckpointAt) / 1000))
    record.activeSince = now
    session.lastCheckpointAt = now
  }
  if (activeGames.size) await persistGameStats()
}

function getVersionStats(versionId) {
  const saved = gameStats.versions[versionId] || {}
  const versionSessions = [...activeGames.values()]
    .filter(session => session.versionId === versionId)
  const activeSeconds = versionSessions
    .reduce((total, session) => total + Math.floor((Date.now() - session.lastCheckpointAt) / 1000), 0)
  let installedAt = saved.installedAt || null
  if (!installedAt) {
    try {
      const jarStats = fs.statSync(path.join(getVersionDirectory(versionId), 'AoH2MP.jar'))
      installedAt = jarStats.birthtime.toISOString()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return {
    playSeconds: Math.max(0, Number(saved.playSeconds) || 0) + activeSeconds,
    lastPlayed: saved.lastPlayed || null,
    sessions: Math.max(0, Number(saved.sessions) || 0) + [...activeGames.values()]
      .filter(session => session.versionId === versionId).length,
    installedAt,
    running: versionSessions.length > 0
  }
}

function getJavaExecutable() {
  const candidates = new Set()
  const addJava = candidate => {
    if (candidate) candidates.add(path.resolve(candidate))
  }
  const addJavaHome = home => {
    if (!home) return
    addJava(path.join(home, 'bin', 'java.exe'))
    addJava(path.join(home, 'bin', 'javaw.exe'))
  }

  addJavaHome(process.env.JAVA_HOME)
  const localJdks = process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.jdks')
  if (localJdks) {
    try {
      for (const entry of fs.readdirSync(localJdks, { withFileTypes: true })) {
        if (entry.isDirectory()) addJavaHome(path.join(localJdks, entry.name))
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
  }
  const programRoots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')
  ].filter(Boolean)
  for (const root of programRoots) {
    for (const vendor of ['Eclipse Adoptium', 'Java', 'Microsoft', 'Amazon Corretto', 'Zulu']) {
      const vendorDirectory = path.join(root, vendor)
      try {
        for (const entry of fs.readdirSync(vendorDirectory, { withFileTypes: true })) {
          if (entry.isDirectory()) addJavaHome(path.join(vendorDirectory, entry.name))
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      }
    }
  }
  for (const javaHome of [
    process.env.ProgramData && path.join(process.env.ProgramData, 'Oracle', 'Java'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Common Files', 'Oracle', 'Java', 'javapath'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Common Files', 'Oracle', 'Java', 'javapath'),
    'C:\\Java'
  ].filter(Boolean)) {
    addJavaHome(javaHome)
    addJava(path.join(javaHome, 'java.exe'))
    addJava(path.join(javaHome, 'javaw.exe'))
  }
  for (const root of [
    process.env.ProgramData && path.join(process.env.ProgramData, 'Oracle', 'Java'),
    'C:\\Java'
  ].filter(Boolean)) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) addJavaHome(path.join(root, entry.name))
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
  }

  for (const key of [
    'HKLM\\SOFTWARE\\Eclipse Adoptium',
    'HKLM\\SOFTWARE\\JavaSoft\\JDK',
    'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
    'HKCU\\SOFTWARE\\JavaSoft\\JDK',
    'HKCU\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
    'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK',
    'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment',
    'HKLM\\SOFTWARE\\WOW6432Node\\Eclipse Adoptium'
  ]) {
    const result = spawnSync('reg.exe', ['query', key, '/s'], { encoding: 'utf8', windowsHide: true })
    if (result.error && result.error.code !== 'ENOENT') throw result.error
    if (result.status === 0) {
      for (const match of result.stdout.matchAll(/JavaHome\s+REG_(?:EXPAND_)?SZ\s+(.+)/gi)) {
        addJavaHome(match[1].trim())
      }
    }
  }
  for (const key of [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]) {
    const result = spawnSync('reg.exe', ['query', key, '/s', '/f', 'Java 17'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    })
    if (result.error && result.error.code !== 'ENOENT') throw result.error
    for (const match of (result.stdout || '').matchAll(/InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+)/gi)) {
      addJavaHome(match[1].trim())
    }
  }

  const where = spawnSync('where.exe', ['java.exe'], { encoding: 'utf8', windowsHide: true })
  if (where.error && where.error.code !== 'ENOENT') throw where.error
  if (where.status === 0) {
    for (const candidate of where.stdout.split(/\r?\n/)) addJava(candidate.trim())
  }

  let compatibleJava = null
  const checkedExecutables = new Set()
  for (const executable of candidates) {
    if (!fs.existsSync(executable)) continue
    const java = path.basename(executable).toLowerCase() === 'javaw.exe'
      ? path.join(path.dirname(executable), 'java.exe')
      : executable
    if (!fs.existsSync(java)) continue
    const normalizedJava = path.resolve(java).toLowerCase()
    if (checkedExecutables.has(normalizedJava)) continue
    checkedExecutables.add(normalizedJava)
    const result = spawnSync(java, ['-version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    })
    if (result.error) {
      if (result.error.code === 'ENOENT' || result.error.code === 'ETIMEDOUT') continue
      throw result.error
    }
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    const match = output.match(/version\s+"?(\d+)(?:\.(\d+))?/i)
    if (result.status !== 0 || !match || Number(match[1]) < 17) continue
    const javaw = path.join(path.dirname(java), 'javaw.exe')
    const found = {
      executable: fs.existsSync(javaw) ? javaw : java,
      version: `${match[1]}.${match[2] || '0'}`
    }
    if (Number(match[1]) === 17) return found
    if (!compatibleJava) compatibleJava = found
  }
  return compatibleJava
}

async function finishGameSession(versionId, sessionId, error) {
  const session = activeGames.get(sessionId)
  if (!session) return
  activeGames.delete(sessionId)
  const record = gameStats.versions[versionId]
  if (record) {
    record.playSeconds = Math.max(0, Number(record.playSeconds) || 0) +
      Math.max(0, Math.floor((Date.now() - session.lastCheckpointAt) / 1000))
    record.lastPlayed = new Date(session.startedAt).toISOString()
    record.sessions = Math.max(0, Number(record.sessions) || 0) + 1
    record.activeSince = null
  }
  await persistGameStats()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('game:exited', { versionId, error: error?.message || null })
  }
  if (session.closeWhenFinished && BrowserWindow.getAllWindows().length === 0) app.quit()
}

function getVersion(versionId) {
  const version = launcherConfig.versions.find(item => item.id === versionId)
  if (!version) throw new Error('Неизвестная версия мода.')
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(version.id)) {
    throw new Error('Некорректный идентификатор версии в launcher-config.json.')
  }
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(version.repository)) {
    throw new Error('Некорректный репозиторий версии в launcher-config.json.')
  }
  return version
}

function getApplicationDirectory() {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(app.getAppPath())
}

function getVersionsDirectory() {
  return writableVersionsDirectory || path.join(getApplicationDirectory(), 'Games')
}

async function ensureVersionsDirectory() {
  if (writableVersionsDirectory) return writableVersionsDirectory
  const applicationGamesDirectory = path.join(getApplicationDirectory(), 'Games')
  try {
    await fsp.mkdir(applicationGamesDirectory, { recursive: true })
    const probePath = path.join(applicationGamesDirectory, `.launcher-write-test-${process.pid}-${Date.now()}`)
    await fsp.writeFile(probePath, '')
    await fsp.unlink(probePath)
    writableVersionsDirectory = applicationGamesDirectory
  } catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM' && error.code !== 'EROFS') throw error
    const userGamesDirectory = path.join(app.getPath('userData'), 'Games')
    await fsp.mkdir(userGamesDirectory, { recursive: true })
    const probePath = path.join(userGamesDirectory, `.launcher-write-test-${process.pid}-${Date.now()}`)
    await fsp.writeFile(probePath, '')
    await fsp.unlink(probePath)
    writableVersionsDirectory = userGamesDirectory
  }
  return writableVersionsDirectory
}

function getVersionDirectory(versionId) {
  const id = getVersion(versionId).id
  return gameLocations[id] || path.join(getVersionsDirectory(), id)
}

function isGameJar(directory) {
  try {
    return fs.statSync(path.join(directory, 'AoH2MP.jar')).isFile()
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

function getSearchRoots() {
  return [getApplicationDirectory()]
}

async function scanRootsForGameJar(roots, searchState) {
  let pending = roots.map(directory => ({ directory, depth: 0 }))
  while (pending.length && !searchState.found && searchState.visited < discoveryLimits.directories &&
    Date.now() - searchState.startedAt < discoveryLimits.milliseconds) {
    const batch = pending.splice(0, discoveryLimits.workers)
    const results = await Promise.all(batch.map(async ({ directory, depth }) => {
      const normalized = path.resolve(directory).toLowerCase()
      if (searchState.seen.has(normalized)) return null
      searchState.seen.add(normalized)
      searchState.visited += 1

      let entries
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES' || error.code === 'EPERM') return null
        throw error
      }
      if (entries.some(entry => entry.isFile() && entry.name.toLowerCase() === 'aoh2mp.jar')) return { found: directory, directories: [] }
      if (depth >= discoveryLimits.depth) return null
      return {
        directories: entries
          .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() &&
            !skippedDirectoryNames.has(entry.name.toLowerCase()))
          .map(entry => ({ directory: path.join(directory, entry.name), depth: depth + 1 }))
      }
    }))
    const match = results.find(result => result?.found)
    if (match) {
      searchState.found = match.found
      break
    }
    for (const result of results) {
      if (result?.directories) pending.push(...result.directories)
    }
  }
  return searchState.found
}

async function discoverExistingGameDirectory(versionId) {
  const version = getVersion(versionId)
  const id = version.id
  if (gameDiscoveryCompleted.has(id)) return gameLocations[id] || null
  const configuredDirectory = gameLocations[id]
  if (configuredDirectory && isGameJar(configuredDirectory)) {
    gameDiscoveryCompleted.add(id)
    return configuredDirectory
  }
  if (configuredDirectory) {
    delete gameLocations[id]
    await persistGameLocations()
  }
  const applicationDirectory = getApplicationDirectory()
  const adjacentCandidates = [
    path.join(applicationDirectory, 'Games', id),
    path.join(applicationDirectory, id),
    applicationDirectory,
    path.dirname(applicationDirectory)
  ]
  for (const candidate of adjacentCandidates) {
    if (isGameJar(candidate)) {
      gameLocations[id] = candidate
      await persistGameLocations()
      gameDiscoveryCompleted.add(id)
      return candidate
    }
  }
  if (gameDiscoveryPromises.has(id)) return gameDiscoveryPromises.get(id)

  const searchState = { startedAt: Date.now(), visited: 0, seen: new Set(), found: null }
  const discovery = (async () => {
    await scanRootsForGameJar(getSearchRoots(), searchState)
    if (searchState.found) {
      gameLocations[id] = searchState.found
      await persistGameLocations()
    }
    gameDiscoveryCompleted.add(id)
    return searchState.found
  })().finally(() => {
    gameDiscoveryCompleted.add(id)
    gameDiscoveryPromises.delete(id)
  })
  gameDiscoveryPromises.set(id, discovery)
  return discovery
}

function isInstalled(versionId) {
  try {
    return fs.statSync(path.join(getVersionDirectory(versionId), 'AoH2MP.jar')).isFile()
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

function reportDownload(webContents, data) {
  if (!webContents.isDestroyed()) webContents.send('mod:download-progress', data)
}

function reportGameDiscovery(result) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mod:game-discovery', result)
  }
}

// Tells every window that the install state changed so the launcher list and the open
// version page stay in sync, no matter which window performed the action.
function reportStatusChange() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mod:status-changed')
  }
}

function extractModArchive(archivePath, destination, onProgress) {
  return new Promise((resolve, reject) => {
    let archive
    let settled = false
    let failure = null
    let archiveEnded = false
    let activeEntries = 0
    let fileCount = 0
    let expandedSize = 0
    let completedEntries = 0
    const queue = []
    let entryCount = 0

    const fail = error => {
      if (settled || failure) return
      failure = error
      queue.length = 0
      archive?.close()
      finishIfDone()
    }
    const finishIfDone = () => {
      if (settled) return
      if (failure) {
        if (activeEntries) return
        settled = true
        reject(failure)
        return
      }
      if (!archiveEnded || activeEntries || queue.length) return
      settled = true
      onProgress({ percent: 100, completedEntries, entryCount, expandedSize })
      archive.close()
      resolve()
    }
    const pump = () => {
      while (!settled && !failure && activeEntries < 8 && queue.length) {
        const entry = queue.shift()
        activeEntries += 1
        processEntry(entry).catch(fail).finally(() => {
          activeEntries -= 1
          completedEntries += 1
          if (!failure) {
            onProgress({
              percent: entryCount ? Math.min(100, Math.floor(completedEntries / entryCount * 100)) : 0,
              completedEntries,
              entryCount,
              expandedSize
            })
          }
          pump()
          finishIfDone()
        })
      }
      finishIfDone()
    }
    const processEntry = async entry => {
      fileCount += 1
      expandedSize += entry.uncompressedSize
      if (fileCount > 100000 || expandedSize > 2 * 1024 * 1024 * 1024) {
        throw new Error('Архив мода превышает безопасный лимит распаковки.')
      }
      const relativePath = entry.fileName.replace(/\\/g, '/')
      const segments = relativePath.split('/')
      if (
        !relativePath ||
        relativePath.startsWith('/') ||
        /^[a-zA-Z]:/.test(relativePath) ||
        segments.includes('..') ||
        segments.includes('.') ||
        relativePath.includes('\0')
      ) {
        throw new Error('В ZIP-архиве обнаружен недопустимый путь.')
      }

      const mode = (entry.externalFileAttributes >>> 16) & 0xF000
      const isDirectory = relativePath.endsWith('/')
      if (mode === 0xA000 || (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)) {
        throw new Error('В ZIP-архиве обнаружена ссылка или специальный файл.')
      }

      const outputPath = path.resolve(destination, ...segments.filter(Boolean))
      const pathFromRoot = path.relative(destination, outputPath)
      if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(pathFromRoot)) {
        throw new Error('Путь в ZIP-архиве выходит за пределы папки мода.')
      }

      if (isDirectory || mode === 0x4000) {
        await fsp.mkdir(outputPath, { recursive: true })
        return
      }
      await fsp.mkdir(path.dirname(outputPath), { recursive: true })
      const stream = await new Promise((resolveStream, rejectStream) => {
        archive.openReadStream(entry, (error, openedStream) => error ? rejectStream(error) : resolveStream(openedStream))
      })
      await pipeline(stream, fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }))
    }

    yauzl.open(archivePath, {
      lazyEntries: true,
      autoClose: false,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    }, (openError, openedArchive) => {
      if (openError) {
        fail(openError)
        return
      }
      archive = openedArchive
      entryCount = archive.entryCount
      archive.on('error', fail)
      archive.on('end', () => {
        archiveEnded = true
        finishIfDone()
      })
      archive.on('entry', entry => {
        if (settled || failure) return
        queue.push(entry)
        archive.readEntry()
        pump()
      })
      archive.readEntry()
    })
  })
}

ipcMain.handle('launcher:get-config', () => launcherConfig)
ipcMain.handle('launcher:get-java', () => getJavaExecutable())
ipcMain.handle('launcher:open-launch-log', async (_event, versionId) => {
  const version = getVersion(versionId)
  const logPath = path.join(app.getPath('userData'), 'logs', `${version.id}-latest.log`)
  if (!fs.existsSync(logPath)) throw new Error('Журнал пока не создан. Нажми «Играть», чтобы записать попытку запуска.')
  const result = await shell.openPath(logPath)
  if (result) throw new Error(`Не удалось открыть журнал запуска: ${result}`)
})
ipcMain.handle('launcher:create-crash-report', async (_event, { versionId, subject, details }) => {
  const version = getVersion(versionId)
  if (typeof subject !== 'string' || typeof details !== 'string') {
    throw new Error('Заполни тему и описание ошибки.')
  }
  const logPath = path.join(app.getPath('userData'), 'logs', `${version.id}-latest.log`)
  let logText
  try {
    logText = await fsp.readFile(logPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Журнал запуска не найден. Попробуй снова запустить игру.')
    throw error
  }
  const report = [
    'AOC 2 Multiplayer — crash report',
    `Date: ${new Date().toISOString()}`,
    `Launcher: ${app.getVersion()}`,
    `Game version: ${version.name}`,
    '',
    'Subject:',
    subject.trim().slice(0, 100),
    '',
    'Description:',
    details.trim().slice(0, 3000) || '(not provided)',
    '',
    'Launch log:',
    logText
  ].join('\r\n')
  const owner = BrowserWindow.getFocusedWindow()
  const options = {
    title: 'Сохранить отчет об ошибке',
    defaultPath: path.join(app.getPath('documents'), `AOC2-crash-report-${version.version}.txt`),
    filters: [{ name: 'Отчет об ошибке', extensions: ['txt'] }]
  }
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true }
  await fsp.writeFile(result.filePath, report, 'utf8')
  const support = launcherConfig.community.find(link => /discord/i.test(link.label))?.url
  if (support) await shell.openExternal(support)
  return { canceled: false, filePath: result.filePath }
})
ipcMain.handle('launcher:send-crash-report', async (_event, { versionId, subject, details }) => {
  const version = getVersion(versionId)
  const logPath = path.join(app.getPath('userData'), 'logs', `${version.id}-latest.log`)
  let logText = ''
  try {
    logText = await fsp.readFile(logPath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const report = [
    'AOC 2 Multiplayer — ошибка запуска',
    `Launcher: ${app.getVersion()}`,
    `Version: ${version.name}`,
    `Date: ${new Date().toISOString()}`,
    '',
    `Тема: ${(subject || '').trim().slice(0, 100) || '—'}`,
    '',
    'Описание:',
    (details || '').trim().slice(0, 3000) || '(не указано)',
    '',
    `Журнал запуска: ${logPath}`,
    logText ? `\n${logText.split(/\r?\n/).slice(-60).join('\n')}` : '(журнал пока не создан)'
  ].join('\n')

  if (TELEGRAM_BOT_TOKEN) {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '@communityAOC2mp', text: report })
    })
    if (!response.ok) throw new Error(`Telegram API вернул ошибку (HTTP ${response.status}).`)
    return { copied: false, sent: true, logPath, logExists: Boolean(logText) }
  }

  clipboard.writeText(report)
  await shell.openExternal(TELEGRAM_SUPPORT_URL)
  return { copied: true, sent: false, logPath, logExists: Boolean(logText) }
})
ipcMain.handle('launcher:open-logs-folder', async () => {
  const logsDirectory = path.join(app.getPath('userData'), 'logs')
  await fsp.mkdir(logsDirectory, { recursive: true })
  const result = await shell.openPath(logsDirectory)
  if (result) throw new Error(`Не удалось открыть папку с журналами: ${result}`)
  return { opened: true, path: logsDirectory }
})
ipcMain.handle('launcher:open-last-crash', async () => {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) throw new Error('Каталог логов не найден.')
    const entries = await fsp.readdir(logsDir, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile() && e.name.endsWith('-latest.log'))
      .map(e => ({ name: e.name, path: path.join(logsDir, e.name), mtime: fs.statSync(path.join(logsDir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const file of files) {
      let content = ''
      try { content = await fsp.readFile(file.path, 'utf8') } catch (e) { continue }
      if (/Process error|Process exit: code=(?!0)/.test(content)) {
        const result = await shell.openPath(file.path)
        if (result) throw new Error(`Не удалось открыть лог: ${result}`)
        return { opened: true, path: file.path }
      }
    }
    throw new Error('Крашей не найдено в логах.')
  } catch (error) {
    throw error
  }
})

ipcMain.handle('launcher:download-java', async () => {
  await shell.openExternal(JAVA_DOWNLOAD_URL)
  return { opened: true }
})
ipcMain.handle('launcher:check-updates', async () => {
  if (!app.isPackaged) return { supported: false, version: app.getVersion() }
  try {
    await autoUpdater.checkForUpdates()
    return { supported: true, version: app.getVersion() }
  } catch (error) {
    console.error('Could not check for launcher updates:', error)
    reportLauncherUpdate({ phase: 'error', message: error.message })
    return { supported: true, version: app.getVersion(), error: error.message }
  }
})
ipcMain.handle('launcher:install-update', () => {
  autoUpdater.quitAndInstall()
})
ipcMain.handle('launcher:check-repo-update', () => checkRepoUpdate())
ipcMain.handle('launcher:apply-repo-update', () => applyRepoUpdate())
ipcMain.handle('window:minimize', event => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.handle('window:close', event => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

ipcMain.handle('mod:get-status', async () => {
  await ensureVersionsDirectory()
  const versions = []
  for (const version of launcherConfig.versions) {
    if (!isInstalled(version.id) && !gameDiscoveryCompleted.has(version.id) &&
      !gameDiscoveryPromises.has(version.id)) {
      discoverExistingGameDirectory(version.id).then(directory => {
        reportGameDiscovery({ versionId: version.id, found: Boolean(directory) })
      }).catch(error => {
        console.error(`Could not search for the game folder for ${version.id}:`, error)
        reportGameDiscovery({ versionId: version.id, found: false, error: error.message })
      })
    }
    const installDirectory = getVersionDirectory(version.id)
    const installed = isInstalled(version.id)
    const stats = getVersionStats(version.id)
    if (installed && !stats.installedAt) {
      try {
        stats.installedAt = fs.statSync(path.join(installDirectory, 'AoH2MP.jar')).birthtime.toISOString()
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    versions.push({
      id: version.id,
      installed,
      installDirectory,
      commit: getVersionCommit(version) || '',
      external: Boolean(gameLocations[version.id]),
      searching: gameDiscoveryPromises.has(version.id),
      stats
    })
  }
  return {
    versionsDirectory: getVersionsDirectory(),
    versions,
    java: getJavaExecutable()
  }
})

ipcMain.handle('game:get-stats', (_event, versionId) => ({
  ...getVersionStats(getVersion(versionId).id)
}))

async function installVersionFromCommit(event, versionId, requestedCommit) {
  const version = getVersion(versionId)
  const commit = requestedCommit || getVersionCommit(version)
  if (!/^[a-f0-9]{40}$/i.test(commit || '')) {
    throw new Error(`Для версии ${version.name} ещё не указан опубликованный коммит. Скачивание пока недоступно.`)
  }
  if (isInstalled(version.id) && !requestedCommit) {
    return { installed: true, installDirectory: getVersionDirectory(version.id) }
  }

  const versionsDirectory = await ensureVersionsDirectory()
  const workDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aoc2-mod-'))
  const archivePath = path.join(workDirectory, 'source.zip')
  const extractDirectory = path.join(workDirectory, 'extracted')
  let stagingDirectory

  try {
    await fsp.mkdir(versionsDirectory, { recursive: true })
    await fsp.mkdir(extractDirectory, { recursive: true })

    const archiveUrl = `https://codeload.github.com/${version.repository}/zip/${commit}`
    const controller = new AbortController()
    let requestTimeout
    const refreshRequestTimeout = () => {
      clearTimeout(requestTimeout)
      requestTimeout = setTimeout(() => controller.abort(), 45_000)
    }
    refreshRequestTimeout()
    let response
    try {
      response = await fetch(archiveUrl, {
        headers: { 'User-Agent': 'AOC-2-Multiplayer', Accept: 'application/zip' },
        signal: controller.signal,
        redirect: 'follow'
      })
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Сервер загрузки не ответил за 45 секунд. Проверь интернет и попробуй снова.')
      throw error
    }
    refreshRequestTimeout()
    if (!response.ok || !response.body) {
      clearTimeout(requestTimeout)
      throw new Error(`Сервер загрузки вернул ошибку (HTTP ${response.status}).`)
    }

    const contentLength = Number(response.headers.get('content-length')) || 0
    if (contentLength > 1024 * 1024 * 1024) {
      clearTimeout(requestTimeout)
      throw new Error('ARCHIVE_TOO_LARGE')
    }

    const download = fs.createWriteStream(archivePath, { flags: 'wx' })
    const writeError = new Promise((_, reject) => download.once('error', reject))
    const reader = response.body.getReader()
    let downloaded = 0
    let lastProgressAt = Date.now()
    let lastProgressBytes = 0
    let speedBytesPerSecond = 0
    try {
      while (true) {
        refreshRequestTimeout()
        let chunk
        try {
          chunk = await reader.read()
        } catch (error) {
          if (controller.signal.aborted) throw new Error('Загрузка не передавала данные 45 секунд. Проверь интернет и попробуй снова.')
          throw error
        } finally {
          clearTimeout(requestTimeout)
        }
        const { done, value } = chunk
        if (done) break
        downloaded += value.byteLength
        if (downloaded > 1024 * 1024 * 1024) {
          throw new Error('ARCHIVE_TOO_LARGE')
        }
        if (!download.write(Buffer.from(value))) {
          await new Promise((resolve, reject) => {
            download.once('drain', resolve)
            download.once('error', reject)
          })
        }
        const now = Date.now()
        if (now - lastProgressAt >= 500 || downloaded === contentLength) {
          const elapsedSeconds = Math.max((now - lastProgressAt) / 1000, 0.001)
          const currentSpeed = (downloaded - lastProgressBytes) / elapsedSeconds
          speedBytesPerSecond = speedBytesPerSecond
            ? speedBytesPerSecond * 0.72 + currentSpeed * 0.28
            : currentSpeed
          lastProgressAt = now
          lastProgressBytes = downloaded
          reportDownload(event.sender, {
            phase: 'download',
            received: downloaded,
            total: contentLength,
            speedBytesPerSecond
          })
        }
      }
      await Promise.race([
        new Promise(resolve => download.end(resolve)),
        writeError
      ])
    } catch (error) {
      clearTimeout(requestTimeout)
      download.destroy()
      throw error
    } finally {
      clearTimeout(requestTimeout)
    }

    if (downloaded === 0) throw new Error('Сервер загрузки прислал пустой архив.')
    reportDownload(event.sender, {
      phase: 'download',
      received: downloaded,
      total: downloaded,
      speedBytesPerSecond
    })
    reportDownload(event.sender, { phase: 'extract', percent: 0, expandedSize: 0 })
    let lastExtractProgressAt = 0
    await extractModArchive(archivePath, extractDirectory, progress => {
      const now = Date.now()
      if (progress.percent === 100 || now - lastExtractProgressAt >= 100) {
        lastExtractProgressAt = now
        reportDownload(event.sender, { phase: 'extract', ...progress })
      }
    })

    const extractedEntries = await fsp.readdir(extractDirectory, { withFileTypes: true })
    const repositoryRoot = extractedEntries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(extractDirectory, entry.name))
      .find(candidate => fs.existsSync(path.join(candidate, 'AoH2MP.jar')))

    if (!repositoryRoot) {
      throw new Error('В загруженной версии не найден AoH2MP.jar.')
    }

    const destination = getVersionDirectory(version.id)
    stagingDirectory = path.join(versionsDirectory, `${version.id}.installing`)
    const previousDirectory = path.join(versionsDirectory, `${version.id}.previous`)
    await fsp.rm(stagingDirectory, { recursive: true, force: true })
    await fsp.rm(previousDirectory, { recursive: true, force: true })
    await fsp.cp(repositoryRoot, stagingDirectory, { recursive: true })

    let backupMoved = false
    if (isInstalled(version.id)) {
      await fsp.rename(destination, previousDirectory)
      backupMoved = true
    }
    try {
      await fsp.rename(stagingDirectory, destination)
    } catch (error) {
      if (backupMoved) await fsp.rename(previousDirectory, destination)
      throw error
    }
    await fsp.rm(previousDirectory, { recursive: true, force: true })

    const versionStats = gameStats.versions[version.id] || {}
    versionStats.installedAt = new Date().toISOString()
    gameStats.versions[version.id] = versionStats
    versionCommitOverrides[version.id] = commit
    await persistGameStats()
    await persistVersionCommits()
    reportDownload(event.sender, { phase: 'complete', received: downloaded, total: downloaded })
    reportStatusChange()
    return {
      installed: true,
      installDirectory: destination,
      commit,
      stats: getVersionStats(version.id)
    }
  } catch (error) {
    reportDownload(event.sender, { phase: 'error', message: error.message })
    throw error
  } finally {
    if (stagingDirectory) await fsp.rm(stagingDirectory, { recursive: true, force: true })
    await fsp.rm(workDirectory, { recursive: true, force: true })
  }
}

ipcMain.handle('mod:download', async (event, payload) => {
  const versionId = typeof payload === 'string' ? payload : payload?.versionId
  const commit = typeof payload === 'string' ? undefined : payload?.commit
  return installVersionFromCommit(event, versionId, commit)
})

ipcMain.handle('mod:check-updates', async () => {
  const result = {}
  for (const version of launcherConfig.versions) {
    const head = await getRepositoryHead(version.repository)
    const current = getVersionCommit(version) || ''
    result[version.id] = {
      current,
      latest: head.sha || '',
      date: head.date || null,
      message: head.message || '',
      available: Boolean(head.sha) && /^[a-f0-9]{40}$/i.test(current) && head.sha !== current,
      error: head.error || null
    }
  }
  return result
})

ipcMain.handle('mod:delete', async (_event, versionId) => {
  const version = getVersion(versionId)
  if (gameLocations[version.id]) throw new Error('Нельзя удалить выбранную внешнюю папку игры. Сбрось её расположение, чтобы удалить файлы через лаунчер.')
  if (getVersionStats(version.id).running) throw new Error('Сначала закрой игру, затем попробуй удалить её.')
  await fsp.rm(getVersionDirectory(version.id), { recursive: true, force: true })
  const stats = gameStats.versions[version.id]
  if (stats) {
    stats.installedAt = null
    await persistGameStats()
  }
  reportStatusChange()
  return { installed: false, id: version.id }
})

ipcMain.handle('mod:select-game-folder', async (_event, versionId) => {
  const version = getVersion(versionId)
  const owner = BrowserWindow.getFocusedWindow()
  const options = {
    title: 'Выбери папку с AoH2MP.jar',
    properties: ['openDirectory']
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return { canceled: true }
  const selectedDirectory = path.resolve(result.filePaths[0])
  const jarPath = path.join(selectedDirectory, 'AoH2MP.jar')
  let jarStats
  try {
    jarStats = await fsp.stat(jarPath)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('В выбранной папке не найден AoH2MP.jar. Выбери именно папку, где лежит JAR.')
    throw error
  }
  if (!jarStats.isFile()) throw new Error('AoH2MP.jar в выбранной папке не является файлом.')
  gameLocations[version.id] = selectedDirectory
  gameDiscoveryCompleted.add(version.id)
  await persistGameLocations()
  const record = gameStats.versions[version.id] || {}
  record.installedAt ||= jarStats.birthtime.toISOString()
  gameStats.versions[version.id] = record
  await persistGameStats()
  reportStatusChange()
  return { canceled: false, installDirectory: selectedDirectory }
})

ipcMain.handle('mod:reset-game-folder', async (_event, versionId) => {
  const version = getVersion(versionId)
  if (getVersionStats(version.id).running) throw new Error('Сначала закрой игру, затем смени папку.')
  delete gameLocations[version.id]
  gameDiscoveryCompleted.add(version.id)
  await persistGameLocations()
  reportStatusChange()
  return { installDirectory: getVersionDirectory(version.id) }
})

ipcMain.handle('mod:open-folder', async (_event, versionId) => {
  await ensureVersionsDirectory()
  const result = await shell.openPath(versionId ? getVersionDirectory(versionId) : getVersionsDirectory())
  if (result) throw new Error(`Не удалось открыть папку мода: ${result}`)
})

ipcMain.handle('mod:launch', async (_event, versionId) => {
  const version = getVersion(versionId)
  if (launchingVersions.size > 0 || activeGames.size > 0) {
    return { started: false, alreadyRunning: true }
  }
  launchingVersions.add(version.id)
  try {
  if (!isInstalled(version.id)) await discoverExistingGameDirectory(version.id)
  if (!isInstalled(version.id)) {
    throw new Error('Сначала скачайте и установите версию мода.')
  }

  const modDirectory = getVersionDirectory(version.id)
  const jarPath = path.join(modDirectory, 'AoH2MP.jar')
  if (!fs.existsSync(jarPath)) throw new Error('Файл AoH2MP.jar не найден в папке игры. Переустановите версию.')
  const java = getJavaExecutable()
  if (!java) return { started: false, javaMissing: true }

  const logDirectory = path.join(app.getPath('userData'), 'logs')
  const logPath = path.join(logDirectory, `${version.id}-latest.log`)
  await fsp.mkdir(logDirectory, { recursive: true })
  await fsp.writeFile(logPath, [
    `Launch time: ${new Date().toISOString()}`,
    `Java: ${java.executable} (${java.version})`,
    `Working directory: ${modDirectory}`,
    `JAR: ${jarPath}`,
    ''
  ].join('\r\n'))

  const sessionId = `${version.id}:${Date.now()}`
  const startedAt = Date.now()
  const record = gameStats.versions[version.id] || { playSeconds: 0, sessions: 0 }
  record.lastPlayed = new Date(startedAt).toISOString()
  record.activeSince = startedAt
  record.installedAt ||= fs.statSync(jarPath).birthtime.toISOString()
  gameStats.versions[version.id] = record
  const logDescriptor = fs.openSync(logPath, 'a')
  let child
  try {
    child = spawn(java.executable, ['-jar', jarPath], {
      cwd: modDirectory,
      detached: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
      windowsHide: false
    })
  } catch (error) {
    fs.closeSync(logDescriptor)
    throw new Error(`Не удалось запустить Java (${java.executable}): ${error.message}. Журнал: ${logPath}`, { cause: error })
  }
  fs.closeSync(logDescriptor)
  await new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(
      `Не удалось запустить Java (${java.executable}): ${error.message}. Журнал: ${logPath}`,
      { cause: error }
    )))
    child.once('spawn', resolve)
  })
  activeGames.set(sessionId, {
    versionId: version.id,
    startedAt,
    lastCheckpointAt: startedAt,
    closeWhenFinished: false,
    child
  })
  child.once('error', error => {
    fsp.appendFile(logPath, `\r\nProcess error: ${error.stack || error.message}\r\n`)
      .catch(logError => console.error('Could not write game launch error log:', logError))
    finishGameSession(version.id, sessionId, new Error(
      `Java завершилась с ошибкой: ${error.message}. Журнал: ${logPath}`
    )).catch(saveError => {
      console.error('Could not finish game session after a process error:', saveError)
    })
  })
  child.once('exit', (code, signal) => {
    const detail = `\r\nProcess exit: code=${code}, signal=${signal || 'none'}\r\n`
    fsp.appendFile(logPath, detail)
      .catch(logError => console.error('Could not write game exit log:', logError))
    const exitError = code !== 0 || signal
      ? new Error(`Игра завершилась с кодом ${code ?? '—'}${signal ? ` (сигнал ${signal})` : ''}. Журнал: ${logPath}`)
      : null
    finishGameSession(version.id, sessionId, exitError).catch(error => {
      console.error('Could not finish game session:', error)
    })
  })
  child.unref()
  await persistGameStats()
  return { started: true, javaVersion: java.version }
  } finally {
    launchingVersions.delete(version.id)
  }
})

ipcMain.handle('mod:stop', (_event, versionId) => {
  const version = getVersion(versionId)
  const session = [...activeGames.values()].find(item => item.versionId === version.id)
  if (!session) return { stopping: false }
  if (!session.child.kill()) throw new Error('Не удалось остановить процесс игры.')
  return { stopping: true }
})

function rendererWebPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
    devTools: !app.isPackaged,
    preload: path.join(__dirname, 'preload.cjs')
  }
}

function applyRendererPolicies(window) {
  window.webContents.setFrameRate(120)
  window.webContents.on('context-menu', (event, params) => {
    if (params.isEditable) return
    event.preventDefault()
  })
  window.webContents.on('before-input-event', (event, input) => {
    const active = window.webContents.getFocusedFrame()?.document?.activeElement || null
    const isTextField = Boolean(active && active.matches && active.matches('input, textarea, [contenteditable="true"]'))
    if (input.control && ['a', 'c'].includes(input.key.toLowerCase()) && !isTextField) {
      event.preventDefault()
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1220,
    height: 790,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: launcherConfig.branding.name,
    autoHideMenuBar: true,
    webPreferences: rendererWebPreferences()
  })

  applyRendererPolicies(window)
  window.loadFile(path.join(__dirname, '..', 'app', 'index.html'))
  return window
}

app.whenReady().then(() => {
  readGameLocations()
  readGameStats()
  readVersionCommits()
  // The repository version check runs from the renderer startup sequence so the prompt is
  // rendered inside the launcher window instead of a native Windows message box.
  createWindow()
  setInterval(() => checkpointGameSessions().catch(error => {
    console.error('Could not checkpoint playtime statistics:', error)
  }), 5000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (activeGames.size) {
      for (const session of activeGames.values()) session.closeWhenFinished = true
    } else {
      app.quit()
    }
  }
})
