// Builds AOC-2-Multiplayer-linux-x64.deb without Docker, WSL or fpm.
//
// electron-builder can only produce a .deb through its Linux Docker image, because fpm has
// to run as root to stamp correct ownership and modes. This script writes the Debian archive
// format directly: debian-binary + control.tar.xz + data.tar.xz wrapped in an ar container.
//
// Two adjustments keep the artifact inside the 100 MB GitHub raw file limit:
//   * unused locale files are pruned, keeping only en-US and ru
//   * the tarball is xz compressed, which needs a helper because Windows ships no xz encoder
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yauzl = require('yauzl')
const asar = require('@electron/asar')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = path.join(ROOT, 'build')
const CACHE = path.join(BUILD, 'cache')
const STAGE = path.join(BUILD, 'linux-unpacked')
const ASAR_STAGE = path.join(BUILD, 'asar-staging')
const WORK = path.join(BUILD, 'deb-work')
const DEB_DIR = path.join(ROOT, 'dist')
const ARTIFACT = 'AOC-2-Multiplayer-linux-x64.deb'

const PACKAGE_NAME = 'aoc-2-multiplayer'
const EXECUTABLE = 'aoc-2-multiplayer'
const OPT_DIR = `/opt/${PACKAGE_NAME}`
// tar names are relative to the archive root, so they need a "." and not a second slash
const inOpt = name => `.${OPT_DIR}/${name}`
const KEEP_LOCALES = new Set(['en-US.pak', 'ru.pak'])
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const HOMEPAGE = 'https://github.com/galichan775-hue/Launcher-mp'
// runtime path -> POSIX mode recorded in the Electron archive, filled while extracting
const extractedModes = new Map()

const log = message => process.stdout.write(`${message}\n`)
const mb = value => `${(value / 1024 / 1024).toFixed(1)} MB`
const now = () => Math.floor(Date.now() / 1000)

// ---------------------------------------------------------------- electron runtime

function electronVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version
}

function download(url, target, redirectsLeft = 0) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft > 10) return reject(new Error(`Too many redirects for ${url}`))
    https.get(url, { headers: { 'user-agent': 'aoc2-launcher-deb-builder' } }, response => {
      const { statusCode, headers } = response
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume()
        return resolve(download(new URL(headers.location, url).toString(), target, redirectsLeft + 1))
      }
      if (statusCode !== 200) {
        response.resume()
        return reject(new Error(`GET ${url} -> HTTP ${statusCode}`))
      }
      fs.mkdirSync(CACHE, { recursive: true })
      const total = Number(headers['content-length'] || 0)
      let seen = 0
      let reported = -1
      response.on('data', chunk => {
        seen += chunk.length
        if (!total) return
        const percent = Math.floor((seen / total) * 100)
        if (percent >= reported + 10) {
          reported = percent
          log(`  downloading electron: ${percent}% (${mb(seen)})`)
        }
      })
      const file = fs.createWriteStream(target)
      response.pipe(file)
      file.on('finish', () => file.close(() => resolve(target)))
      file.on('error', reject)
    }).on('error', reject)
  })
}

