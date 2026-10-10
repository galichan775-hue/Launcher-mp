const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const yauzl = require('yauzl')
const platform = require('./platform.cjs')
const {
  CancelledError,
  downloadFile,
  downloadToFile,
  fetchTextWithDeadline,
  fileSize
} = require('./downloader.cjs')
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
const downloadsDirectory = path.join(app.getPath('userData'), 'downloads')
// The game is spawned detached, so it survives the launcher. A PID record is the only way to find
// such an orphan after a restart; without it a stuck game keeps its X11 pointer grab and the user
// has to reboot to get the mouse back.
const runningGamesPath = path.join(app.getPath('userData'), 'running-games.json')
// A mod archive is a few hundred megabytes at most; anything past this is a broken response or
// a hostile redirect and is refused before it can fill the disk.
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
// Partial downloads are kept so a broken link does not throw the work away, which means they
// have to be swept eventually or a permanently failing version eats the disk.
const PARTIAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
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
const RAW_BASE = 'https://raw.githubusercontent.com/galichan775-hue/Launcher-mp/main/'

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

// The startup screen waits on this check, so the whole thing is capped: five sequential 8 s
// timeouts used to keep the launcher closed for half a minute on a weak connection.
const REPO_CHECK_BUDGET_MS = 9000
const REPO_CHECK_TTL_MS = 20 * 60 * 1000
let repoVersionCache = null

async function fetchText(url) {
  return fetchTextWithDeadline(url, { timeoutMs: 5000, attempts: 1 })
}

// Collects every advertised version and returns the highest one, so a stale Vers-1.txt can never
// hide a newer latest.txt. The candidates are fetched in parallel under one shared deadline:
// sequential requests were the reason the launcher sat on the splash screen for 40 s offline.
async function resolveRemoteVersion(local) {
  const candidates = [
    'update/Vers-1.txt',
    'update/latest.txt',
    'latest.txt',
    `v${local}.txt`,
    `${local}.txt`
  ]
  const results = await Promise.allSettled(candidates.map(candidate =>
    fetchTextWithDeadline(RAW_BASE + candidate, { timeoutMs: REPO_CHECK_BUDGET_MS, attempts: 1 })
      .then(text => text.trim().replace(/^v/, '').trim())
  ))
  const found = results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .filter(text => /^\d+(\.\d+)*$/.test(text))
  if (!found.length) return null
  return found.reduce((best, value) => (semverGt(value, best) ? value : best))
}

function readRepoVersionCache() {
  if (repoVersionCache && Date.now() - repoVersionCache.at < REPO_CHECK_TTL_MS) return repoVersionCache
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'repo-version-cache.json'), 'utf8'))
    if (saved && Number.isFinite(saved.at) && Date.now() - saved.at < REPO_CHECK_TTL_MS) {
      repoVersionCache = saved
      return saved
    }
  } catch (error) {
    if (error.code !== 'ENOENT') void error
  }
  return null
}

function writeRepoVersionCache(value) {
  repoVersionCache = value
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'repo-version-cache.json'), JSON.stringify(value))
  } catch (error) {
    // Caching only saves a request; failing to write it must never break the check.
  }
}

