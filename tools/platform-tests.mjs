// Unit tests for the cross-platform helpers in electron/platform.cjs.
//
// The Linux branch cannot be exercised on this Windows host, so the pure logic is tested
// directly: Java version parsing, per-platform discovery inputs, version gating and the
// manual install command the updater hands to the user.
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const platform = require('../electron/platform.cjs')

let failures = 0
let checks = 0
const check = (label, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}\n`)
}
const eq = (label, actual, expected) =>
  check(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}`)

process.stdout.write('\nexported surface\n')
for (const name of [
  'IS_WINDOWS', 'IS_MAC', 'IS_LINUX', 'PACKAGE_NAME', 'UPDATER_ARTIFACT', 'MIN_JAVA_MAJOR',
  'platformId', 'platformLabel', 'updaterCanSelfInstall', 'updaterInstallCommand',
  'isVersionSupported', 'unsupportedLabel', 'unsupportedMessage',
  'javaBinaryNames', 'javaHomeCandidates', 'registryJavaHomes', 'pathJavaCandidates',
  'parseJavaVersion', 'probeJava', 'collectJavaExecutables', 'findJavaExecutable', 'describePlatform'
]) {
  check(`exports ${name}`, typeof platform[name] !== 'undefined')
}

process.stdout.write('\nruntime identity\n')
check('exactly one platform is active', [platform.IS_WINDOWS, platform.IS_MAC, platform.IS_LINUX].filter(Boolean).length === 1)
eq('platformId matches the host', platform.platformId(), process.platform)
check('platformLabel is human readable', ['Windows', 'macOS', 'Linux'].includes(platform.platformLabel()), platform.platformLabel())
eq('updater artifact matches the host', platform.UPDATER_ARTIFACT, platform.IS_WINDOWS
  ? 'AOC-2-Multiplayer-Setup.exe'
  : 'AOC-2-Multiplayer-linux-x64.deb')
check('updater can self-install only where a double click works', platform.updaterCanSelfInstall() === (platform.IS_WINDOWS || platform.IS_MAC), String(platform.updaterCanSelfInstall()))
const described = platform.describePlatform()
eq('describePlatform id', described.id, platform.platformId())
eq('describePlatform label', described.label, platform.platformLabel())
eq('describePlatform updater artifact', described.updaterArtifact, platform.UPDATER_ARTIFACT)
eq('describePlatform self-install flag', described.updaterCanSelfInstall, platform.updaterCanSelfInstall())
check('describePlatform reports whether the games dir is user writable', typeof described.gamesDirectoryIsUserWritable === 'boolean', String(described.gamesDirectoryIsUserWritable))
check('only Linux/mac get a writable games dir', described.gamesDirectoryIsUserWritable === !platform.IS_WINDOWS)

process.stdout.write('\nparseJavaVersion\n')
const cases = [
  ['java version "17.0.12" 2024-07-16 LTS', 17],
  ['openjdk version "21.0.2" 2024-01-16', 21],
  ['openjdk version "26.0.2.1" 2026-08-18', 26],
  ['java version "1.8.0_503"', 1],
  ['openjdk 21.0.2 2024-01-16', 21],
  ['17', 17],
  ['11.0.20', 11]
]
for (const [input, major] of cases) {
  const parsed = platform.parseJavaVersion(input)
  check(`parses ${JSON.stringify(input)}`, parsed && parsed.major === major, JSON.stringify(parsed))
}
eq('minor is parsed', platform.parseJavaVersion('openjdk version "17.0.12"').minor, 0)
for (const bad of ['', 'not a version', 'abc.def', 'version ""']) {
  check(`rejects ${JSON.stringify(bad)}`, platform.parseJavaVersion(bad) === null, JSON.stringify(platform.parseJavaVersion(bad)))
}

