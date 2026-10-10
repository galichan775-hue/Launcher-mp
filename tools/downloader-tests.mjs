// Regression tests for the mod downloader, the install pipeline around it and the resume-state
// sweeper. Everything runs against a local HTTP server, so the suite is deterministic and needs
// no network; the slow-link and long-backoff behaviour is simulated by throttling the server.
//
// The bug this guards against: on a ~100 KB/s link codeload reports no content-length and may
// ignore Range, so the UI used to sit at a fake 90% for an hour and then install a truncated
// archive. These tests pin the three properties that fix depends on: progress is honest, a drop
// is resumed rather than restarted, and nothing unverified ever reaches the game directory.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { downloadFile, downloadToFile, fetchTextWithDeadline, fileSize, CancelledError, DownloadError } =
  require('../electron/downloader.cjs')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_SOURCE = path.join(ROOT, 'electron', 'main.cjs')

let failures = 0
const check = (label, ok, detail = '') => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`)
  if (!ok) failures += 1
}
const section = title => process.stdout.write(`\n${title}\n`)
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

// ---------------------------------------------------------------- zip fixture

// A stored-mode (uncompressed) zip with a wrapper directory, matching the shape of a codeload
// archive: everything sits under <repo>-<commit>/ and the marker file is AoH2MP.jar.
function buildZip({ jarSize = 64 * 1024, extraSize = 16 * 1024 } = {}) {
  const files = [
    { name: 'repo-abc1234/AoH2MP.jar', data: Buffer.alloc(jarSize, 0x41) },
    { name: 'repo-abc1234/data/unit.bin', data: Buffer.alloc(extraSize, 0x42) },
    { name: 'repo-abc1234/META-INF/MANIFEST.MF', data: Buffer.from('Manifest-Version: 1.0\n') }
  ]
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const crc = zlib.crc32(file.data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(file.data.length, 18)
    header.writeUInt32LE(file.data.length, 22)
    header.writeUInt16LE(name.length, 26)
    locals.push(header, name, file.data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + file.data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// ---------------------------------------------------------------- test server

// Serves one body with a configurable transfer profile: chunk size, delay between chunks,
// a number of forced drops and whether Range is honoured (codeload does not).
function startServer(body, profile = {}) {
  const {
    path: pathname = '/mod.zip',
    chunkSize = 64 * 1024,
    delayMs = 0,
    drops = 0,
    honourRange = true,
    omitContentLength = false
  } = profile
  let dropsLeft = drops
  const state = { requests: 0, ranges: [], served: 0 }
  const server = http.createServer((request, response) => {
    state.requests += 1
    if (request.url !== pathname) {
      response.writeHead(404, { 'Content-Length': '0' })
      response.end()
      return
    }
    const header = request.headers.range || ''
    state.ranges.push(header)
    const match = /bytes=(\d+)-/.exec(header)
    const resumed = honourRange && Boolean(match)
    const start = resumed ? Number(match[1]) : 0
    const headers = { 'Content-Type': 'application/zip' }
    if (!omitContentLength) headers['Content-Length'] = String(body.length - start)
    if (resumed) headers['Content-Range'] = `bytes ${start}-${body.length - 1}/${body.length}`
    response.writeHead(resumed ? 206 : 200, headers)
    const slice = body.subarray(start)
    const dropThis = dropsLeft > 0
    if (dropThis) dropsLeft -= 1
    let offset = 0
    const push = () => {
      if (dropThis && offset >= Math.floor(slice.length / 2)) {
        response.destroy()
        return
      }
      if (offset >= slice.length) {
        response.end()
        return
      }
      response.write(slice.subarray(offset, offset + chunkSize))
      offset += chunkSize
      state.served += chunkSize
      if (offset < slice.length) setTimeout(push, delayMs)
      else response.end()
    }
    push()
  })
  server.on('connection', socket => socket.on('error', () => {}))
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      state,
      url: `http://127.0.0.1:${server.address().port}${pathname}`,
      close: () => new Promise(done => server.close(done))
    }))
  })
}