async function fetchElectronZip() {
  const version = electronVersion()
  const file = path.join(CACHE, `electron-v${version}-linux-x64.zip`)
  if (fs.existsSync(file) && fs.statSync(file).size > 1) {
    log(`  cached: ${path.basename(file)} (${mb(fs.statSync(file).size)})`)
    return file
  }
  // the target name is derived from the original URL, not the redirect target
  const url = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-linux-x64.zip`
  return download(url, file)
}

async function extractZip(zipPath, target) {
  await fsp.rm(target, { recursive: true, force: true })
  await fsp.mkdir(target, { recursive: true })
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, handle) => (error ? reject(error) : resolve(handle)))
  })
  await new Promise((resolve, reject) => {
    zip.on('error', reject)
    zip.on('end', resolve)
    zip.on('entry', entry => {
      // the archive has a single electron-linux-x64/ root folder that we do not want
      const relative = entry.fileName.replace(/^electron-linux-x64\//, '')
      if (!relative) return void zip.readEntry()
      const destination = path.join(target, relative)
      if (entry.fileName.endsWith('/')) {
        fs.mkdirSync(destination, { recursive: true })
        return void zip.readEntry()
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      zip.openReadStream(entry, (error, readable) => {
        if (error) return reject(error)
        // Windows has no POSIX permission bits, so the mode the archive recorded is the only
        // source of truth for which files are executable. Keep it for the packaging step.
        const mode = (entry.externalFileAttributes >>> 16) & 0o777
        extractedModes.set(relative.split('/').join('/'), (mode & 0o111) ? 0o755 : 0o644)
        const out = fs.createWriteStream(destination)
        readable.pipe(out)
        out.on('finish', () => { out.close(); zip.readEntry() })
        out.on('error', reject)
      })
    })
    zip.readEntry()
  })
  // the runtime binary is renamed so /usr/bin, the desktop file and StartupWMClass agree
  const runtime = path.join(target, 'electron')
  if (fs.existsSync(runtime)) fs.renameSync(runtime, path.join(target, EXECUTABLE))
  return target
}

async function pruneRuntime() {
  const locales = path.join(STAGE, 'locales')
  let removed = 0
  let saved = 0
  if (fs.existsSync(locales)) {
    for (const name of await fsp.readdir(locales)) {
      if (KEEP_LOCALES.has(name)) continue
      const target = path.join(locales, name)
      saved += (await fsp.stat(target)).size
      await fsp.rm(target, { force: true })
      removed += 1
    }
  }
  // ships in every Electron runtime, unused once we provide our own asar
  const defaultApp = path.join(STAGE, 'resources', 'default_app.asar')
  if (fs.existsSync(defaultApp)) {
    saved += (await fsp.stat(defaultApp)).size
    await fsp.rm(defaultApp, { force: true })
  }
  log(`  pruned ${removed} locale files and default_app.asar (-${mb(saved)})`)
  log(`  kept locales: ${[...KEEP_LOCALES].join(', ')}`)
}

async function copyTree(from, to) {
  await fsp.mkdir(to, { recursive: true })
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const destination = path.join(to, entry.name)
    if (entry.isDirectory()) await copyTree(source, destination)
    else if (entry.isFile()) await fsp.copyFile(source, destination)
  }
}

// electron-builder packs the production dependency closure into the asar; main.cjs requires
// yauzl, so the closure has to be staged explicitly or the app cannot start on Linux.
function productionDependencies() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const names = new Set()
  const queue = Object.keys(manifest.dependencies || {})
  while (queue.length) {
    const name = queue.shift()
    if (names.has(name)) continue
    const manifestPath = path.join(ROOT, 'node_modules', name, 'package.json')
    if (!fs.existsSync(manifestPath)) throw new Error(`production dependency ${name} is not installed`)
    names.add(name)
    const child = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    for (const dependency of Object.keys(child.dependencies || {})) queue.push(dependency)
  }
  return [...names]
}

async function packAsar() {
  await fsp.rm(ASAR_STAGE, { recursive: true, force: true })
  await fsp.mkdir(ASAR_STAGE, { recursive: true })
  // mirrors the electron-builder "files" patterns: app/**, electron/**, package.json
  await copyTree(path.join(ROOT, 'app'), path.join(ASAR_STAGE, 'app'))
  await copyTree(path.join(ROOT, 'electron'), path.join(ASAR_STAGE, 'electron'))
  await fsp.copyFile(path.join(ROOT, 'package.json'), path.join(ASAR_STAGE, 'package.json'))
  const dependencies = productionDependencies()
  for (const name of dependencies) {
    await copyTree(path.join(ROOT, 'node_modules', name), path.join(ASAR_STAGE, 'node_modules', name))
  }
  log(`  staged production dependencies: ${dependencies.join(', ')}`)
  const target = path.join(STAGE, 'resources', 'app.asar')
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await asar.createPackage(ASAR_STAGE, target)
  await fsp.rm(ASAR_STAGE, { recursive: true, force: true })
  return target
}

// ---------------------------------------------------------------- ustar writer

const octal = (value, length) => Buffer.from(value.toString(8).padStart(length - 1, '0') + '\0', 'ascii')

function tarHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8')
  if (name.length > 100) throw new Error(`Path too long for ustar: ${entry.name}`)
  const header = Buffer.alloc(512)
  name.copy(header, 0)
  octal(entry.mode & 0o7777, 8).copy(header, 100)
  octal(0, 8).copy(header, 108)
  octal(0, 8).copy(header, 116)
  octal(entry.size || 0, 12).copy(header, 124)
  octal(entry.mtime || 0, 12).copy(header, 136)
  header.write(entry.type, 156, 1, 'ascii')
  Buffer.from(entry.linkTarget || '', 'utf8').copy(header, 157)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  Buffer.from('root', 'utf8').copy(header, 265)
  Buffer.from('root', 'utf8').copy(header, 297)
  octal(0, 8).copy(header, 329)
  octal(0, 8).copy(header, 337)
  // the checksum is computed with its own field filled with spaces
  header.write('        ', 148, 8, 'ascii')
  let sum = 0
  for (const byte of header) sum += byte
  Buffer.from(`${sum.toString(8).padStart(6, '0')}\0 `, 'ascii').copy(header, 148)
  return header
}

// Streams a ustar archive to disk so the ~275 MB payload never sits in memory at once.
// Returns the md5sums listing and the installed size that control.tar needs.
async function writeTar(entries, target) {
  const handle = await fsp.open(target, 'w')
  const hash = crypto.createHash('md5')
  const md5sums = []
  let installed = 0
  const padding = Buffer.alloc(512)
  try {
    for (const entry of entries) {
      await handle.write(tarHeader(entry))
      if (entry.type !== '0') continue
      const md5 = crypto.createHash('md5')
      if (typeof entry.data === 'string') entry.data = Buffer.from(entry.data, 'utf8')
      if (entry.data) {
        md5.update(entry.data)
        hash.update(entry.data)
        await handle.write(entry.data)
        const rest = entry.data.length % 512
        if (rest) await handle.write(padding.subarray(0, 512 - rest))
      } else {
        // stream large files from disk instead of buffering them
        for await (const chunk of fs.createReadStream(entry.source)) {
          md5.update(chunk)
          hash.update(chunk)
          await handle.write(chunk)
        }
        const rest = entry.size % 512
        if (rest) await handle.write(padding.subarray(0, 512 - rest))
      }
      installed += entry.size
      md5sums.push(`${md5.digest('hex')}  ${entry.name.replace(/^\.\//, '')}`)
    }
    await handle.write(padding)
    await handle.write(padding)
  } finally {
    await handle.close()
  }
  return { md5sums, installed, digest: hash.digest('hex') }
}

