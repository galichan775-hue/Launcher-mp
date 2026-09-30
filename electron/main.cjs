const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const { pipeline } = require('node:stream/promises')
const yauzl = require('yauzl')
const platform = require('./platform.cjs')
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

// --- Simple repo-based updater (reads version file committed in this repository) ---
const https = require('node:https')
const RAW_BASE = 'https://raw.githubusercontent.com/galichan775-hue/Launcher-mp/main/'

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    // A hung socket must not hold the startup screen hostage.
    request.setTimeout(8000, () => request.destroy(new Error('timeout')))
    request.on('error', reject)
  })
}

// Downloads with byte-level progress so a ~96 MB installer never looks like a frozen app.
// Follows redirects and enforces a timeout, otherwise a half-open socket hangs the update button.
function downloadFile(url, dest, onProgress, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    let settled = false
    const fail = err => {
      if (settled) return
      settled = true
      try { fs.unlinkSync(dest) } catch {}
      reject(err)
    }
    const request = https.get(url, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        if (redirectsLeft <= 0) return fail(new Error('Too many redirects'))
        file.close()
        return resolve(downloadFile(new URL(res.headers.location, url).toString(), dest, onProgress, redirectsLeft - 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return fail(new Error('HTTP ' + res.statusCode))
      }
      const total = Number(res.headers['content-length']) || 0
      let received = 0
      res.on('data', chunk => {
        received += chunk.length
        if (onProgress) {
          try { onProgress({ received, total, percent: total ? Math.min(100, Math.round(received / total * 100)) : 0 }) } catch {}
        }
      })
      res.on('error', fail)
      res.pipe(file)
      file.on('finish', () => file.close(() => { if (!settled) { settled = true; resolve(dest) } }))
      file.on('error', fail)
    })
    request.setTimeout(30000, () => { request.destroy(new Error('Превышено время ожидания ответа сервера.')) })
    request.on('error', fail)
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

// Collects every advertised version and returns the highest one, so a stale
// Vers-1.txt can never hide a newer latest.txt.
async function resolveRemoteVersion(local) {
  const candidates = [
    'update/Vers-1.txt',
    'update/latest.txt',
    'latest.txt',
    `v${local}.txt`,
    `${local}.txt`
  ]
  const found = []
  for (const candidate of candidates) {
    try {
      const text = (await fetchText(RAW_BASE + candidate)).trim().replace(/^v/, '').trim()
      if (/^\d+(\.\d+)*$/.test(text)) found.push(text)
    } catch (e) {
      // ignore and try next
    }
  }
  if (!found.length) return null
  return found.reduce((best, value) => (semverGt(value, best) ? value : best))
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

function broadcastUpdateProgress(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('repo:update-progress', payload)
  }
}

async function applyRepoUpdate() {
  const current = app.getVersion()
  const latest = await resolveRemoteVersion(current)
  // Nothing to do is a normal outcome, not a failure: the prompt must simply close.
  if (!latest || !semverGt(latest, current)) return { started: false, upToDate: true, current }
  const dest = path.join(app.getPath('temp'), platform.UPDATER_ARTIFACT)
  broadcastUpdateProgress({ phase: 'download', received: 0, total: 0, percent: 0, version: latest })
  await downloadFile(RAW_BASE + platform.UPDATER_ARTIFACT, dest, ({ received, total, percent }) => {
    broadcastUpdateProgress({ phase: 'download', received, total, percent, version: latest })
  })
  broadcastUpdateProgress({ phase: 'launch', percent: 100, version: latest })

  if (!platform.updaterCanSelfInstall()) {
    // Installing a .deb needs root, so a silent self-install is impossible: keep the file
    // and tell the user the exact command to run instead of failing halfway through.
    return {
      started: false,
      manual: true,
      version: latest,
      filePath: dest,
      fileName: path.basename(dest),
      installCommand: platform.updaterInstallCommand(path.basename(dest))
    }
  }

  const launchError = await shell.openPath(dest)
  if (launchError) {
    try { fs.unlinkSync(dest) } catch {}
    throw new Error(launchError)
  }
  // The installer cannot overwrite a running executable, so step aside and let it take over.
  setTimeout(() => app.quit(), 1200)
  return { started: true, version: latest }
}

// --- end repo-based updater ---

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
  return platform.findJavaExecutable()
}