// ---------------------------------------------------------------- workspace

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-downloader-'))
const scratch = name => {
  const dir = path.join(workspace, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const paths = dir => ({
  destination: path.join(dir, 'mod.zip'),
  partialPath: path.join(dir, 'mod.zip.part'),
  metaPath: path.join(dir, 'mod.zip.part.json')
})

// ---------------------------------------------------------------- tests

async function testHappyPath() {
  section('completed download')
  const body = buildZip()
  const { url, close } = await startServer(body)
  const dir = scratch('happy')
  const events = []
  try {
    const result = await downloadFile({
      url,
      ...paths(dir),
      expectedTotal: body.length,
      expectedSha256: sha256(body),
      onProgress: event => events.push(event)
    })
    check('the archive lands at the destination', fileSize(result.path) === body.length, `${result.bytes} bytes`)
    check('the partial is renamed away, not left behind', !fs.existsSync(path.join(dir, 'mod.zip.part')))
    check('the digest is verified', result.verified === true)
    check('the first attempt succeeds', result.attempts === 1, `attempts ${result.attempts}`)
    check('progress never exceeds 100%', events.every(event => event.received <= body.length))
    check('progress ends on the exact byte count', events.at(-1)?.done === true && events.at(-1).received === body.length)
  } finally {
    await close()
  }
}

async function testUnknownSize() {
  section('server without content-length')
  const body = buildZip()
  const { url, close } = await startServer(body, { omitContentLength: true })
  const dir = scratch('nolength')
  try {
    const events = []
    const result = await downloadFile({ url, ...paths(dir), expectedSha256: sha256(body), onProgress: e => events.push(e) })
    check('the download still completes', result.bytes === body.length)
    check('the real byte count becomes the total', result.total === body.length, `total ${result.total}`)
    check('interim progress stays indeterminate instead of showing a fake percentage',
      events.filter(e => !e.done && e.total > 0).length === 0,
      `${events.filter(e => !e.done && e.total > 0).length} interim events had a total`)
    check('the completion event reports the real size', events.at(-1)?.done === true && events.at(-1).total === body.length)
  } finally {
    await close()
  }
}

async function testResume() {
  section('resume after a drop')
  const body = buildZip()
  const { url, state, close } = await startServer(body, { drops: 1, chunkSize: 8 * 1024, delayMs: 4 })
  const dir = scratch('resume')
  try {
    const result = await downloadFile({ url, ...paths(dir), expectedTotal: body.length, expectedSha256: sha256(body) })
    check('a mid-transfer drop is survived', result.bytes === body.length)
    check('it took more than one attempt', result.attempts >= 2, `attempts ${result.attempts}`)
    check('the transfer is resumed with a Range header', state.ranges.some(range => range.startsWith('bytes=')),
      state.ranges.join(' | '))
    check('the digest still verifies after resuming', result.verified === true)
  } finally {
    await close()
  }
}

async function testResumeFromExistingPartial() {
  section('resume from a partial left by a previous run')
  const body = buildZip()
  const { url, state, close } = await startServer(body)
  const dir = scratch('resume-existing')
  const options = paths(dir)
  try {
    // half the archive on disk, as if a previous session died mid-download
    fs.writeFileSync(options.partialPath, body.subarray(0, Math.floor(body.length / 2)))
    let resumed = false
    const result = await downloadFile({
      url,
      ...options,
      expectedTotal: body.length,
      expectedSha256: sha256(body),
      onProgress: event => {
        if (event.resumed) resumed = true
      }
    })
    check('the existing partial is used instead of restarting', resumed === true, `resumed ${resumed}`)
    check('only the missing tail is requested', /^bytes=\d+-$/.test(state.ranges[0] || ''), state.ranges[0])
    check('the finished file is complete', result.bytes === body.length)
  } finally {
    await close()
  }
}

async function testRangeIgnored() {
  section('server that ignores Range')
  const body = buildZip()
  // codeload answers 200 with the whole body: the downloader must not append it to the partial
  const { url, close } = await startServer(body, { honourRange: false })
  const dir = scratch('range-ignored')
  const options = paths(dir)
  try {
    fs.writeFileSync(options.partialPath, body.subarray(0, 1000))
    const result = await downloadFile({ url, ...options, expectedTotal: body.length, expectedSha256: sha256(body) })
    check('a full body after a Range request still yields a correct file', result.bytes === body.length, `${result.bytes}`)
    check('the digest verifies, so nothing was appended twice', result.verified === true)
  } finally {
    await close()
  }
}

async function testCancellation() {
  section('cancellation')
  const body = buildZip({ jarSize: 512 * 1024 })
  const { url, close } = await startServer(body, { chunkSize: 16 * 1024, delayMs: 20 })
  const dir = scratch('cancel')
  const options = paths(dir)
  const controller = new AbortController()
  try {
    setTimeout(() => controller.abort(), 80)
    let error = null
    try {
      await downloadFile({ url, ...options, expectedTotal: body.length, signal: controller.signal })
    } catch (caught) {
      error = caught
    }
    check('cancelling aborts the download', error instanceof CancelledError, error && error.message)
    check('the reason is user cancellation, not a network failure',
      !error || error.retryable !== true, error && `retryable ${error.retryable}`)
    const partial = fileSize(options.partialPath)
    check('the bytes already downloaded are kept for the next attempt', partial > 0, `${partial} bytes`)
    check('nothing was promoted to the destination', !fs.existsSync(options.destination))
  } finally {
    await close()
  }
}

async function testDigestMismatch() {
  section('integrity failure')
  const body = buildZip()
  const { url, state, close } = await startServer(body)
  const dir = scratch('digest')
  try {
    let error = null
    try {
      await downloadFile({ url, ...paths(dir), expectedTotal: body.length, expectedSha256: 'f'.repeat(64) })
    } catch (caught) {
      error = caught
    }
    check('a wrong digest is rejected', error instanceof DownloadError, error && error.message)
    check('it is terminal, not retried forever', error?.retryable === false)
    check('the retries are capped so a slow link is not billed twice', state.requests <= 3, `${state.requests} requests`)
    check('no finished file is produced', !fs.existsSync(path.join(dir, 'mod.zip')))
  } finally {
    await close()
  }
}

async function testMissingArchive() {
  section('missing archive')
  const { url, close } = await startServer(buildZip())
  const dir = scratch('missing')
  try {
    let error = null
    try {
      await downloadFile({ url: `${url}.missing`, ...paths(dir), expectedTotal: 1000 })
    } catch (caught) {
      error = caught
    }
    check('a 404 is reported as such', /404/.test(error?.message || ''), error && error.message)
    check('a 404 is not retried', error?.retryable === false, `retryable ${error?.retryable}`)
  } finally {
    await close()
  }
}

async function testTruncatedBody() {
  section('short body')
  const body = buildZip()
  // advertises the full length, sends half: the downloader must never report success
  const { url, close } = await startServer(body.subarray(0, Math.floor(body.length / 2)))
  const dir = scratch('short')
  const options = paths(dir)
  const controller = new AbortController()
  try {
    setTimeout(() => controller.abort(), 1500)
    let result = null
    let error = null
    try {
      result = await downloadFile({
        url,
        ...options,
        expectedTotal: body.length,
        signal: controller.signal,
        onProgress: event => {
          if (event.done) throw new Error('reported done for a short body')
        }
      })
    } catch (caught) {
      error = caught
    }
    check('a short body is never accepted as complete', result === null, result && JSON.stringify(result))
    check('it keeps retrying until it is cancelled or gives up', /отмен|оборва/i.test(error?.message || ''), error && error.message)
  } finally {
    await close()
  }
}

async function testProgressIsHonest() {
  section('progress honesty on a slow link')
  const body = buildZip({ jarSize: 2 * 1024 * 1024 })
  const { url, close } = await startServer(body, { chunkSize: 16 * 1024, delayMs: 12 })
  const dir = scratch('slow')
  try {
    const events = []
    const started = Date.now()
    const result = await downloadFile({
      url,
      ...paths(dir),
      expectedTotal: body.length,
      onProgress: event => events.push(event)
    })
    const elapsed = (Date.now() - started) / 1000
    const percentages = events.filter(e => e.total > 0).map(e => Math.round(e.received / e.total * 100))
    check('the archive is transferred in full', result.bytes === body.length, `${result.bytes}/${body.length}`)
    // progress is throttled to keep the UI cheap, but a multi-second transfer still reports steadily
    check('progress is reported repeatedly, not just at the end', events.length >= 4, `${events.length} events`)
    check('progress keeps arriving while the transfer runs', events.filter(e => !e.done).length >= 3,
      `${events.filter(e => !e.done).length} interim events`)
    check('progress is monotonic', events.every((e, i) => i === 0 || e.received >= events[i - 1].received))
    check('the reported percentage tracks the real byte count',
      percentages.every(p => p >= 0 && p <= 100) && percentages.at(-1) === 100,
      `${percentages[0]}% .. ${percentages.at(-1)}%`)
    check('the slowest reported percentage is not pinned at a fake 90%',
      percentages.some(p => p < 85), `min ${Math.min(...percentages)}%`)
    check('speed is reported', events.some(e => e.speedBytesPerSecond > 0))
  } finally {
    await close()
  }
}

async function testRetryBackoffIsReported() {
  section('retry reporting')
  const body = buildZip()
  const { url, close } = await startServer(body, { drops: 1, chunkSize: 8 * 1024, delayMs: 4 })
  const dir = scratch('retry')
  try {
    const retries = []
    await downloadFile({
      url,
      ...paths(dir),
      expectedTotal: body.length,
      expectedSha256: sha256(body),
      onProgress: event => {
        if (event.retrying) retries.push(event)
      }
    })
    check('the UI is told a retry is happening', retries.length >= 1, `${retries.length} retries`)
    check('the retry carries the attempt number', retries.every(e => e.attempt >= 1))
    check('the retry carries a countdown', retries.every(e => Number.isFinite(e.retryInMs)))
  } finally {
    await close()
  }
}

async function testDownloadToFile() {
  section('downloadToFile')
  const body = buildZip()
  const { url, close } = await startServer(body)
  const dir = scratch('tofile')
  try {
    const destination = path.join(dir, 'artifact.deb')
    fs.writeFileSync(destination, 'stale content from a previous attempt')
    const result = await downloadToFile({
      url,
      destination,
      expectedTotal: body.length,
      expectedSha256: sha256(body)
    })
    check('a stale destination is replaced', result.bytes === body.length && result.verified === true)
    check('the destination holds the new bytes', fileSize(destination) === body.length)
    check('the size is remembered for the next run', fs.existsSync(`${destination}.part.json`))
  } finally {
    await close()
  }
}

async function testTextDeadline() {
  section('small text fetches')
  const body = Buffer.from('1.2.10\n')
  const { url, close } = await startServer(body, { chunkSize: body.length })
  try {
    const text = await fetchTextWithDeadline(url, { timeoutMs: 5000, attempts: 2 })
    check('a version marker is read', text.trim() === '1.2.10', JSON.stringify(text))
    let error = null
    try {
      await fetchTextWithDeadline(`${url}.missing`, { timeoutMs: 2000, attempts: 1 })
    } catch (caught) {
      error = caught
    }
    check('a missing marker fails fast instead of hanging', error !== null && /404/.test(error.message), error && error.message)
  } finally {
    await close()
  }
}

// ---------------------------------------------------------------- install pipeline

// Mirrors installVersionFromCommit in electron/main.cjs: download to a partial, extract into a
// staging directory beside the game, then swap the payload into place. The downloader and the
// extraction are the real ones; only the IPC plumbing is absent.
async function install({ versionId, commit, url, expectedTotal, expectedSha256, signal, onProgress, installsRoot, downloadsRoot }) {
  const yauzl = require('yauzl')
  const staging = path.join(installsRoot, `${versionId}.installing`)
  const partialPath = path.join(downloadsRoot, `${versionId}-${commit}.zip.part`)
  const archivePath = path.join(downloadsRoot, `${versionId}-${commit}.zip`)
  try {
    await fsp.mkdir(downloadsRoot, { recursive: true })
    await fsp.rm(staging, { recursive: true, force: true })
    await fsp.mkdir(staging, { recursive: true })
    const result = await downloadFile({
      url,
      destination: archivePath,
      partialPath,
      metaPath: `${partialPath}.json`,
      expectedTotal,
      expectedSha256,
      signal,
      onProgress
    })
    await new Promise((resolve, reject) => {
      yauzl.open(archivePath, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
        if (error) return reject(error)
        zip.on('error', reject)
        zip.on('end', resolve)
        zip.on('entry', entry => {
          const target = path.join(staging, entry.fileName)
          if (entry.fileName.replace(/\\/g, '/').split('/').includes('..')) return reject(new Error('zip slip'))
          if (/\/$/.test(entry.fileName)) {
            fs.mkdirSync(target, { recursive: true })
            return void zip.readEntry()
          }
          fs.mkdirSync(path.dirname(target), { recursive: true })
          zip.openReadStream(entry, (streamError, readable) => {
            if (streamError) return reject(streamError)
            const out = fs.createWriteStream(target)
            readable.pipe(out)
            out.on('error', reject)
            out.on('finish', () => zip.readEntry())
          })
        })
        zip.readEntry()
      })
    })
    const directories = (await fsp.readdir(staging, { withFileTypes: true })).filter(entry => entry.isDirectory())
    const repositoryRoot = directories
      .map(entry => path.join(staging, entry.name))
      .find(candidate => fs.existsSync(path.join(candidate, 'AoH2MP.jar')))
    if (!repositoryRoot) throw new Error('В загруженной версии не найден AoH2MP.jar.')
    const destination = path.join(installsRoot, versionId)
    const previous = path.join(installsRoot, `${versionId}.previous`)
    await fsp.rm(previous, { recursive: true, force: true })
    let backupMoved = false
    if (fs.existsSync(destination)) {
      await fsp.rename(destination, previous)
      backupMoved = true
    }
    try {
      await fsp.rename(repositoryRoot, destination)
    } catch (error) {
      if (backupMoved) await fsp.rename(previous, destination)
      throw error
    }
    await fsp.rm(previous, { recursive: true, force: true })
    await fsp.rm(archivePath, { force: true })
    return { installDirectory: destination, bytes: result.bytes, verified: result.verified }
  } finally {
    // the partial is deliberately kept, the staging tree is not
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

async function testInstallPipeline() {
  section('install pipeline')
  const body = buildZip({ jarSize: 256 * 1024 })
  const digest = sha256(body)
  const { url, close } = await startServer(body, { chunkSize: 16 * 1024, delayMs: 2 })
  const root = scratch('install')
  const installsRoot = path.join(root, 'versions')
  const downloadsRoot = path.join(root, 'downloads')
  fs.mkdirSync(installsRoot, { recursive: true })
  const commit = 'a'.repeat(40)
  const common = { url, expectedTotal: body.length, expectedSha256: digest, installsRoot, downloadsRoot }
  try {
    const first = await install({ versionId: 'aoh2mp-1.9.4', commit, ...common })
    check('a first install places the game files', fs.existsSync(path.join(first.installDirectory, 'AoH2MP.jar')))
    check('nested files survive extraction', fs.existsSync(path.join(first.installDirectory, 'data', 'unit.bin')))
    check('the payload is the exact archive content', fs.statSync(path.join(first.installDirectory, 'AoH2MP.jar')).size === 256 * 1024)
    check('the archive is not left lying next to the game', !fs.existsSync(path.join(downloadsRoot, `aoh2mp-1.9.4-${commit}.zip`)))
    check('the staging tree is removed', !fs.existsSync(path.join(installsRoot, 'aoh2mp-1.9.4.installing')))

    const second = await install({ versionId: 'aoh2mp-1.9.4', commit, ...common })
    check('installing again over an existing version works', fs.existsSync(path.join(second.installDirectory, 'AoH2MP.jar')))
    check('the replaced copy is cleaned up', !fs.existsSync(path.join(installsRoot, 'aoh2mp-1.9.4.previous')))
    check('no staging leftovers after a reinstall', !fs.existsSync(path.join(installsRoot, 'aoh2mp-1.9.4.installing')))
  } finally {
    await close()
  }
}

async function testInstallSurvivesDrop() {
  section('install with a drop in the middle')
  const body = buildZip()
  const { url, close } = await startServer(body, { drops: 1, chunkSize: 8 * 1024, delayMs: 4 })
  const root = scratch('install-drop')
  const installsRoot = path.join(root, 'versions')
  const downloadsRoot = path.join(root, 'downloads')
  fs.mkdirSync(installsRoot, { recursive: true })
  try {
    const retries = []
    const result = await install({
      versionId: 'aoh2mp-1.9.4',
      commit: 'b'.repeat(40),
      url,
      expectedTotal: body.length,
      expectedSha256: sha256(body),
      installsRoot,
      downloadsRoot,
      onProgress: event => {
        if (event.retrying) retries.push(event)
      }
    })
    check('the install completes despite the drop', fs.existsSync(path.join(result.installDirectory, 'AoH2MP.jar')))
    check('the retry was reported to the UI', retries.length === 1, `${retries.length} retries`)
    check('the installed archive verifies', result.verified === true)
  } finally {
    await close()
  }
}

async function testCancelledInstallKeepsGame() {
  section('cancelled install')
  const body = buildZip({ jarSize: 256 * 1024 })
  const { url, close } = await startServer(body, { chunkSize: 16 * 1024, delayMs: 10 })
  const root = scratch('install-cancel')
  const installsRoot = path.join(root, 'versions')
  const downloadsRoot = path.join(root, 'downloads')
  fs.mkdirSync(installsRoot, { recursive: true })
  const destination = path.join(installsRoot, 'aoh2mp-1.9.4')
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(destination, 'AoH2MP.jar'), 'the working copy')
  const controller = new AbortController()
  try {
    setTimeout(() => controller.abort(), 80)
    let error = null
    try {
      await install({
        versionId: 'aoh2mp-1.9.4',
        commit: 'c'.repeat(40),
        url,
        expectedTotal: body.length,
        installsRoot,
        downloadsRoot,
        signal: controller.signal
      })
    } catch (caught) {
      error = caught
    }
    check('the install aborts', /отмен/i.test(error?.message || ''), error && error.message)
    check('the previously installed game is untouched', fs.readFileSync(path.join(destination, 'AoH2MP.jar'), 'utf8') === 'the working copy')
    check('no staging folder is left behind', !fs.existsSync(path.join(installsRoot, 'aoh2mp-1.9.4.installing')))
  } finally {
    await close()
  }
}

async function testFailedInstallKeepsGame() {
  section('failed install')
  const { url, close } = await startServer(buildZip())
  const root = scratch('install-fail')
  const installsRoot = path.join(root, 'versions')
  const downloadsRoot = path.join(root, 'downloads')
  fs.mkdirSync(installsRoot, { recursive: true })
  const destination = path.join(installsRoot, 'aoh2mp-1.9.4')
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(destination, 'AoH2MP.jar'), 'the working copy')
  try {
    let error = null
    try {
      await install({
        versionId: 'aoh2mp-1.9.4',
        commit: 'd'.repeat(40),
        url: `${url}.missing`,
        expectedTotal: 1234,
        installsRoot,
        downloadsRoot
      })
    } catch (caught) {
      error = caught
    }
    check('a missing archive fails the install', /404/.test(error?.message || ''), error && error.message)
    check('the previously installed game still works', fs.readFileSync(path.join(destination, 'AoH2MP.jar'), 'utf8') === 'the working copy')
    check('no staging folder is left behind', !fs.existsSync(path.join(installsRoot, 'aoh2mp-1.9.4.installing')))
  } finally {
    await close()
  }
}

// ---------------------------------------------------------------- resume-state sweeper

// sweepStaleDownloads lives in main.cjs, which cannot be imported without booting Electron, so the
// function body is lifted out of the source and driven directly. That keeps the test honest: it
// exercises the shipped code, not a copy of it.
function loadSweeper() {
  const source = fs.readFileSync(MAIN_SOURCE, 'utf8')
  const start = source.indexOf('async function sweepStaleDownloads()')
  const end = source.indexOf("ipcMain.handle('mod:check-updates'")
  if (start < 0 || end < 0) throw new Error('could not locate sweepStaleDownloads in electron/main.cjs')
  return new Function(
    'launcherConfig', 'downloadsDirectory', 'PARTIAL_MAX_AGE_MS', 'isInstalled', 'versionCommitOverrides', 'fsp', 'path',
    `${source.slice(start, end)}; return sweepStaleDownloads`
  )
}

async function testSweeper() {
  section('stale download sweeper')
  const DAY = 24 * 60 * 60 * 1000
  const MAX_AGE = 7 * DAY
  const instantiate = loadSweeper()
  const run = async (files, { commits = { 'aoh2mp-1.9.4': 'abc123' }, installed = ['aoh2mp-1.9.4'] } = {}) => {
    const dir = scratch('sweep')
    for (const [name, spec] of Object.entries(files)) {
      const target = path.join(dir, name)
      if (name.endsWith('/')) fs.mkdirSync(target, { recursive: true })
      else {
        fs.writeFileSync(target, typeof spec === 'string' ? spec : spec.contents)
        if (typeof spec === 'object' && spec.ageDays) {
          const when = new Date(Date.now() - spec.ageDays * DAY)
          fs.utimesSync(target, when, when)
        }
      }
    }
    const sweep = instantiate(
      { versions: Object.keys(commits).map(id => ({ id })) },
      dir,
      MAX_AGE,
      id => installed.includes(id),
      commits,
      fsp,
      path
    )
    await sweep()
    return fs.readdirSync(dir)
  }

  const installedPart = 'aoh2mp-1.9.4-abc123.zip.part'
  const newerPart = 'aoh2mp-1.9.4-def456.zip.part'

  let left = await run({ [installedPart]: 'x' })
  check('the part of an already installed commit is removed', !left.includes(installedPart), left.join(', '))
  left = await run({ [`${installedPart}.json`]: '{}' })
  check('an orphaned sidecar is removed too', !left.includes(`${installedPart}.json`), left.join(', '))
  left = await run({ [newerPart]: 'x' })
  check('a newer commit of the same version is kept as a resume point', left.includes(newerPart), left.join(', '))
  left = await run({ [installedPart]: 'x' }, { commits: { 'aoh2mp-1.9.4': 'zzz999' } })
  check('a part for a commit that is not installed is kept', left.includes(installedPart), left.join(', '))
  left = await run({ 'bloody-europe-1.9.3-999999.zip.part': { contents: 'z', ageDays: 30 } }, { commits: {} })
  check('a month old part of an uninstalled version is removed', !left.includes('bloody-europe-1.9.3-999999.zip.part'), left.join(', '))
  left = await run({ 'aoh2mp-1.9.3-111111.zip.part': { contents: 'z', ageDays: 0.0007 } }, { commits: {} })
  check('a fresh part of an uninstalled version is kept', left.includes('aoh2mp-1.9.3-111111.zip.part'), left.join(', '))
  left = await run({ [installedPart]: 'x', 'notes.txt': 'hi', 'subdir.zip.part/': '' })
  check('unrelated files are untouched', left.includes('notes.txt'), left.join(', '))
  check('a directory that looks like a part is not deleted', left.includes('subdir.zip.part'), left.join(', '))
  check('the obsolete part is still removed among them', !left.includes(installedPart), left.join(', '))
}

// ---------------------------------------------------------------- updater integrity

async function testUpdaterDigest() {
  section('updater package integrity')
  const body = Buffer.alloc(200000, 0x42)
  const digest = sha256(body)
  const { url, close } = await startServer(body, { chunkSize: body.length })
  const dir = scratch('updater')
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'launcher-config.json'), 'utf8'))
  try {
    const accepted = await downloadToFile({
      url,
      destination: path.join(dir, 'good.deb'),
      expectedTotal: body.length,
      expectedSha256: digest
    })
    check('a package matching the published digest is accepted', accepted.verified === true)
    let error = null
    try {
      await downloadToFile({
        url,
        destination: path.join(dir, 'bad.deb'),
        expectedTotal: body.length,
        expectedSha256: 'f'.repeat(64)
      })
    } catch (caught) {
      error = caught
    }
    check('a tampered package is refused', error instanceof DownloadError, error && error.message)
    check('the refusal is terminal', error?.retryable === false)
    check('the shipped config publishes a digest for the updater package',
      /^[0-9a-f]{64}$/i.test(config.updater?.sha256 || ''), config.updater?.sha256)
    check('the shipped config publishes the package size', config.updater?.packageBytes > 0, String(config.updater?.packageBytes))
  } finally {
    await close()
  }

  // the digest must actually reach the downloader: applyRepoUpdate has to pass it through
  const mainSource = fs.readFileSync(MAIN_SOURCE, 'utf8')
  const apply = mainSource.slice(mainSource.indexOf('async function applyRepoUpdate()'), mainSource.indexOf('// --- end repo-based updater ---'))
  check('applyRepoUpdate passes the published digest to the downloader',
    /expectedSha256:\s*launcherConfig\.updater\?\.sha256/.test(apply))
}