// ---------------------------------------------------------------- ar writer

function buildAr(members) {
  const chunks = []
  for (const member of members) {
    const header = Buffer.alloc(60)
    // GNU ar space-pads the name field, which is what dpkg's ar reader expects
    header.write(member.name.padEnd(16, ' ').slice(0, 16), 0, 16, 'ascii')
    header.write(String(member.mtime).padStart(12, ' '), 16, 12, 'ascii')
    header.write('0     ', 28, 6, 'ascii')
    header.write('0     ', 34, 6, 'ascii')
    header.write('100644 ', 40, 8, 'ascii')
    header.write(String(member.data.length).padStart(10, ' '), 48, 10, 'ascii')
    header.write('`\n', 58, 2, 'ascii')
    chunks.push(header, member.data)
    if (member.data.length % 2) chunks.push(Buffer.from('\n'))
  }
  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------- compression

function pythonExecutable() {
  for (const candidate of ['python', 'python3', 'py']) {
    const probe = spawnSync(candidate, ['-c', 'import lzma,sys; sys.exit(0)'], { stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return candidate
  }
  return null
}

// Windows has no xz encoder: bsdtar cannot compress a pre-built tar stream and fpm only
// exists in the Linux Docker image, so Python's stdlib lzma does the work.
async function compress(source, target, algorithm) {
  if (algorithm === 'gzip') {
    await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 9 }), fs.createWriteStream(target))
    return target
  }
  const python = pythonExecutable()
  if (!python) {
    log('  WARNING: no Python with lzma found, falling back to gzip (artifact will be larger)')
    return compress(source, target, 'gzip')
  }
  const child = spawn(python, [path.join(ROOT, 'tools', 'xz-compress.py'), String(process.env.XZ_PRESET || 6)], {
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const code = await Promise.all([
    pipeline(fs.createReadStream(source), child.stdin),
    pipeline(child.stdout, fs.createWriteStream(target))
  ]).then(() => new Promise(resolve => child.on('close', resolve)))
  if (code !== 0) throw new Error(`xz-compress.py exited with ${code}`)
  return target
}

// ---------------------------------------------------------------- payload metadata

async function walk(root, base = '') {
  const entries = []
  for (const item of await fsp.readdir(root, { withFileTypes: true })) {
    const relative = base ? `${base}/${item.name}` : item.name
    const absolute = path.join(root, item.name)
    if (item.isDirectory()) {
      entries.push({ name: `./${relative}`, type: '5', mode: 0o755 })
      entries.push(...await walk(absolute, relative))
    } else if (item.isSymbolicLink()) {
      entries.push({ name: `./${relative}`, type: '2', mode: 0o777, linkTarget: await fsp.readlink(absolute) })
    } else if (item.isFile()) {
      // stat.mode is meaningless on Windows, so the archive mode decides; everything a user
      // must not be able to rewrite stays 0644 instead of the 0666 Windows hands out.
      const mode = extractedModes.get(relative) || 0o644
      const stat = await fsp.stat(absolute)
      entries.push({
        name: `./${relative}`,
        type: '0',
        mode,
        mtime: Math.floor(stat.mtimeMs / 1000),
        size: stat.size,
        source: absolute
      })
    }
  }
  return entries
}

function desktopEntry() {
  return [
    '[Desktop Entry]',
    'Name=AOC 2 Multiplayer',
    'GenericName=Mod Launcher',
    'Comment=Age of History II multiplayer mod launcher',
    'Exec=/usr/bin/aoc-2-multiplayer %U',
    'Icon=aoc-2-multiplayer',
    'Terminal=false',
    'Type=Application',
    'Categories=Game;',
    'StartupNotify=true',
    'StartupWMClass=AOC 2 Multiplayer',
    ''
  ].join('\n')
}

const POSTINST = `#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -qtf /usr/share/icons/hicolor || true
fi
exit 0
`

// No licence has been published for the launcher sources, so the bundled Electron runtime and
// the launcher code are declared separately instead of claiming MIT for everything.
const COPYRIGHT = `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: ${PACKAGE_NAME}
Source: ${HOMEPAGE}

Files: *
Copyright: 2026 AOC 2 Multiplayer
License: proprietary
 The launcher sources are not covered by a published redistribution licence. The source code
 is available at the upstream URL above.
 .
 This package is distributed without any warranty, to the extent permitted by applicable law.

Files: /opt/${PACKAGE_NAME}/*
Copyright: 2013-2026 GitHub Inc.
           2023-2026 The Chromium Authors
           2023-2026 Node.js contributors
License: MIT
 Permission is hereby granted, free of charge, to any person obtaining a copy of this
 software and associated documentation files (the "Software"), to deal in the Software
 without restriction.
 .
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 PARTICULAR PURPOSE AND NONINFRINGEMENT.
`

const CHANGELOG = `aoc-2-multiplayer (VERSION) unstable; urgency=medium

  * Initial Linux release for Linux Mint, Debian and Ubuntu.

 -- AOC 2 Multiplayer <${HOMEPAGE}/issues>  Wed, 30 Sep 2026 00:00:00 +0000
`

// ---------------------------------------------------------------- main

function iconSource(size) {
  return path.join(ROOT, 'build', 'icons', `${size}x${size}.png`)
}

// The icon PNGs are committed, so a fresh clone can build the package without PowerShell. The
// generator only runs when they are absent, which is the case after a clean build.
async function ensureIcons() {
  const missing = ICON_SIZES.filter(size => !fs.existsSync(iconSource(size)))
  if (!missing.length) return
  const generator = path.join(ROOT, 'tools', 'Make-LinuxIcons.ps1')
  if (process.platform === 'win32' && fs.existsSync(path.join(ROOT, 'build', 'aoc2.ico'))) {
    log(`  generating ${missing.length} icon(s) from build/aoc2.ico`)
    const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', generator], {
      cwd: ROOT,
      stdio: 'inherit'
    })
    if (result.status !== 0) log('  WARNING: the icon generator failed')
  }
  const stillMissing = ICON_SIZES.filter(size => !fs.existsSync(iconSource(size)))
  if (stillMissing.length) {
    throw new Error(`missing build/icons PNGs: ${stillMissing.map(size => `${size}x${size}.png`).join(', ')} - run "npm run icons"`)
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const version = manifest.version
  const deb = manifest.build.deb
  const linux = manifest.build.linux
  const algorithm = deb.compression === 'gz' ? 'gzip' : 'xz'

  log('1/5 fetching Electron linux-x64 runtime')
  await extractZip(await fetchElectronZip(), STAGE)
  await ensureIcons()

  log('2/5 pruning runtime and packing app.asar')
  await pruneRuntime()
  const asarFile = await packAsar()
  log(`  ${path.relative(STAGE, asarFile)} = ${mb(fs.statSync(asarFile).size)}`)

  log('3/5 assembling data.tar')
  await fsp.mkdir(WORK, { recursive: true })
  // /opt and the install directory are shipped explicitly so dpkg never has to create them
  // with umask-dependent modes
  const data = [
    { name: './opt', type: '5', mode: 0o755 },
    { name: `.${OPT_DIR}`, type: '5', mode: 0o755 },
    ...(await walk(STAGE)).map(entry => ({ ...entry, name: inOpt(entry.name.replace(/^\.\//, '')) }))
  ]

  const runtimeEntry = data.find(entry => entry.name === inOpt(EXECUTABLE))
  if (!runtimeEntry) throw new Error(`Runtime binary missing at ${inOpt(EXECUTABLE)}`)
  runtimeEntry.mode = 0o755
  // without setuid the Chromium sandbox cannot initialise on Ubuntu 22.04 / Debian 12
  const sandbox = data.find(entry => entry.name === inOpt('chrome-sandbox'))
  if (sandbox) {
    sandbox.mode = 0o4755
    log('  chrome-sandbox -> 4755 (setuid root)')
  } else {
    log('  WARNING: chrome-sandbox not found in the runtime archive')
  }

  const inline = (name, type, mode, data_) => {
    const buffer = Buffer.from(data_, 'utf8')
    return { name, type, mode, mtime: now(), data: buffer, size: buffer.length }
  }
  data.push(
    { name: './usr', type: '5', mode: 0o755 },
    { name: './usr/bin', type: '5', mode: 0o755 },
    { name: `./usr/bin/${EXECUTABLE}`, type: '2', mode: 0o777, linkTarget: `${OPT_DIR}/${EXECUTABLE}` },
    { name: './usr/share', type: '5', mode: 0o755 },
    { name: './usr/share/applications', type: '5', mode: 0o755 },
    inline(`./usr/share/applications/${PACKAGE_NAME}.desktop`, '0', 0o644, desktopEntry()),
    { name: './usr/share/icons', type: '5', mode: 0o755 },
    { name: './usr/share/icons/hicolor', type: '5', mode: 0o755 }
  )
  for (const size of ICON_SIZES) {
    const source = iconSource(size)
    data.push(
      { name: `./usr/share/icons/hicolor/${size}x${size}`, type: '5', mode: 0o755 },
      { name: `./usr/share/icons/hicolor/${size}x${size}/apps`, type: '5', mode: 0o755 },
      {
        name: `./usr/share/icons/hicolor/${size}x${size}/apps/${PACKAGE_NAME}.png`,
        type: '0', mode: 0o644, mtime: now(), size: fs.statSync(source).size, source
      }
    )
  }
  data.push(
    { name: './usr/share/doc', type: '5', mode: 0o755 },
    { name: `./usr/share/doc/${PACKAGE_NAME}`, type: '5', mode: 0o755 },
    inline(`./usr/share/doc/${PACKAGE_NAME}/copyright`, '0', 0o644, COPYRIGHT),
    {
      name: `./usr/share/doc/${PACKAGE_NAME}/changelog.Debian.gz`,
      type: '0', mode: 0o644, mtime: now(), size: 0,
      data: zlib.gzipSync(Buffer.from(CHANGELOG.replace('VERSION', version), 'utf8'), { level: 9 })
    }
  )
  for (const entry of data) {
    if (entry.type === '0' && entry.data && !entry.size) entry.size = entry.data.length
  }

  const dataTar = path.join(WORK, 'data.tar')
  const doubled = data.find(entry => entry.name.includes('//'))
  if (doubled) throw new Error(`Malformed archive path with a doubled slash: ${doubled.name}`)
  const dataResult = await writeTar(data, dataTar)
  log(`  ${data.length} entries, installed size ${mb(dataResult.installed)}`)

  log('4/5 writing control.tar')
  const control = [
    `Package: ${deb.packageName}`,
    `Version: ${version}`,
    'Architecture: amd64',
    `Maintainer: ${linux.maintainer}`,
    `Installed-Size: ${Math.round(dataResult.installed / 1024)}`,
    `Depends: ${deb.depends.join(', ')}`,
    `Recommends: ${deb.recommends.join(', ')}`,
    `Section: ${deb.packageCategory}`,
    `Priority: ${deb.priority}`,
    `Homepage: ${HOMEPAGE}`,
    `Description: ${linux.synopsis}`,
    ...linux.description.split('\n').map(line => ` ${line}`),
    ''
  ].join('\n')
  const controlTar = path.join(WORK, 'control.tar')
  await writeTar([
    { name: './', type: '5', mode: 0o755 },
    inline('./control', '0', 0o644, control),
    inline('./md5sums', '0', 0o644, `${dataResult.md5sums.sort().join('\n')}\n`),
    inline('./postinst', '0', 0o755, POSTINST)
  ], controlTar)
  log(`  md5sums: ${dataResult.md5sums.length} files, payload content md5 ${dataResult.digest}`)

  log(`5/5 compressing with ${algorithm} and assembling ${ARTIFACT}`)
  const suffix = algorithm === 'gzip' ? 'gz' : 'xz'
  const dataArchive = path.join(WORK, `data.tar.${suffix}`)
  const controlArchive = path.join(WORK, `control.tar.${suffix}`)
  await compress(dataTar, dataArchive, algorithm)
  await compress(controlTar, controlArchive, algorithm)
  log(`  data.tar.${suffix} = ${mb(fs.statSync(dataArchive).size)} (from ${mb(fs.statSync(dataTar).size)})`)

  const debBinary = buildAr([
    { name: 'debian-binary', mtime: now(), data: Buffer.from('2.0\n', 'ascii') },
    { name: `control.tar.${suffix}`, mtime: now(), data: fs.readFileSync(controlArchive) },
    { name: `data.tar.${suffix}`, mtime: now(), data: fs.readFileSync(dataArchive) }
  ])
  await fsp.mkdir(DEB_DIR, { recursive: true })
  const target = path.join(DEB_DIR, ARTIFACT)
  await fsp.writeFile(target, debBinary)
  log(`  ${path.relative(ROOT, target)} = ${mb(debBinary.length)} (${debBinary.length} bytes)`)
  if (debBinary.length > 100 * 1024 * 1024) {
    log('  WARNING: larger than 100 MB, publish it through a GitHub Release instead of raw')
  }
  return target
}

main().catch(error => {
  process.stderr.write(`\nbuild-deb failed: ${error.stack || error.message}\n`)
  process.exitCode = 1
})