// ~/Documents is frequently absent on fresh Linux installs, and a save dialog pointed at a
// missing folder either fails or silently lands somewhere unexpected.
function writableDocumentsDirectory() {
  const candidates = []
  try { candidates.push(app.getPath('documents')) } catch (error) { void error }
  try { candidates.push(app.getPath('home')) } catch (error) { void error }
  candidates.push(process.cwd())
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES') continue
      throw error
    }
  }
  return app.getPath('temp')
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

function isSingleplayerVersion(version) {
  return version.kind === 'singleplayer'
}

function getVersion(versionId) {
  const version = launcherConfig.versions.find(item => item.id === versionId)
  if (!version) throw new Error('Неизвестная версия мода.')
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(version.id)) {
    throw new Error('Некорректный идентификатор версии в launcher-config.json.')
  }
  // Singleplayer entries ship with another version's files, so they have no repository of their own.
  if (isSingleplayerVersion(version)) {
    if (!launcherConfig.versions.some(item => item.id === version.requires)) {
      throw new Error(`Версия ${version.id} требует несуществующую версию ${version.requires}.`)
    }
    if (!version.entryPoint) {
      throw new Error(`Для версии ${version.id} не указан entryPoint в launcher-config.json.`)
    }
    return version
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
  const version = getVersion(versionId)
  const id = isSingleplayerVersion(version) ? version.requires : version.id
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
  const version = getVersion(versionId)
  const directory = getVersionDirectory(versionId)
  if (isSingleplayerVersion(version)) {
    if (!isInstalled(version.requires)) return false
    return fs.existsSync(path.join(directory, version.entryPoint))
  }
  try {
    return fs.statSync(path.join(directory, 'AoH2MP.jar')).isFile()
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

// GitHub archives carry a unix mode in the high half of externalFileAttributes. Keeping the
// execute bit matters on Linux, where a mod that ships a script or a native library would
// otherwise be unpacked as a plain unreadable-locked file and fail to start.
function entryMode(entry) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xFFFF
  if (!unixMode) return 0o644
  return (unixMode & 0o111) ? 0o755 : 0o644
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
        await fsp.mkdir(outputPath, { recursive: true, mode: 0o755 })
        return
      }
      await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o755 })
      const stream = await new Promise((resolveStream, rejectStream) => {
        archive.openReadStream(entry, (error, openedStream) => error ? rejectStream(error) : resolveStream(openedStream))
      })
      await pipeline(stream, fs.createWriteStream(outputPath, { flags: 'wx', mode: entryMode(entry) }))
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