process.stdout.write('\nversion gating\n')
const windowsOnly = { id: 'sp', entryPoint: 'some-windows-only.jar', platforms: ['win32'] }
const anyPlatform = { id: 'mp', entryPoint: 'game.jar' }
const linuxList = { id: 'x', platforms: ['linux'] }
eq('a version without platforms is allowed', platform.isVersionSupported(anyPlatform), true)
eq('a missing version is allowed', platform.isVersionSupported(undefined), true)
eq('a version with an empty platform list is allowed', platform.isVersionSupported({ platforms: [] }), true)
eq('a win32 version follows the host', platform.isVersionSupported(windowsOnly), platform.IS_WINDOWS)
eq('a linux-only version follows the host', platform.isVersionSupported(linuxList), platform.IS_LINUX)
check('a multi-platform version lists every platform', platform.isVersionSupported({ platforms: ['win32', 'linux', 'darwin'] }) === true)

process.stdout.write('\nunsupported reporting\n')
eq('no label for a supported-anywhere version', platform.unsupportedLabel(anyPlatform), '')
eq('no label for a missing version', platform.unsupportedLabel(undefined), '')
eq('win32 label is human readable', platform.unsupportedLabel(windowsOnly), 'Windows')
eq('multiple platforms are joined', platform.unsupportedLabel({ platforms: ['win32', 'linux'] }), 'Windows / Linux')
const message = platform.unsupportedMessage(windowsOnly, platform.platformLabel())
check('message names the version', message.includes('«Bloody Europe»') || message.includes('«Эта версия»'), message)
check('message states the required platform', /запускается только на Windows/.test(message), message)
check('message states the current platform', message.includes(platform.platformLabel()), message)

process.stdout.write('\njava discovery inputs\n')
const binaries = platform.javaBinaryNames()
check('java binary name matches the host', platform.IS_WINDOWS ? binaries.includes('java.exe') : binaries.includes('java'), binaries.join(', '))
check('java discovery never returns an empty list', binaries.length > 0)
const registry = platform.registryJavaHomes()
check('registry keys are only queried on Windows', registry.length === 0 || platform.IS_WINDOWS, `${registry.length} keys`)
const homeCandidates = platform.javaHomeCandidates().filter(Boolean)
check('java home candidates are absolute paths', homeCandidates.every(candidate => path.isAbsolute(candidate)), homeCandidates.slice(0, 3).join(', '))
check('java home candidates are de-duplicated', new Set(homeCandidates).size === homeCandidates.length)
if (platform.IS_LINUX) {
  check('Linux looks in /usr/lib/jvm', homeCandidates.some(candidate => candidate.includes(path.join('usr', 'lib', 'jvm'))), homeCandidates.length + ' candidates')
} else {
  check('non-Linux hosts do not probe /usr/lib/jvm', !homeCandidates.some(candidate => candidate.includes(path.join('usr', 'lib', 'jvm'))))
}
const pathCandidates = platform.pathJavaCandidates()
check('PATH candidates are absolute', pathCandidates.every(candidate => path.isAbsolute(candidate)))
check('PATH candidates end with a java executable', pathCandidates.every(candidate => binaries.includes(path.basename(candidate))))
const collected = platform.collectJavaExecutables()
check('collectJavaExecutables returns unique absolute paths', new Set(collected).size === collected.length && collected.every(candidate => path.isAbsolute(candidate)))

process.stdout.write('\njava probing\n')
check('probing a missing executable returns null', platform.probeJava(path.join(process.cwd(), 'no-such-java-binary')) === null)
const probed = platform.collectJavaExecutables().find(candidate => platform.probeJava(candidate))
if (probed) {
  const version = platform.probeJava(probed)
  check('a real java on this host probes successfully', Boolean(version) && version.major >= 1, `${probed} -> ${JSON.stringify(version)}`)
} else {
  process.stdout.write('  skip  no java on this host to probe\n')
}

process.stdout.write('\nupdater install command\n')
const command = platform.updaterInstallCommand('AOC-2-Multiplayer-linux-x64.deb')
check('install command always uses sudo apt with a relative path', /^sudo apt install \.\/\S+\.deb$/.test(command), command)
check('install command embeds the given file name', command.includes('AOC-2-Multiplayer-linux-x64.deb'), command)

process.stdout.write(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks\n`)
if (failures) process.exitCode = 1
