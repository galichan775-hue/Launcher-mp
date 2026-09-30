// Structural verification of AOC-2-Multiplayer-linux-x64.deb.
//
// There is no dpkg or Linux machine on this host, so the checks below reproduce what dpkg
// cares about: a well formed ar container, a readable control archive with correct metadata,
// a data archive whose ownership, modes, symlinks and checksums are valid, and an app.asar
// that actually contains the cross-platform modules.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import nodePath from 'node:path'
import { spawnSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEB = path.join(ROOT, 'dist', 'AOC-2-Multiplayer-linux-x64.deb')
const WORK = path.join(ROOT, 'build', 'verify')

let failures = 0
let checks = 0
const check = (label, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}\n`)
}

// ---------------------------------------------------------------- ar parsing

const AR_MAGIC = '!<arch>\n'
const AR_FIELDS = [
  ['name', 0, 16],
  ['mtime', 16, 12],
  ['uid', 28, 6],
  ['gid', 34, 6],
  ['mode', 40, 8],
  ['size', 48, 10]
]

function parseAr(buffer) {
  // Without this magic apt reports "invalid archive signature" and then cannot find control.tar,
  // so it has to be asserted instead of assumed.
  if (buffer.length < 8 || buffer.toString('latin1', 0, 8) !== AR_MAGIC) {
    throw new Error(`ar archive must start with ${JSON.stringify(AR_MAGIC)}, found ${JSON.stringify(buffer.toString('latin1', 0, 8))}`)
  }
  const members = []
  let offset = 8
  while (offset + 60 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 60)
    const field = {}
    for (const [label, start, width] of AR_FIELDS) {
      const value = header.toString('latin1', start, start + width)
      // dpkg pads every field with spaces. Buffer.write zero-pads a value that is shorter than the
      // field width, and a NUL there is exactly what makes a package unreadable.
      if (!/^[\x20-\x7e]+$/.test(value)) {
        throw new Error(`ar ${label} field of member ${members.length + 1} is not printable ASCII: ${JSON.stringify(value)}`)
      }
      field[label] = value.trim()
    }
    const name = field.name.replace(/\/$/, '')
    const magic = header.toString('latin1', 58, 60)
    if (magic !== '`\n') throw new Error(`bad ar magic after member ${name}: ${JSON.stringify(magic)}`)
    const size = Number.parseInt(field.size, 10)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`bad ar size for ${name}: ${JSON.stringify(field.size)}`)
    }
    const start = offset + 60
    if (start + size > buffer.length) {
      throw new Error(`ar member ${name} claims ${size} bytes but the archive ends first`)
    }
    members.push({ name, size, data: buffer.subarray(start, start + size) })
    offset = start + size + (size % 2)
  }
  if (offset !== buffer.length) {
    throw new Error(`ar archive has ${buffer.length - offset} unexpected trailing bytes`)
  }
  return members
}

// ---------------------------------------------------------------- tar parsing

function parseTar(buffer) {
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const readField = (start, length) => {
      const raw = header.subarray(start, start + length)
      const text = raw.toString('utf8').replace(/\0.*$/, '').trim()
      return text
    }
    const name = readField(0, 100)
    const mode = parseInt(readField(100, 8), 8)
    const uid = parseInt(readField(108, 8), 8)
    const gid = parseInt(readField(116, 8), 8)
    const size = parseInt(readField(124, 12), 8)
    const mtime = parseInt(readField(136, 12), 8)
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const linkTarget = readField(157, 100)
    const magic = header.subarray(257, 262).toString('ascii')
    const uname = readField(265, 32)
    const gname = readField(297, 32)
    // verify the header checksum the same way tar and dpkg do
    const withSpaces = Buffer.from(header)
    withSpaces.write('        ', 148, 8, 'ascii')
    let sum = 0
    for (const byte of withSpaces) sum += byte
    const stored = parseInt(header.subarray(148, 156).toString('ascii').replace(/[\0 ]/g, ''), 8)
    const start = offset + 512
    const data = type === '0' ? buffer.subarray(start, start + size) : Buffer.alloc(0)
    entries.push({ name, mode, uid, gid, mtime, type, linkTarget, magic, uname, gname, size, data, checksumOk: sum === stored })
    offset = start + Math.ceil(size / 512) * 512
  }
  return entries
}