// Reports the repository version without any native dialog: the renderer shows the prompt
// inside the launcher window so it keeps the app typography instead of the Windows theme.
async function checkRepoUpdate() {
  const current = app.getVersion()
  if (!app.isPackaged) return { supported: false, current, latest: null, available: false }
  const cached = readRepoVersionCache()
  if (cached && typeof cached.latest === 'string') {
    return { supported: true, current, latest: cached.latest, available: semverGt(cached.latest, current), fromCache: true }
  }
  try {
    const latest = await resolveRemoteVersion(current)
    writeRepoVersionCache({ at: Date.now(), latest })
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
  // The package is 90 MB. It used to be fetched with a 30 s socket timeout, no retry and no
  // resume, which is exactly the transfer that dies halfway on a slow or mobile link.
  // The digest in the config is what stops a tampered or truncated 90 MB package from being
  // handed to the shell installer, so it is verified whenever the config publishes one.
  await downloadToFile({
    url: RAW_BASE + platform.UPDATER_ARTIFACT,
    destination: dest,
    expectedTotal: launcherConfig.updater?.packageBytes || 0,
    expectedSha256: launcherConfig.updater?.sha256 || '',
    onProgress: ({ received, total, speedBytesPerSecond, attempt, retrying, retryInMs }) => {
      broadcastUpdateProgress({
        phase: 'download',
        received,
        total,
        speedBytesPerSecond,
        percent: total ? Math.min(100, Math.round(received / total * 100)) : 0,
        version: latest,
        attempt,
        retrying,
        retryInMs
      })
    }
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
// Unauthenticated GitHub allows 60 requests per hour per IP, and on a mobile or shared
// connection a whole neighbourhood can spend them. The answers are therefore cached on disk and
// a rate-limited answer is treated as "ask again later" instead of an error the user must read.
const repositoryHeads = new Map()
const MOD_UPDATE_TTL_MS = 30 * 60 * 1000
// A rate-limited answer stays valid for much longer: GitHub's unauthenticated quota refills at
// 60 requests per hour, so retrying sooner only makes the next real check fail too.
const MOD_RATE_LIMIT_TTL_MS = 45 * 60 * 1000
let modUpdateCache = null
let modUpdateInFlight = null
let modUpdateBlockedUntil = 0

async function fetchGitHubJson(url, etag) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AOC-2-Multiplayer',
        Accept: 'application/vnd.github+json',
        'Accept-Encoding': 'identity',
        ...(etag ? { 'If-None-Match': etag } : {})
      },
      signal: controller.signal
    })
    if (response.status === 304) return { notModified: true }
    if (response.status === 403 || response.status === 429) {
      const error = new Error('rate-limited')
      error.rateLimited = true
      const reset = Number(response.headers.get('x-ratelimit-reset')) || 0
      error.retryAt = reset ? reset * 1000 : Date.now() + 10 * 60 * 1000
      throw error
    }
    if (!response.ok) throw new Error(`GitHub API вернул ошибку (HTTP ${response.status}).`)
    return { etag: response.headers.get('etag'), data: await response.json() }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('GitHub API не ответил за 15 секунд.')
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
    if (cached) return { ...cached, error: error.rateLimited ? null : error.message }
    return { sha: '', date: null, message: '', error: error.rateLimited ? null : error.message }
  }
}

function getVersionCommit(version) {
  const override = versionCommitOverrides[version.id]
  return typeof override === 'string' && /^[a-f0-9]{40}$/i.test(override) ? override : version.commit
}

const modUpdateCachePath = () => path.join(app.getPath('userData'), 'mod-updates-cache.json')

function emptyUpdateResult() {
  const result = {}
  for (const version of launcherConfig.versions) {
    result[version.id] = {
      current: getVersionCommit(version) || '',
      latest: '',
      date: null,
      message: '',
      available: false,
      error: null
    }
  }
  return result
}

function readModUpdateCache() {
  if (modUpdateCache && Date.now() - modUpdateCache.at < MOD_UPDATE_TTL_MS) return modUpdateCache
  try {
    const saved = JSON.parse(fs.readFileSync(modUpdateCachePath(), 'utf8'))
    if (saved && Number.isFinite(saved.at) && saved.versions && typeof saved.versions === 'object' &&
      Date.now() - saved.at < (saved.rateLimited ? MOD_RATE_LIMIT_TTL_MS : MOD_UPDATE_TTL_MS)) {
      modUpdateCache = saved
      return saved
    }
  } catch (error) {
    if (error.code !== 'ENOENT') void error
  }
  return null
}

