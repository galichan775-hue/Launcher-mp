// A downloader built for bad connections.
//
// A plain one-shot fetch is unusable for a 20-350 MB archive on a slow or mobile link:
//   * a single stall throws the whole transfer away and the user starts from zero again
//   * codeload builds archives on the fly and streams them chunked, so content-length is often
//     missing and a progress bar built on it has no denominator at all
//   * a socket timeout is an inactivity timeout, so one 30 s gap on a 100 KB/s link is fatal
//
// So the transfer is retried with backoff instead of failing, resumed with a Range request
// whenever the server honours one, given a stall window that grows as the link gets slower, and
// always reports the best total it can find: the size published in launcher-config.json, the one
// from content-length / content-range, or the one cached next to the partial file. Progress is
// never invented - without a total the caller is told so and the UI switches to an estimate.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const USER_AGENT = 'AOC-2-Multiplayer'
const MAX_ATTEMPTS = 10
// The first attempt gets a long window because it also pays for DNS, TLS and redirects on a
// link that may be crawling. Later attempts know the real speed and size the window from it.
const FIRST_STALL_MS = 90_000
const MIN_STALL_MS = 60_000
const MAX_STALL_MS = 600_000
const PROGRESS_INTERVAL_MS = 200
// A digest mismatch is worth one clean retry and no more: every attempt re-downloads the whole
// archive, so on a 100 KB/s link each extra try costs over an hour. After that the user is told
// the file is damaged instead of being handed an archive nobody verified.
const MAX_DIGEST_RETRIES = 2
const BACKOFF_MS = [0, 1500, 3000, 6000, 10_000, 20_000, 30_000, 45_000, 60_000, 90_000]

class CancelledError extends Error {
  constructor() {
    super('Загрузка отменена.')
    this.name = 'CancelledError'
    this.cancelled = true
  }
}

class DownloadError extends Error {
  constructor(message, { retryable = false, status = 0 } = {}) {
    super(message)
    this.name = 'DownloadError'
    this.retryable = retryable
    this.status = status
  }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const now = () => Date.now()

// Exponential moving average that also decays while nothing arrives, so a link that dies is
// reported as slow instead of as a stale high number.
class SpeedMeter {
  constructor() {
    this.value = 0
    this.at = Date.now()
    this.bytes = 0
  }

  add(bytes) {
    this.bytes += bytes
    const seconds = (Date.now() - this.at) / 1000
    if (seconds < 0.2) return this.value
    const sample = this.bytes / seconds
    this.value = this.value ? this.value * 0.65 + sample * 0.35 : sample
    this.at = now()
    this.bytes = 0
    return this.value
  }

  get bytesPerSecond() {
    const idle = (Date.now() - this.at) / 1000
    if (idle > 3) this.value *= Math.pow(0.5, idle / 3)
    return this.value
  }
}

// A link that delivers 10 KB/s legitimately pauses for a minute between bursts, while a fast one
// that pauses for 45 s is broken. Scale the grace period with the measured throughput, and be
// generous in general: codeload ignores Range, so a false stall means re-downloading hundreds of
// megabytes from zero.
function stallWindow(speedBytesPerSecond, attempt) {
  if (attempt <= 1) return FIRST_STALL_MS
  if (!speedBytesPerSecond) return MIN_STALL_MS
  const secondsForChunk = (128 * 1024) / speedBytesPerSecond
  return clamp(Math.round(secondsForChunk * 40_000), MIN_STALL_MS, MAX_STALL_MS)
}

function fileSize(file) {
  try {
    return fs.statSync(file).size
  } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError || error.code === 'ENOENT') return null
    throw error
  }
}

// The archive size is remembered next to the partial file. codeload omits content-length often
// enough that without this the next attempt at the same version would again have no denominator.
function rememberedTotal(metaPath, url) {
  const saved = readJson(metaPath)
  if (!saved || typeof saved !== 'object') return 0
  if (saved.url && url && saved.url !== url) return 0
  const total = Number(saved.total) || 0
  return total > 0 ? total : 0
}