function decompressXz(buffer) {
  const result = spawnSync('python', [path.join(ROOT, 'tools', 'xz-decompress.py')], {
    input: buffer,
    maxBuffer: Number.MAX_SAFE_INTEGER
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`xz-decompress.py failed: ${result.stderr}`)
  return result.stdout
}

// ---------------------------------------------------------------- checks

async function main() {
  await fsp.rm(WORK, { recursive: true, force: true })
  await fsp.mkdir(WORK, { recursive: true })

  const deb = fs.readFileSync(DEB)
  process.stdout.write(`\n${path.basename(DEB)}: ${deb.length.toLocaleString()} bytes\n`)

  process.stdout.write('\nar container\n')
  const members = parseAr(deb)
  check('has exactly debian-binary, control and data members', members.length === 3, members.map(m => m.name).join(', '))
  check('first member is debian-binary', members[0]?.name === 'debian-binary')
  check('debian-binary says 2.0', members[0]?.data.toString('utf8') === '2.0\n', JSON.stringify(members[0]?.data.toString('utf8')))
  const controlMember = members.find(member => member.name.startsWith('control.tar.'))
  const dataMember = members.find(member => member.name.startsWith('data.tar.'))
  check('control member present', Boolean(controlMember), controlMember?.name)
  check('data member present', Boolean(dataMember), dataMember?.name)
  check('members use a compression dpkg understands', ['.gz', '.xz'].includes(controlMember?.name.slice(-3)), controlMember?.name.slice(-3))

  // Our own parseAr was originally written to match our own writer, so a container we mis-assembled
  // passed verification and apt refused to install it. libarchive is an independent reader, which is
  // exactly the oracle that was missing.
  let oracle = null
  for (const candidate of ['tar', 'bsdtar']) {
    const probe = spawnSync(candidate, ['-tf', DEB], { encoding: 'utf8' })
    if (probe.error) continue
    if (probe.status !== 0) {
      check(`libarchive (${candidate}) can read the ar container`, false, (probe.stderr || '').trim())
      throw new Error('an independent ar reader rejects the package, apt would refuse it too')
    }
    oracle = { tool: candidate, names: probe.stdout.split(/\r?\n/).filter(Boolean) }
    break
  }
  if (oracle) {
    check(`libarchive (${oracle.tool}) reads the ar container`, true, oracle.names.join(', '))
    check('libarchive sees the same three members', oracle.names.join(', ') === members.map(member => member.name).join(', '), oracle.names.join(', '))
  } else {
    process.stdout.write('  NOTE: no tar or bsdtar on this machine, skipped the independent ar reader check\n')
  }

  process.stdout.write('\nxz members decode\n')
  const controlTar = controlMember.name.endsWith('.xz')
    ? decompressXz(controlMember.data)
    : zlib.gunzipSync(controlMember.data)
  const dataTar = dataMember.name.endsWith('.xz')
    ? decompressXz(dataMember.data)
    : zlib.gunzipSync(dataMember.data)
  check('control archive decodes', controlTar.length > 0, `${controlTar.length} bytes`)
  check('data archive decodes', dataTar.length > 0, `${dataTar.length} bytes`)
  check('archives end on the two zero blocks', dataTar.subarray(-1024).every(byte => byte === 0))

  process.stdout.write('\ncontrol archive\n')
  const controlEntries = parseTar(controlTar)
  const byName = name => controlEntries.find(entry => entry.name === name)
  const control = byName('./control')?.data.toString('utf8') || ''
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const expected = {
    Package: manifest.build.deb.packageName,
    Version: manifest.version,
    Architecture: 'amd64',
    Maintainer: manifest.build.linux.maintainer,
    Section: manifest.build.deb.packageCategory,
    Priority: manifest.build.deb.priority
  }
  for (const [field, value] of Object.entries(expected)) {
    const line = control.split('\n').find(item => item.startsWith(`${field}:`))
    check(`control ${field}`, line === `${field}: ${value}`, line)
  }
  const depends = control.split('\n').find(item => item.startsWith('Depends:'))?.slice('Depends:'.length).trim().split(', ') || []
  check('control Depends matches package.json', depends.join(',') === manifest.build.deb.depends.join(','), `${depends.length} packages`)
  check('control declares Installed-Size', /Installed-Size: \d+/.test(control), control.match(/Installed-Size: \d+/)?.[0])
  check('control has a multi-line Description', /^Description: .+\n .+/m.test(control))
  check('postinst is present and executable', byName('./postinst')?.mode === 0o755, `mode ${byName('./postinst')?.mode?.toString(8)}`)
  check('md5sums is present', Boolean(byName('./md5sums')?.data.length))
  check('control entries all have valid checksums', controlEntries.every(entry => entry.checksumOk))
  check('control entries are ustar', controlEntries.every(entry => entry.magic === 'ustar'))

  const md5sums = (byName('./md5sums')?.data.toString('utf8') || '')
    .split('\n').filter(Boolean).map(line => {
      const [hash, ...rest] = line.split(/\s+/)
      return { hash, file: rest.join(' ') }
    })

  process.stdout.write('\ndata archive\n')
  const entries = parseTar(dataTar)
  const files = entries.filter(entry => entry.type === '0')
  const dirs = entries.filter(entry => entry.type === '5')
  const links = entries.filter(entry => entry.type === '2')
  check('all entries have valid checksums', entries.every(entry => entry.checksumOk))
  check('all entries are ustar', entries.every(entry => entry.magic === 'ustar'))
  check('everything is owned by root:root', entries.every(entry => entry.uid === 0 && entry.gid === 0 && entry.uname === 'root' && entry.gname === 'root'))
  check('no path escapes the archive root', entries.every(entry => !entry.name.replace(/^\.\//, '').split('/').includes('..')))
  check('directories are 0755', dirs.every(entry => entry.mode === 0o755))
  // Windows hands out 0666, so the builder has to normalise modes itself
  const asOctal = entry => (entry.mode & 0o7777).toString(8).padStart(4, '0')
  const writable = files.filter(entry => entry.mode & 0o022)
  check('no packaged file is group- or world-writable', writable.length === 0, writable.slice(0, 4).map(entry => `${entry.name} ${asOctal(entry)}`).join(', '))
  const oddModes = files.filter(entry => ![0o644, 0o755, 0o4755].includes(entry.mode))
  check('regular files use 0644, 0755 or 4755 only', oddModes.length === 0, oddModes.slice(0, 4).map(entry => `${entry.name} ${asOctal(entry)}`).join(', '))
  const setuid = files.filter(entry => entry.mode & 0o4000)
  check('only chrome-sandbox is setuid', setuid.length === 1 && setuid[0].name === './opt/aoc-2-multiplayer/chrome-sandbox', setuid.map(entry => entry.name).join(', '))
  // dpkg must never have to invent a parent directory, because it would take the mode from umask
  const dirNames = new Set(dirs.map(entry => entry.name))
  const missingParents = new Set()
  for (const entry of [...files, ...dirs, ...links]) {
    let parent = nodePath.posix.dirname(entry.name)
    while (parent && parent !== '.' && parent !== '/') {
      if (dirNames.has(parent)) break
      missingParents.add(parent)
      parent = nodePath.posix.dirname(parent)
    }
  }
  check('every parent directory is an explicit entry', missingParents.size === 0, [...missingParents].join(', '))

  const find = name => entries.find(entry => entry.name === name)
  const runtime = find('./opt/aoc-2-multiplayer/aoc-2-multiplayer')
  check('runtime binary is present', Boolean(runtime), runtime ? `${(runtime.size / 1024 / 1024).toFixed(1)} MB` : 'missing')
  check('runtime binary is 0755', runtime?.mode === 0o755, runtime?.mode?.toString(8))
  const sandbox = find('./opt/aoc-2-multiplayer/chrome-sandbox')
  check('chrome-sandbox is setuid 4755', sandbox?.mode === 0o4755, sandbox?.mode?.toString(8))
  check('app.asar is shipped', Boolean(find('./opt/aoc-2-multiplayer/resources/app.asar')))
  check('default_app.asar is removed', !find('./opt/aoc-2-multiplayer/resources/default_app.asar'))
  check('electron runtime version marker is present', Boolean(find('./opt/aoc-2-multiplayer/version')))
  check('en-US locale is kept', Boolean(find('./opt/aoc-2-multiplayer/locales/en-US.pak')))
  check('ru locale is kept', Boolean(find('./opt/aoc-2-multiplayer/locales/ru.pak')))
  check('other locales are pruned', entries.filter(entry => /\/locales\/.*\.pak$/.test(entry.name)).length === 2)

  process.stdout.write('\ndesktop integration\n')
  const binLink = find('./usr/bin/aoc-2-multiplayer')
  check('/usr/bin entry is a symlink', binLink?.type === '2')
  check('symlink points into /opt', binLink?.linkTarget === '/opt/aoc-2-multiplayer/aoc-2-multiplayer', binLink?.linkTarget)
  const desktop = find('./usr/share/applications/aoc-2-multiplayer.desktop')?.data.toString('utf8') || ''
  check('desktop entry present', desktop.startsWith('[Desktop Entry]'))
  check('desktop Exec matches the symlink', desktop.includes('Exec=/usr/bin/aoc-2-multiplayer'))
  check('desktop Icon matches the installed icon name', desktop.includes('Icon=aoc-2-multiplayer'))
  check('desktop entry is 0644', find('./usr/share/applications/aoc-2-multiplayer.desktop')?.mode === 0o644)
  check('desktop file has no duplicate keys', new Set(desktop.split('\n').filter(line => line.includes('=')).map(line => line.split('=')[0])).size === desktop.split('\n').filter(line => line.includes('=')).length)
  const installedIcons = entries.filter(entry => /^\.\/usr\/share\/icons\/hicolor\/\d+x\d+\/apps\/aoc-2-multiplayer\.png$/.test(entry.name))
  check('hicolor icon set installed', installedIcons.length >= 6, `${installedIcons.length} sizes: ${installedIcons.map(entry => entry.name.match(/\/(\d+x\d+)\//)[1]).join(' ')}`)
  check('copyright file is shipped', Boolean(find('./usr/share/doc/aoc-2-multiplayer/copyright')))
  check('Debian changelog is shipped', Boolean(find('./usr/share/doc/aoc-2-multiplayer/changelog.Debian.gz')))

  process.stdout.write('\nmd5sums\n')
  check('md5sums covers every regular file', md5sums.length === files.length, `${md5sums.length} listed vs ${files.length} packaged`)
  const listed = new Set(md5sums.map(item => item.file))
  const packaged = new Set(files.map(entry => entry.name.replace(/^\.\//, '')))
  check('md5sums paths match packaged paths', [...packaged].every(file => listed.has(file)))
  const badHash = md5sums.find(item => {
    const entry = entries.find(candidate => candidate.name === `./${item.file}`)
    return entry && crypto.createHash('md5').update(entry.data).digest('hex') !== item.hash
  })
  check('every md5sum matches its file contents', !badHash, badHash?.file)

  process.stdout.write('\napp.asar contents\n')
  const asarTarget = path.join(WORK, 'app.asar')
  await fsp.writeFile(asarTarget, find('./opt/aoc-2-multiplayer/resources/app.asar').data)
  // listPackage reports native separators, so the paths are normalised before comparing
  const list = asar.listPackage(asarTarget).map(entry => entry.replace(/\\/g, '/'))
  for (const required of ['/electron/main.cjs', '/electron/platform.cjs', '/electron/preload.cjs', '/app/renderer.js', '/app/index.html', '/app/styles.css', '/app/launcher-config.json', '/package.json']) {
    check(`asar contains ${required}`, list.includes(required))
  }
  const packedManifest = JSON.parse(asar.extractFile(asarTarget, 'package.json').toString('utf8'))
  check('asar package.json version matches', packedManifest.version === manifest.version, packedManifest.version)
  const packedPlatform = asar.extractFile(asarTarget, 'electron/platform.cjs').toString('utf8')
  check('asar platform.cjs exports the unsupported helpers', /unsupportedMessage,?\s*\n/.test(packedPlatform) && /unsupportedLabel/.test(packedPlatform))
  const packedMain = asar.extractFile(asarTarget, 'electron/main.cjs').toString('utf8')
  check('asar main.cjs no longer probes the Windows registry', !/reg\.exe/.test(packedMain) && /platform\.findJavaExecutable/.test(packedMain))

  process.stdout.write('\nproduction dependencies\n')
  for (const name of Object.keys(manifest.dependencies || {})) {
    check(`asar ships ${name}`, list.includes(`/node_modules/${name}/package.json`))
  }
  // every bare require in the shipped main process must resolve inside the asar, otherwise the
  // launcher throws on startup before the window ever appears. node: prefixes and electron
  // itself are provided by the runtime rather than the archive.
  const provided = new Set([...builtinModules, 'electron', 'electron/main'])
  const missing = new Set()
  for (const file of ['electron/main.cjs', 'electron/platform.cjs', 'electron/preload.cjs']) {
    const source = asar.extractFile(asarTarget, file).toString('utf8')
    for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue
      if (provided.has(specifier)) continue
      if (!list.some(entry => entry === `/node_modules/${specifier}` || entry.startsWith(`/node_modules/${specifier}/`))) {
        missing.add(`${file} -> ${specifier}`)
      }
    }
  }
  check('every require in the main process resolves inside the asar', missing.size === 0, [...missing].join('; '))

  process.stdout.write('\nlinux code paths\n')
  const preload = asar.extractFile(asarTarget, 'electron/preload.cjs').toString('utf8')
  check('preload exposes revealFile to the renderer', /revealFile:\s*\(?\s*filePath\s*\)?\s*=>/.test(preload))
  const launcherConfig = JSON.parse(asar.extractFile(asarTarget, 'app/launcher-config.json').toString('utf8'))
  const windowsOnly = launcherConfig.versions.filter(version => Array.isArray(version.platforms) && !version.platforms.includes('linux'))
  check('the shipped config gates no version on Windows only', windowsOnly.length === 0, windowsOnly.map(v => v.entryPoint).join(', '))
  const singleplayerEntry = launcherConfig.versions.find(version => version.id === 'bloody-europe')
  check('singleplayer launches its jar, not the windows exe', singleplayerEntry?.entryPoint === 'BE2.jar', String(singleplayerEntry?.entryPoint))
  const main = asar.extractFile(asarTarget, 'electron/main.cjs').toString('utf8')
  check('every launch goes through java -jar', !/spawn\(entryPath, \[\]/.test(main) && /spawn\(java\.executable, \['-jar', entryPath\]/.test(main))
  const renderer = asar.extractFile(asarTarget, 'app/renderer.js').toString('utf8')
  check('renderer knows the manual .deb install flow', /startupUpdateManualText/.test(renderer) && /result\.installCommand/.test(renderer))
  check('renderer renders the platform badge', /platform-badge/.test(renderer))
  const styles = asar.extractFile(asarTarget, 'app/styles.css').toString('utf8')
  check('styles include a Linux font fallback', /DejaVu Sans/.test(styles))
  check('styles style the manual install block', /\.startup-update-manual/.test(styles) && /\.platform-badge/.test(styles))

  process.stdout.write(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks\n`)
  if (failures) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`\nverify-deb failed: ${error.stack || error.message}\n`)
  process.exitCode = 1
})