function writeModUpdateCache(versions, rateLimited) {
  const value = { at: Date.now(), versions, rateLimited: Boolean(rateLimited) }
  modUpdateCache = value
  if (rateLimited) modUpdateBlockedUntil = value.at + MOD_RATE_LIMIT_TTL_MS
  try {
    fs.writeFileSync(modUpdateCachePath(), JSON.stringify(value))
  } catch (error) {
    // Caching only saves API calls; failing to persist it must never break the check.
  }
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

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user, which still counts as running.
    return error.code === 'EPERM'
  }
}

// Only PIDs this launcher spawned are trusted: a recycled PID must never be killed on launch. The
// check reads /proc, so it is Linux-only; Windows keeps the old in-memory behaviour.
function isTrackedGameProcess(pid, jarPath) {
  if (process.platform === 'win32' || !jarPath) return false
  try {
    const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    if (!command.some(part => part === jarPath)) return false
    const executable = path.basename(command[0] || '')
    return executable === 'java' || executable === 'javaw' || executable.startsWith('java')
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') return false
    throw error
  }
}

function trackedGameRecords() {
  return [...activeGames.values()]
    .filter(session => session.pid)
    .map(session => ({
      versionId: session.versionId,
      pid: session.pid,
      jarPath: session.jarPath,
      startedAt: session.startedAt
    }))
}

function persistRunningGames() {
  const records = trackedGameRecords()
  return fsp.mkdir(path.dirname(runningGamesPath), { recursive: true })
    .then(() => fsp.writeFile(runningGamesPath, JSON.stringify(records, null, 2)))
    .catch(error => {
      console.error('Could not save the running game record:', error)
    })
}