ipcMain.handle('launcher:get-config', () => ({ ...launcherConfig, platform: platform.describePlatform() }))
ipcMain.handle('launcher:get-java', () => getJavaExecutable())
ipcMain.handle('launcher:reveal-file', async (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath) throw new Error('Нет пути к файлу.')
  // the renderer may only ask to open the folder holding a downloaded updater artifact, so the
  // path is resolved and pinned to the temp directory instead of being opened as given
  const resolved = path.resolve(targetPath)
  const tempDir = path.resolve(app.getPath('temp'))
  if (path.dirname(resolved) !== tempDir) throw new Error('Можно открыть только папку загрузки обновления.')
  if (path.basename(resolved) !== platform.UPDATER_ARTIFACT) throw new Error('Это не файл обновления.')
  if (!fs.existsSync(resolved)) throw new Error('Файл ещё не скачан. Сначала дождитесь загрузки.')
  const result = await shell.openPath(tempDir)
  if (result) throw new Error(`Не удалось открыть папку: ${result}`)
  return { opened: true, path: tempDir }
})
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
    defaultPath: path.join(writableDocumentsDirectory(), `AOC2-crash-report-${version.version}.txt`),
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
      supported: platform.isVersionSupported(version),
      requiresPlatform: platform.unsupportedLabel(version),
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
  if (!platform.isVersionSupported(version)) {
    throw new Error(platform.unsupportedMessage(version, platform.platformLabel()))
  }
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
  // Singleplayer lives in the host version's folder but runs its own jar, so it must not require
  // the multiplayer one to be present.
  const singleplayer = isSingleplayerVersion(version)
  const jarName = singleplayer ? version.entryPoint : 'AoH2MP.jar'
  const jarPath = path.join(modDirectory, jarName)
  if (!fs.existsSync(jarPath)) {
    throw new Error('Файл ' + jarName + ' не найден. Переустановите '
      + (singleplayer ? 'Bloody Europe 1.9.3.' : 'версию.'))
  }
  const java = getJavaExecutable()
  if (!java) return { started: false, javaMissing: true }

  // Singleplayer entries ship with another version's files, so only the jar differs from the
  // multiplayer path below; the launch itself is the same java -jar call.
  if (singleplayer) {
    const entryPath = jarPath
    const entryLogDirectory = path.join(app.getPath('userData'), 'logs')
    const entryLogPath = path.join(entryLogDirectory, version.id + '-latest.log')
    await fsp.mkdir(entryLogDirectory, { recursive: true })
    await fsp.writeFile(entryLogPath, [
      'Launch time: ' + new Date().toISOString(),
      `Java: ${java.executable} (${java.version})`,
      'Working directory: ' + modDirectory,
      'JAR: ' + entryPath,
      ''
    ].join('\r\n'))

    const entrySessionId = version.id + ':' + Date.now()
    const entryStartedAt = Date.now()
    const entryRecord = gameStats.versions[version.id] || { playSeconds: 0, sessions: 0 }
    entryRecord.lastPlayed = new Date(entryStartedAt).toISOString()
    entryRecord.activeSince = entryStartedAt
    try { entryRecord.installedAt = fs.statSync(entryPath).birthtime.toISOString() } catch (error) { void error }
    gameStats.versions[version.id] = entryRecord
    const entryLog = fs.openSync(entryLogPath, 'a')
    let entryChild
    try {
      entryChild = spawn(java.executable, ['-jar', entryPath], {
        cwd: modDirectory,
        detached: true,
        stdio: ['ignore', entryLog, entryLog],
        windowsHide: false
      })
    } catch (error) {
      fs.closeSync(entryLog)
      throw new Error('Не удалось запустить Java (' + java.executable + '): ' + error.message, { cause: error })
    }
    fs.closeSync(entryLog)
    await new Promise((resolve, reject) => {
      entryChild.once('error', error => reject(new Error(
        'Не удалось запустить Java (' + java.executable + '): ' + error.message,
        { cause: error }
      )))
      entryChild.once('spawn', resolve)
    })
    activeGames.set(entrySessionId, {
      versionId: version.id,
      startedAt: entryStartedAt,
      lastCheckpointAt: entryStartedAt,
      closeWhenFinished: false,
      child: entryChild
    })
    entryChild.once('error', error => {
      finishGameSession(version.id, entrySessionId, error).catch(() => {})
    })
    entryChild.once('exit', (code, signal) => {
      const detail = '\r\nProcess exit: code=' + code + ', signal=' + (signal || 'none') + '\r\n'
      fsp.appendFile(entryLogPath, detail).catch(() => {})
      finishGameSession(version.id, entrySessionId, null).catch(() => {})
    })
    entryChild.unref()
    await persistGameStats()
    reportStatusChange()
    return { started: true, entryPoint: version.entryPoint }
  }

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
  // Ctrl+A / Ctrl+C outside text fields is handled in the renderer: WebFrameMain has no
  // access to document.activeElement, so the main process cannot answer that question.
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
