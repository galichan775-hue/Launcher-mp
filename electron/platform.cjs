const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

const PACKAGE_NAME = 'aoc-2-multiplayer'
const UPDATER_ARTIFACT = IS_WINDOWS
  ? 'AOC-2-Multiplayer-Setup.exe'
  : 'AOC-2-Multiplayer-linux-x64.deb'
const MIN_JAVA_MAJOR = 17
const PREFERRED_JAVA_MAJOR = 17
const JAVA_VERSION_TIMEOUT = 5000

function platformId() {
  return IS_WINDOWS ? 'win32' : IS_MAC ? 'darwin' : 'linux'
}

function platformLabel() {
  return IS_WINDOWS ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'
}

// A .deb can only be installed with root privileges, so on Linux the updater downloads the
// package and hands the user the command instead of silently launching an installer.
function updaterCanSelfInstall() {
  return IS_WINDOWS || IS_MAC
}

function updaterInstallCommand(fileName) {
  return `sudo apt install ./${fileName}`
}

function isVersionSupported(version) {
  if (!version || !Array.isArray(version.platforms) || !version.platforms.length) return true
  return version.platforms.includes(platformId())
}

function unsupportedLabel(version) {
  if (!version || !Array.isArray(version.platforms) || !version.platforms.length) return ''
  return version.platforms.map(id => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[id] || id).join(' / ')
}

function unsupportedMessage(version, label) {
  const name = version?.name || 'Эта версия'
  const required = unsupportedLabel(version)
  return `«${name}» запускается только на ${required}. На ${label} этот мод недоступен — используйте мультиплеерные версии.`
}

function javaBinaryNames() {
  return IS_WINDOWS ? ['java.exe', 'javaw.exe'] : ['java']
}

// javaw.exe has no console; the launcher wants the console build so the log is captured.
function consoleJavaSibling(executable) {
  if (!IS_WINDOWS) return executable
  if (path.basename(executable).toLowerCase() !== 'javaw.exe') return executable
  const sibling = path.join(path.dirname(executable), 'java.exe')
  return fs.existsSync(sibling) ? sibling : executable
}

function javaHomeCandidates() {
  const homes = []
  const addHome = home => {
    if (typeof home === 'string' && home.trim()) {
      const resolved = home.trim()
      if (!homes.includes(resolved)) homes.push(resolved)
    }
  }
  const addChildrenOf = directory => {
    if (!directory) return
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES') return
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      addHome(path.join(directory, entry.name))
      if (IS_MAC) addHome(path.join(directory, entry.name, 'Contents', 'Home'))
    }
  }

  addHome(process.env.JAVA_HOME)
  const userHome = os.homedir()
  addChildrenOf(path.join(userHome, '.jdks'))
  addChildrenOf(path.join(userHome, '.sdkman', 'candidates', 'java'))

  if (IS_WINDOWS) {
    const programRoots = [
      process.env.ProgramW6432,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')
    ].filter(Boolean)
    for (const root of programRoots) {
      for (const vendor of ['Eclipse Adoptium', 'Java', 'Microsoft', 'Amazon Corretto', 'Zulu']) {
        addChildrenOf(path.join(root, vendor))
      }
    }
    for (const javaHome of [
      process.env.ProgramData && path.join(process.env.ProgramData, 'Oracle', 'Java'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Common Files', 'Oracle', 'Java', 'javapath'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Common Files', 'Oracle', 'Java', 'javapath'),
      'C:\\Java'
    ].filter(Boolean)) {
      addHome(javaHome)
      addChildrenOf(javaHome)
    }
  }

  if (IS_LINUX) {
    for (const root of ['/usr/lib/jvm', '/usr/java', '/opt/java', '/usr/local/java', '/snap/bin']) {
      addChildrenOf(root)
    }
  }

  if (IS_MAC) {
    addChildrenOf('/Library/Java/JavaVirtualMachines')
    addChildrenOf(path.join(userHome, 'Library', 'Java', 'JavaVirtualMachines'))
  }

  return homes
}

function registryJavaHomes() {
  if (!IS_WINDOWS) return []
  const homes = []
  const query = (key, extra) => {
    const result = spawnSync('reg.exe', ['query', key, '/s', ...(extra || [])], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: JAVA_VERSION_TIMEOUT,
      maxBuffer: 1024 * 1024
    })
    if (result.error && result.error.code !== 'ENOENT') return ''
    return result.stdout || ''
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
    for (const match of query(key).matchAll(/JavaHome\s+REG_(?:EXPAND_)?SZ\s+(.+)/gi)) {
      if (match[1].trim()) homes.push(match[1].trim())
    }
  }
  for (const key of [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]) {
    for (const match of query(key, ['/f', 'Java 17']).matchAll(/InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+)/gi)) {
      if (match[1].trim()) homes.push(match[1].trim())
    }
  }
  return homes
}