// ------------------------------------------------------- orphaned game processes

// Regression tests for the stuck-mouse bug: the game is spawned detached and outlives the launcher,
// so a grab left behind by a crashed or hung game was unreachable and the desktop lost the mouse
// until a reboot. The launcher now records PIDs, re-adopts them after a restart and stops the whole
// process group with a SIGKILL escalation.
async function testOrphanedGameProcesses() {
  section('orphaned game processes and the stuck pointer')
  const source = fs.readFileSync(MAIN_SOURCE, 'utf8')

  const start = source.indexOf('function isProcessAlive(')
  const end = source.indexOf('async function checkpointGameSessions()')
  check('the running-game helpers are still present', start >= 0 && end > start)
  const helpers = source.slice(start, end)
  check('adoption is wired into startup before the window opens',
    /adoptRunningGames\(\)[\s\S]*?createWindow\(\)/.test(
      source.slice(source.indexOf('app.whenReady()'))
    ))
  check('a re-adopted game is shown as running so Stop can reach it',
    /adopted: true/.test(helpers))
  check('a re-adopted process is verified against its jar before it is adopted',
    /isTrackedGameProcess\(pid, jarPath\)/.test(helpers))
  check('a recycled PID is rejected', /\/proc\/\$\{pid\}\/cmdline/.test(helpers))

  const stopStart = source.indexOf('function signalGameProcess(')
  const stopEnd = source.indexOf('function rendererWebPreferences()')
  check('the stop handler is still present', stopStart >= 0 && stopEnd > stopStart)
  const stop = source.slice(stopStart, stopEnd)
  check('stop signals the whole process group, not just the JVM',
    /process\.kill\(-pid, signal\)/.test(stop))
  check('stop escalates to SIGKILL when the JVM ignores SIGTERM', /'SIGKILL'/.test(stop))
  check('stop escalates only after a grace period', /GAME_STOP_GRACE_MS/.test(stop))
  check('a force-stopped session still clears the running state',
    /finishGameSession\(version\.id, sessionId, new Error\(/s.test(stop))
  check('stop no longer throws when the process is already gone',
    !/child\.kill\(\)\) throw/.test(stop))

  check('the session type is written to the launch log for the next report',
    /XDG_SESSION_TYPE/.test(source))
  check('an adopted session is not billed for playtime twice',
    /if \(session\.adopted\) continue/.test(source))
}

// ---------------------------------------------------------------- runner

async function main() {
  const tests = [
    testHappyPath, testUnknownSize, testResume, testResumeFromExistingPartial, testRangeIgnored,
    testCancellation, testDigestMismatch, testMissingArchive, testTruncatedBody,
    testProgressIsHonest, testRetryBackoffIsReported, testDownloadToFile, testTextDeadline,
    testInstallPipeline, testInstallSurvivesDrop, testCancelledInstallKeepsGame, testFailedInstallKeepsGame,
    testSweeper, testUpdaterDigest, testOrphanedGameProcesses
  ]
  for (const test of tests) {
    try {
      await test()
    } catch (error) {
      check(`${test.name} threw`, false, error?.message)
    }
  }
  await fsp.rm(workspace, { recursive: true, force: true })
  process.stdout.write(failures ? `\nFAILED: ${failures} check(s)\n` : `\nPASSED: all checks\n`)
  process.exitCode = failures ? 1 : 0
}

await main()