function rememberTotal(metaPath, url, total) {
  if (!total || !metaPath) return
  try {
    const temporary = `${metaPath}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ url, total, at: new Date().toISOString() }))
    fs.renameSync(temporary, metaPath)
  } catch (error) {
    // A cache miss only costs a progress bar without a percentage, so it is never fatal.
  }
}

// GitHub answers 404 for a commit that no longer exists and 403 for one that was never pushed.
// Neither gets better by retrying, so those end the attempt loop with a readable message.
function httpError(status, response) {
  if (status === 404) return new DownloadError('Сервер не нашёл архив версии (HTTP 404). Возможно, репозиторий переименован.', { status })
  if (status === 401 || status === 403) return new DownloadError('GitHub отклонил запрос (HTTP 403). Проверь, что версия опубликована.', { status })
  if (status === 410) return new DownloadError('Архив версии больше недоступен (HTTP 410).', { status })
  if (status === 429) return new DownloadError('GitHub временно ограничил число запросов (HTTP 429).', { retryable: true, status })
  const error = new DownloadError(`Сервер загрузки вернул ошибку (HTTP ${status}).`, { retryable: status >= 500, status })
  if (response) error.retryInMs = retryAfterMs(response)
  return error
}

// A 429 or 503 may carry Retry-After, and ignoring it is how a client earns a longer ban.
function retryAfterMs(response) {
  const header = response.headers.get('retry-after')
  if (!header) return 0
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return clamp(seconds * 1000, 0, 120_000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? clamp(date - now(), 0, 120_000) : 0
}

function assertNotCancelled(signal) {
  if (signal?.aborted) throw new CancelledError()
}

function isCancellation(error, signal) {
  return signal?.aborted || error?.name === 'AbortError' || error instanceof CancelledError
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * One connection attempt: resume if the server allows it, append to the partial file, pump the
 * body in with backpressure and report progress. Rejects with a retryable DownloadError on any
 * stall or transport failure so the caller can reconnect instead of losing the whole transfer.
 */
async function transferOnce({ url, partialPath, from, signal, onProgress, attempt, speed }) {
  const headers = {
    'User-Agent': USER_AGENT,
    // Without this undici asks for gzip and transparently inflates the body, so content-length
    // describes the compressed transfer and the bar ends up far past 100% on a zip.
    'Accept-Encoding': 'identity',
    Accept: 'application/zip, application/octet-stream, */*'
  }
  if (from > 0) headers.Range = `bytes=${from}-`

  const response = await fetch(url, { headers, redirect: 'follow', signal })
  if (!response.ok && response.status !== 206) {
    await response.body?.cancel().catch(() => {})
    throw httpError(response.status, response)
  }

  // 206 means the server honoured the Range request, so the partial file is still good. A plain
  // 200 with bytes already on disk means the range was dropped and the file has to start over.
  const resumed = response.status === 206
  const declared = Number(response.headers.get('content-length')) || 0
  let total = 0
  if (resumed) {
    const range = response.headers.get('content-range')
    const match = range && /\/(\d+)\s*$/.exec(range)
    total = match ? Number(match[1]) : from + declared
  } else {
    total = declared
  }
  if (!resumed && from > 0) await fsp.rm(partialPath, { force: true })

  const startAt = resumed ? from : 0
  const file = startAt > 0
    ? fs.createWriteStream(partialPath, { flags: 'r+', start: startAt })
    : fs.createWriteStream(partialPath, { flags: 'w' })

  let received = startAt
  let writeError = null
  let abortError = null
  let lastReportAt = 0
  let stallTimer = null
  let done = false

  const finish = error => {
    if (done) return
    done = true
    clearTimeout(stallTimer)
    file.destroy()
    response.body?.cancel().catch(() => {})
    if (error) abortError = abortError || error
  }

  file.on('error', error => {
    writeError = new DownloadError(`Не удалось записать файл: ${error.message}`, { retryable: true })
  })

  const armStallTimer = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      finish(new DownloadError('Соединение зависло: данных нет дольше обычного.', { retryable: true }))
    }, stallWindow(speed.bytesPerSecond, attempt))
  }

  const report = force => {
    const at = Date.now()
    if (!force && at - lastReportAt < PROGRESS_INTERVAL_MS) return
    lastReportAt = at
    if (!onProgress) return
    try {
      onProgress({ received, total, speedBytesPerSecond: speed.bytesPerSecond, attempt, resumed })
    } catch (error) {
      // A broken listener must never kill a 300 MB transfer.
    }
  }

  const write = chunk => {
    if (file.write(chunk)) return null
    // Backpressure: wait for drain instead of queueing the whole archive in memory.
    return new Promise((resolve, reject) => {
      const settle = error => {
        clearTimeout(timer)
        file.off('drain', settle)
        file.off('error', settle)
        error ? reject(error) : resolve()
      }
      const timer = setTimeout(() => settle(new DownloadError('Запись на диск не продвигается.', { retryable: true })), 180_000)
      file.once('drain', settle)
      file.once('error', settle)
    })
  }

  try {
    armStallTimer()
    report(true)
    const reader = response.body.getReader()
    for (;;) {
      assertNotCancelled(signal)
      if (abortError) throw abortError
      if (writeError) throw writeError
      const { done: chunkDone, value } = await reader.read()
      if (chunkDone) break
      if (abortError) throw abortError
      if (!value || !value.byteLength) continue
      armStallTimer()
      received += value.byteLength
      const pending = write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
      if (pending) await pending
      speed.add(value.byteLength)
      report(false)
    }
    assertNotCancelled(signal)
    if (abortError) throw abortError
    await new Promise(resolve => file.end(resolve))
    if (writeError) throw writeError
    finish()
    // content-length is frequently absent, so the byte count on disk is the trustworthy total.
    const onDisk = fileSize(partialPath)
    report(true)
    return { received: onDisk, total: total || onDisk, resumed }
  } catch (error) {
    finish()
    if (isCancellation(error, signal)) throw new CancelledError()
    if (error instanceof DownloadError) throw error
    throw new DownloadError(error?.message || 'Соединение оборвалось.', { retryable: true })
  }
}

/**
 * Downloads a remote archive to `destination`, surviving flaky links.
 *
 * @param {object} options
 * @param {string} options.url               archive URL
 * @param {string} options.destination       final path of the finished file
 * @param {string} options.partialPath       where bytes accumulate between attempts and runs
 * @param {string} [options.metaPath]        sidecar that remembers the archive size
 * @param {number} [options.expectedTotal]   published size, used as the progress denominator
 * @param {string} [options.expectedSha256]  published digest, verified when present
 * @param {Function} [options.onProgress]    receives { received, total, speedBytesPerSecond, ... }
 * @param {AbortSignal} [options.signal]     user cancellation
 * @returns {Promise<{ path: string, bytes: number, total: number, attempts: number, verified: boolean }>}
 */
async function downloadFile(options) {
  const {
    url,
    destination,
    partialPath,
    metaPath = '',
    expectedTotal = 0,
    expectedSha256 = '',
    onProgress,
    signal
  } = options
  if (!url || !destination) throw new DownloadError('Не задан адрес загрузки.')

  await fsp.mkdir(path.dirname(destination), { recursive: true })
  if (partialPath) await fsp.mkdir(path.dirname(partialPath), { recursive: true })

  const speed = new SpeedMeter()
  const published = Number(expectedTotal) || 0
  let total = published || rememberedTotal(metaPath, url)
  let lastError = null
  let digestFailures = 0

  const emit = payload => {
    if (!onProgress) return
    try {
      onProgress(payload)
    } catch (error) {
      // never let a listener break the transfer
    }
  }
  const clearPartial = () => fsp.rm(partialPath, { force: true }).catch(() => {})

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    assertNotCancelled(signal)
    let from = fileSize(partialPath)
    if (from > 0 && total && from >= total) {
      // More bytes on disk than the archive has: the partial belongs to another build.
      await clearPartial()
      from = 0
    }
    if (total) emit({ received: from, total, speedBytesPerSecond: speed.bytesPerSecond, attempt, starting: true })

    try {
      const result = await transferOnce({ url, partialPath, from, signal, onProgress, attempt, speed })
      const bytes = fileSize(partialPath)
      if (published && bytes < published) {
        // A short body on a chunked response is a truncated transfer, not a smaller archive.
        throw new DownloadError('Загрузка оборвалась на середине архива.', { retryable: true })
      }
      // A body larger than the published size means the publication is stale, not the download.
      if (published && bytes !== published) total = bytes
      let verified = false
      if (expectedSha256) {
        const digest = await hashFile(partialPath)
        if (digest.toLowerCase() !== String(expectedSha256).toLowerCase()) {
          // The URLs are commit-pinned and codeload builds them deterministically, so a mismatch
          // is a damaged transfer. Each attempt costs a full re-download though, which on a slow
          // link is an hour of data, so the number of extra tries is capped.
          digestFailures += 1
          await clearPartial()
          if (digestFailures >= MAX_DIGEST_RETRIES) {
            throw new DownloadError(
              'Архив не прошёл проверку целостности после нескольких попыток. Скачался повреждённый файл — сообщи об этом разработчику.',
              { retryable: false }
            )
          }
          throw new DownloadError('Контрольная сумма архива не совпала: файл повреждён.', { retryable: true })
        }
        verified = true
      }
      total = total || result.total || bytes
      rememberTotal(metaPath, url, total)
      await fsp.rename(partialPath, destination)
      emit({ received: bytes, total, speedBytesPerSecond: speed.bytesPerSecond, attempt, done: true })
      return { path: destination, bytes, total, attempts: attempt, verified }
    } catch (error) {
      if (isCancellation(error, signal)) throw new CancelledError()
      lastError = error
      const retryable = error instanceof DownloadError ? error.retryable : true
      if (!retryable || attempt >= MAX_ATTEMPTS) break
      const wait = Math.max(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)], Number(error.retryInMs) || 0)
      emit({
        received: fileSize(partialPath),
        total,
        speedBytesPerSecond: speed.bytesPerSecond,
        attempt,
        retrying: true,
        // The UI shows this so a paused bar reads as "reconnecting", not "hung".
        retryInMs: wait,
        error: error.message
      })
      await sleep(wait)
    }
  }

  if (signal?.aborted) throw new CancelledError()
  const received = fileSize(partialPath)
  const suffix = received ? ` Уже скачано ${received} байт - следующая попытка продолжит с этого места.` : ''
  // The loop has given up, but whether a fresh attempt could still help is decided by the last
  // error: a missing archive or a damaged file stays terminal, a flaky link does not.
  throw new DownloadError((lastError?.message || 'Загрузка не удалась.') + suffix, {
    retryable: lastError instanceof DownloadError ? lastError.retryable : true,
    status: lastError instanceof DownloadError ? lastError.status : 0
  })
}

// The launcher package is 90 MB, so its update needs the same treatment as a mod download: a
// socket-inactivity timeout, no resume and no retry used to kill it halfway on a slow link.
async function downloadToFile({ url, destination, expectedTotal = 0, expectedSha256 = '', onProgress, signal }) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  await fsp.rm(destination, { force: true }).catch(() => {})
  return downloadFile({
    url,
    destination,
    partialPath: `${destination}.part`,
    metaPath: `${destination}.part.json`,
    expectedTotal,
    expectedSha256,
    onProgress,
    signal
  })
}

// Small text fetches (version markers on raw.githubusercontent.com) need a deadline as well: five
// sequential 8 s timeouts used to hold the startup screen hostage on a weak connection.
async function fetchTextWithDeadline(url, { timeoutMs = 6000, attempts = 2, signal } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const forward = () => controller.abort()
    if (signal?.aborted) throw new CancelledError()
    signal?.addEventListener('abort', forward, { once: true })
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity' },
        signal: controller.signal,
        redirect: 'follow'
      })
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {})
        throw new DownloadError('HTTP ' + response.status)
      }
      return await response.text()
    } catch (error) {
      if (isCancellation(error, signal)) throw new CancelledError()
      lastError = controller.signal.aborted ? new Error('timeout') : error
      if (attempt < attempts) await sleep(400 * attempt)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forward)
    }
  }
  throw lastError || new Error('request failed')
}

module.exports = {
  CancelledError,
  DownloadError,
  MAX_ATTEMPTS,
  SpeedMeter,
  downloadFile,
  downloadToFile,
  fetchTextWithDeadline,
  fileSize,
  httpError,
  rememberTotal,
  rememberedTotal,
  retryAfterMs,
  stallWindow
}