// Scanning PATH is enough on every platform and avoids depending on where.exe/which.
function pathJavaCandidates() {
  const found = []
  const separator = IS_WINDOWS ? ';' : ':'
  const names = javaBinaryNames()
  for (const directory of (process.env.PATH || '').split(separator)) {
    if (!directory) continue
    for (const name of names) {
      const candidate = path.join(directory, name)
      if (!found.includes(candidate)) found.push(candidate)
    }
  }
  return found
}

function parseJavaVersion(output) {
  const text = String(output)
  let best = null
  const consider = (rawMajor, rawMinor) => {
    const major = Number(rawMajor)
    if (!Number.isFinite(major) || major < 1) return
    if (!best || major > best.major) best = { major, minor: Number(rawMinor) || 0 }
  }
  for (const match of text.matchAll(/version\s+"?(\d+)(?:\.(\d+))?/gi)) consider(match[1], match[2])
  if (best) return best
  // Early-access and some vendor builds omit the keyword, e.g. `openjdk 11-ea` or
  // `openjdk 21.0.2 2024-01-16`. The major is capped at two digits so a date that follows
  // the version is never mistaken for the version itself.
  for (const match of text.matchAll(/(?:^|[\s"'`=])(\d{1,2})(?:\.(\d{1,3}))?\b/g)) consider(match[1], match[2])
  return best
}

function probeJava(executable) {
  const result = spawnSync(executable, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: JAVA_VERSION_TIMEOUT
  })
  if (result.error) {
    if (result.error.code === 'ENOENT' || result.error.code === 'ETIMEDOUT') return null
    return null
  }
  if (result.status !== 0) return null
  const parsed = parseJavaVersion(`${result.stdout || ''}\n${result.stderr || ''}`)
  if (!parsed) return null
  return parsed
}

function collectJavaExecutables() {
  const executables = new Set()
  const add = candidate => {
    if (typeof candidate === 'string' && candidate.trim()) executables.add(path.resolve(candidate.trim()))
  }
  const names = javaBinaryNames()
  for (const home of [...registryJavaHomes(), ...javaHomeCandidates()]) {
    for (const name of names) add(path.join(home, 'bin', name))
  }
  for (const candidate of pathJavaCandidates()) add(candidate)
  return [...executables]
}

function findJavaExecutable() {
  let compatible = null
  const checked = new Set()
  for (const candidate of collectJavaExecutables()) {
    const consoleBinary = consoleJavaSibling(candidate)
    if (checked.has(consoleBinary)) continue
    if (!fs.existsSync(consoleBinary)) continue
    checked.add(consoleBinary)
    const version = probeJava(consoleBinary)
    if (!version || version.major < MIN_JAVA_MAJOR) continue
    const found = { executable: consoleBinary, version: `${version.major}.${version.minor}` }
    if (version.major === PREFERRED_JAVA_MAJOR) return found
    if (!compatible) compatible = found
  }
  return compatible
}

function describePlatform() {
  return {
    id: platformId(),
    label: platformLabel(),
    isWindows: IS_WINDOWS,
    isLinux: IS_LINUX,
    isMac: IS_MAC,
    // /opt and /Applications are not writable by a normal user, so mods go to userData there.
    gamesDirectoryIsUserWritable: !IS_WINDOWS,
    updaterArtifact: UPDATER_ARTIFACT,
    updaterCanSelfInstall: updaterCanSelfInstall()
  }
}

module.exports = {
  IS_WINDOWS,
  IS_MAC,
  IS_LINUX,
  PACKAGE_NAME,
  UPDATER_ARTIFACT,
  MIN_JAVA_MAJOR,
  platformId,
  platformLabel,
  updaterCanSelfInstall,
  updaterInstallCommand,
  isVersionSupported,
  unsupportedLabel,
  unsupportedMessage,
  javaBinaryNames,
  javaHomeCandidates,
  registryJavaHomes,
  pathJavaCandidates,
  parseJavaVersion,
  probeJava,
  collectJavaExecutables,
  findJavaExecutable,
  describePlatform
}