// A game outlives the launcher on purpose. On startup, re-adopt anything still alive so its Stop
// button works again instead of leaving the user with a dead process they cannot reach.
async function adoptRunningGames() {
  let saved = []
  try {
    saved = JSON.parse(fs.readFileSync(runningGamesPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read the running game record:', error)
    return
  }
  if (!Array.isArray(saved)) return
  const adopted = []
  for (const record of saved) {
    if (!record || typeof record !== 'object') continue
    const { versionId, pid, jarPath, startedAt } = record
    // getVersion throws on an unknown id, and this file is on disk where anything can end up in it.
    if (typeof versionId !== 'string' || !launcherConfig.versions.some(item => item.id === versionId)) continue
    if (!Number.isInteger(pid) || pid <= 1 || typeof jarPath !== 'string') continue
    if (!isProcessAlive(pid) || !isTrackedGameProcess(pid, jarPath)) continue
    const sessionId = `${versionId}:adopted:${pid}`
    if (activeGames.has(sessionId)) continue
    activeGames.set(sessionId, {
      versionId,
      pid,
      jarPath,
      startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
      lastCheckpointAt: Date.now(),
      closeWhenFinished: false,
      child: null,
      adopted: true
    })
    adopted.push(pid)
  }
  if (adopted.length) console.log('Adopted still running game processes:', adopted.join(', '))
  await persistRunningGames()
}

async function checkpointGameSessions() {
  const now = Date.now()
  for (const session of activeGames.values()) {
    // An adopted session's time was already folded into playtime by readGameStats at startup, so
    // counting it again here would bill the same minutes twice.
    if (session.adopted) continue
    const record = gameStats.versions[session.versionId]
    if (!record) continue
    record.playSeconds = Math.max(0, Number(record.playSeconds) || 0) +
      Math.max(0, Math.floor((now - session.lastCheckpointAt) / 1000))
    record.activeSince = now
    session.lastCheckpointAt = now
  }
  if (activeGames.size) await persistGameStats()
  await reapExitedAdoptedGames()
}

// An adopted session has no child handle, so its exit would otherwise never clear the running flag
// and the version card would keep offering Stop for a game that is long gone.
async function reapExitedAdoptedGames() {
  const gone = [...activeGames.entries()]
    .filter(([, session]) => session.adopted && !isTrackedGameProcess(session.pid, session.jarPath))
  if (!gone.length) return
  for (const [sessionId, session] of gone) {
    activeGames.delete(sessionId)
    const record = gameStats.versions[session.versionId]
    if (record) record.activeSince = null
  }
  await persistGameStats()
  await persistRunningGames()
  reportStatusChange()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    for (const [sessionId] of gone) {
      const versionId = sessionId.split(':')[0]
      window.webContents.send('game:exited', { versionId, error: null })
    }
  }
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
  await persistRunningGames()
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
  // A singleplayer entry either ships with another version's files (requires) or is a standalone
  // mod with its own repository; both run their own entryPoint jar instead of AoH2MP.jar.
  if (isSingleplayerVersion(version)) {
    if (version.requires) {
      if (!launcherConfig.versions.some(item => item.id === version.requires)) {
        throw new Error(`Версия ${version.id} требует несуществующую версию ${version.requires}.`)
      }
    } else if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(version.repository || '')) {
      throw new Error('Некорректный репозиторий версии в launcher-config.json.')
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
  const id = isSingleplayerVersion(version) && version.requires ? version.requires : version.id
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
  if (isSingleplayerVersion(version) && version.requires && !isInstalled(version.requires)) return false
  const directory = getVersionDirectory(versionId)
  const marker = version.entryPoint || 'AoH2MP.jar'
  try {
    return fs.statSync(path.join(directory, marker)).isFile()
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

function reportDownload(webContents, data) {
  if (!webContents.isDestroyed()) webContents.send('mod:download-progress', data)
}

// One download at a time per version, so the cancel button always has something to act on and a
// second click cannot start a second copy of the same transfer over the same partial file.
const activeDownloads = new Map()

function getDownloadController(versionId) {
  return activeDownloads.get(versionId) || null
}

ipcMain.handle('mod:cancel-download', (_event, versionId) => {
  const version = getVersion(versionId)
  const controller = getDownloadController(version.id)
  if (!controller) return { cancelled: false }
  controller.abort()
  return { cancelled: true }
})

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
    if (!isSingleplayerVersion(version) && !isInstalled(version.id) && !gameDiscoveryCompleted.has(version.id) &&
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
        stats.installedAt = fs.statSync(path.join(installDirectory, version.entryPoint || 'AoH2MP.jar')).birthtime.toISOString()
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
  if (getDownloadController(version.id)) {
    throw new Error('Эта версия уже скачивается.')
  }

  const versionsDirectory = await ensureVersionsDirectory()
  // The partial archive lives in the user data directory, not in a temp folder: a download that
  // dies on a bad link, or an app that is closed halfway, must not throw away the bytes.
  const downloadDirectory = path.join(app.getPath('userData'), 'downloads')
  const partialPath = path.join(downloadDirectory, `${version.id}-${commit}.zip.part`)
  const metaPath = `${partialPath}.json`
  const archivePath = path.join(downloadDirectory, `${version.id}-${commit}.zip`)
  const archive = version.archive || {}
  const controller = new AbortController()
  activeDownloads.set(version.id, controller)
  let stagingDirectory
  let archiveBytes = 0

  try {
    await fsp.mkdir(versionsDirectory, { recursive: true })
    await fsp.mkdir(downloadDirectory, { recursive: true })
    stagingDirectory = path.join(versionsDirectory, `${version.id}.installing`)
    // Unpacking straight into the staging folder saves a second full copy of several hundred
    // megabytes: the extracted tree is moved into place with a rename instead of being copied.
    await fsp.rm(stagingDirectory, { recursive: true, force: true })
    await fsp.mkdir(stagingDirectory, { recursive: true })

    const archiveUrl = archive.url
      ? String(archive.url).replace('{commit}', commit)
      : `https://codeload.github.com/${version.repository}/zip/${commit}`
    const expectedTotal = Number(archive.bytes) || 0
    if (expectedTotal > MAX_ARCHIVE_BYTES) {
      throw new Error('ARCHIVE_TOO_LARGE')
    }

    const result = await downloadFile({
      url: archiveUrl,
      destination: archivePath,
      partialPath,
      metaPath,
      expectedTotal,
      expectedSha256: archive.sha256 || '',
      signal: controller.signal,
      onProgress: progress => {
        if (progress.received > MAX_ARCHIVE_BYTES) {
          controller.abort()
          return
        }
        reportDownload(event.sender, {
          phase: 'download',
          received: progress.received,
          total: progress.total || expectedTotal,
          speedBytesPerSecond: progress.speedBytesPerSecond,
          attempt: progress.attempt,
          retrying: Boolean(progress.retrying),
          retryInMs: progress.retryInMs || 0,
          resumed: Boolean(progress.resumed)
        })
      }
    })
    archiveBytes = result.bytes
    if (archiveBytes === 0) throw new Error('Сервер загрузки прислал пустой архив.')
    if (archiveBytes > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_TOO_LARGE')

    reportDownload(event.sender, { phase: 'extract', percent: 0, expandedSize: 0, entryCount: 0, completedEntries: 0 })
    let lastExtractProgressAt = 0
    let lastExpandedSize = 0
    await extractModArchive(archivePath, stagingDirectory, progress => {
      const at = Date.now()
      if (progress.percent !== 100 && at - lastExtractProgressAt < 100) return
      lastExtractProgressAt = at
      lastExpandedSize = progress.expandedSize
      reportDownload(event.sender, {
        phase: 'extract',
        percent: progress.percent,
        entryCount: progress.entryCount,
        completedEntries: progress.completedEntries,
        expandedSize: progress.expandedSize
      })
    })

    const extractedEntries = await fsp.readdir(stagingDirectory, { withFileTypes: true })
    const markerJar = version.entryPoint || 'AoH2MP.jar'
    const repositoryRoot = extractedEntries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(stagingDirectory, entry.name))
      .find(candidate => fs.existsSync(path.join(candidate, markerJar)))

    if (!repositoryRoot) {
      throw new Error(`В загруженной версии не найден ${markerJar}.`)
    }

    const destination = getVersionDirectory(version.id)
    const previousDirectory = path.join(versionsDirectory, `${version.id}.previous`)
    await fsp.rm(previousDirectory, { recursive: true, force: true })

    let backupMoved = false
    if (isInstalled(version.id)) {
      await fsp.rename(destination, previousDirectory)
      backupMoved = true
    }
    try {
      await fsp.rename(repositoryRoot, destination)
    } catch (error) {
      if (backupMoved) await fsp.rename(previousDirectory, destination)
      throw error
    }
    await fsp.rm(previousDirectory, { recursive: true, force: true })
    // The repository root wrapper is gone now, so the staging folder is empty and only the
    // leftover files that sat next to it still need clearing.
    await fsp.rm(stagingDirectory, { recursive: true, force: true })
    stagingDirectory = null

    // The archive has served its purpose: a fresh install of the same commit will hit GitHub
    // again, but the games folder never has to hold two copies of it at once.
    await fsp.rm(archivePath, { force: true }).catch(() => {})

    const versionStats = gameStats.versions[version.id] || {}
    versionStats.installedAt = new Date().toISOString()
    gameStats.versions[version.id] = versionStats
    versionCommitOverrides[version.id] = commit
    await persistGameStats()
    await persistVersionCommits()
    reportDownload(event.sender, { phase: 'complete', received: archiveBytes, total: archiveBytes, expandedSize: lastExpandedSize })
    reportStatusChange()
    return {
      installed: true,
      installDirectory: destination,
      commit,
      stats: getVersionStats(version.id)
    }
  } catch (error) {
    if (error instanceof CancelledError || error?.cancelled) {
      reportDownload(event.sender, { phase: 'cancelled', received: fileSize(partialPath) })
      throw new Error('Загрузка отменена.')
    }
    reportDownload(event.sender, { phase: 'error', message: error.message })
    throw error
  } finally {
    activeDownloads.delete(version.id)
    if (stagingDirectory) await fsp.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {})
    // The partial file is deliberately left behind on failure: it is what the next attempt, in
    // this session or in the next one, resumes from. Sweeping only happens for stale parts.
  }
}

ipcMain.handle('mod:download', async (event, payload) => {
  const versionId = typeof payload === 'string' ? payload : payload?.versionId
  const commit = typeof payload === 'string' ? undefined : payload?.commit
  return installVersionFromCommit(event, versionId, commit)
})

// Deletes partial downloads nothing has touched for a week, plus the parts and sidecars of
// versions already installed at the very same commit, so an abandoned download cannot fill the
// disk. Both cases only ever remove resume state: a commit that is already installed will be
// downloaded from scratch again, so nothing is lost, only a stale copy of the bytes.
async function sweepStaleDownloads() {
  let entries
  try {
    entries = await fsp.readdir(downloadsDirectory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    return
  }
  const now = Date.now()
  const installedCommits = new Set()
  for (const version of launcherConfig.versions) {
    if (!isInstalled(version.id)) continue
    const commit = versionCommitOverrides[version.id]
    if (commit) installedCommits.add(`${version.id}-${commit}`)
  }
  // the sidecar "<name>.zip.part.json" belongs to the "<name>.zip.part" next to it
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const name = entry.name.endsWith('.json') ? entry.name.slice(0, -'.json'.length) : entry.name
    if (!name.endsWith('.zip.part')) continue
    const target = path.join(downloadsDirectory, name)
    const obsolete = installedCommits.has(name.slice(0, -'.zip.part'.length))
    let stale = false
    try {
      stale = now - (await fsp.stat(target)).mtimeMs > PARTIAL_MAX_AGE_MS
    } catch (error) {
      if (error.code !== 'ENOENT') continue
      // The part is already gone but its sidecar is not: still obsolete or stale, so still removed.
      try {
        stale = now - (await fsp.stat(`${target}.json`)).mtimeMs > PARTIAL_MAX_AGE_MS
      } catch (sidecarError) {
        stale = false
      }
    }
    if (!obsolete && !stale) continue
    // the sidecar, the partial and any archive left by a run that died mid-install
    await Promise.all([
      fsp.rm(target, { force: true }),
      fsp.rm(`${target}.json`, { force: true }),
      fsp.rm(target.replace(/\.part$/, ''), { force: true })
    ]).catch(() => {})
  }
}

ipcMain.handle('mod:check-updates', async () => {
  const cache = readModUpdateCache()
  if (cache) return cache.versions
  // A burst of parallel checks (startup plus a manual one) shares one set of API requests, and
  // unauthenticated GitHub allows only 60 per hour per address.
  if (!modUpdateInFlight) {
    modUpdateInFlight = (async () => {
      if (Date.now() < modUpdateBlockedUntil) {
        const blocked = readModUpdateCache()
        return blocked ? blocked.versions : emptyUpdateResult()
      }
      const checkable = launcherConfig.versions.filter(version => version.repository)
      const heads = await Promise.all(checkable.map(version => getRepositoryHead(version.repository)))
      const headsById = new Map(checkable.map((version, index) => [version.id, heads[index] || {}]))
      const result = {}
      let rateLimited = false
      launcherConfig.versions.forEach(version => {
        const head = headsById.get(version.id) || {}
        if (head.error === null && !head.sha) rateLimited = true
        result[version.id] = {
          current: getVersionCommit(version) || '',
          latest: head.sha || '',
          date: head.date || null,
          message: head.message || '',
          available: Boolean(head.sha) && /^[a-f0-9]{40}$/i.test(getVersionCommit(version) || '') && head.sha !== getVersionCommit(version),
          error: head.error || null
        }
      })
      // A rate-limited answer is cached like any other: asking again in a minute does not help.
      writeModUpdateCache(result, rateLimited)
      return result
    })().finally(() => {
      modUpdateInFlight = null
    })
  }
  return modUpdateInFlight
})

ipcMain.handle('mod:delete', async (_event, versionId) => {
  const version = getVersion(versionId)
  if (isSingleplayerVersion(version) && version.requires) {
    throw new Error('Эта одиночная версия использует файлы другой версии. Удалите её через основную версию.')
  }
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
  if (!isInstalled(version.id) && !isSingleplayerVersion(version)) await discoverExistingGameDirectory(version.id)
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
    throw new Error('Файл ' + jarName + ' не найден. Переустановите версию.')
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
      'Session type: ' + (process.env.XDG_SESSION_TYPE || 'unknown') + ' (display server decides how the pointer behaves)',
      'Desktop: ' + (process.env.XDG_CURRENT_DESKTOP || 'unknown'),
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
      child: entryChild,
      pid: entryChild.pid,
      jarPath: entryPath
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
    await persistRunningGames()
    reportStatusChange()
    return { started: true, entryPoint: version.entryPoint }
  }

  const logDirectory = path.join(app.getPath('userData'), 'logs')
  const logPath = path.join(logDirectory, `${version.id}-latest.log`)
  await fsp.mkdir(logDirectory, { recursive: true })
  await fsp.writeFile(logPath, [
    `Launch time: ${new Date().toISOString()}`,
    `Java: ${java.executable} (${java.version})`,
    `Session type: ${process.env.XDG_SESSION_TYPE || 'unknown'} (display server decides how the pointer behaves)`,
    `Desktop: ${process.env.XDG_CURRENT_DESKTOP || 'unknown'}`,
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
    child,
    pid: child.pid,
    jarPath
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
  await persistRunningGames()
  reportStatusChange()
  return { started: true, javaVersion: java.version }
  } finally {
    launchingVersions.delete(version.id)
  }
})

// The game runs in its own process group, so the whole group has to be signalled: JVM helpers and
// native LWJGL processes would otherwise survive and keep holding the X11 pointer grab. SIGKILL is
// only a last resort after SIGTERM had its chance, because it gives the game no chance to save.
function signalGameProcess(session, signal) {
  const pid = session.pid
  if (!Number.isInteger(pid) || pid <= 1) return false
  if (process.platform === 'win32') return session.child ? session.child.kill() : false
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    // The group is already gone, or the PID is not a group leader; fall back to the bare process.
    try {
      process.kill(pid, signal)
      return true
    } catch (fallbackError) {
      if (fallbackError.code === 'ESRCH') return false
      throw fallbackError
    }
  }
}

const GAME_STOP_GRACE_MS = 5000

ipcMain.handle('mod:stop', async (_event, versionId) => {
  const version = getVersion(versionId)
  const session = [...activeGames.values()].find(item => item.versionId === version.id)
  if (!session) return { stopping: false }
  if (!signalGameProcess(session, 'SIGTERM')) {
    // Already gone: drop the record so the UI stops offering a Stop button for it.
    await finishGameSession(version.id, [...activeGames.entries()]
      .find(([, item]) => item === session)[0], null).catch(() => {})
    return { stopping: false }
  }
  const sessionId = [...activeGames.entries()].find(([, item]) => item === session)[0]
  // SIGTERM can be ignored by a JVM blocked in native code, which is exactly the case where the
  // pointer grab would otherwise survive and leave the desktop without a mouse until reboot.
  setTimeout(() => {
    if (!activeGames.has(sessionId)) return
    if (!signalGameProcess(session, 'SIGKILL')) return
    finishGameSession(version.id, sessionId, new Error('Игра не завершилась и была остановлена принудительно.'))
      .catch(error => console.error('Could not finish a force-stopped game session:', error))
  }, GAME_STOP_GRACE_MS).unref()
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

app.whenReady().then(async () => {
  readGameLocations()
  readGameStats()
  readVersionCommits()
  // Awaited before the window opens: an orphaned game has to be in the running state before the
  // first status read, otherwise its Stop button never appears and the process stays unreachable.
  await adoptRunningGames().catch(error => console.error('Could not adopt running games:', error))
  // Partial downloads are kept between runs, so the ones nobody has touched for a week have to
  // go or a permanently failing version slowly eats the disk.
  sweepStaleDownloads().catch(error => console.error('Could not sweep stale downloads:', error))
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
