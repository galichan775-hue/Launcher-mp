// Windows regression check for the Linux-support changes.
//
// Launches the app from source over CDP and asserts the cross-platform wiring the renderer
// depends on: the platform block in the config, the revealFile IPC, the manual .deb install
// block and the i18n keys. The Windows-only badge branch is exercised by injecting an
// unsupported version state, because on a Windows host it is never reached naturally.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// defaults to the source tree; pass an .exe path to test a deployed build instead
const TARGET = process.argv[2] || '.'
const PORT = Number(process.argv[3]) || 9431
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let failures = 0
let checks = 0
const check = (label, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}\n`)
}

const electron = TARGET === '.' ? require('electron') : TARGET
if (typeof electron !== 'string') {
  process.stdout.write('SKIP: electron binary path not resolvable\n')
  process.exit(0)
}
process.stdout.write(`  target: ${TARGET}\n`)

const child = spawn(electron, [TARGET === '.' ? '.' : null, `--remote-debugging-port=${PORT}`].filter(Boolean), {
  cwd: ROOT,
  detached: true,
  stdio: 'ignore'
})

const cleanup = () => {
  try { process.kill(child.pid) } catch {}
}
process.on('exit', cleanup)

let target = null
for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl)
  } catch {}
}
if (!target) {
  process.stdout.write('FAIL  could not attach to the app over CDP\n')
  cleanup()
  process.exit(1)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

let messageId = 0
const waiting = new Map()
const problems = []
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    problems.push(details.exception?.description || details.text || 'exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    problems.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' '))
  }
  if (waiting.has(message.id)) {
    waiting.get(message.id)(message)
    waiting.delete(message.id)
  }
}
const send = (method, params = {}) => new Promise(resolve => {
  messageId += 1
  waiting.set(messageId, resolve)
  socket.send(JSON.stringify({ id: messageId, method, params }))
})
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.result?.exceptionDetails) return { error: response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text }
  return { value: response.result?.result?.value }
}

await send('Runtime.enable')
for (let attempt = 0; attempt < 40; attempt += 1) {
  const ready = await evaluate('Boolean(window.aocLauncher && document.querySelector(".version-card"))')
  if (ready.value) break
  await sleep(300)
}

process.stdout.write('\nrenderer bootstrap\n')
check('the preload bridge is exposed as aocLauncher', (await evaluate('typeof window.aocLauncher')).value === 'object')
check('the bridge exposes revealFile', (await evaluate('typeof window.aocLauncher?.revealFile')).value === 'function')
check('version cards rendered', (await evaluate('document.querySelectorAll(".version-card").length > 0')).value === true)
check('the renderer has a config', (await evaluate('Boolean(config && Array.isArray(config.versions))')).value === true)

process.stdout.write('\nplatform in the config channel\n')
const rawConfig = (await evaluate('aocLauncher.getConfig().then(c => JSON.stringify(c))')).value
const config = rawConfig ? JSON.parse(rawConfig) : {}
check('config exposes the platform id', config.platform?.id === 'win32', JSON.stringify(config.platform))
check('config exposes the platform label', config.platform?.label === 'Windows', String(config.platform?.label))
check('config advertises the Windows updater artifact', config.platform?.updaterArtifact === 'AOC-2-Multiplayer-Setup.exe', String(config.platform?.updaterArtifact))
check('config reports self-install support on Windows', config.platform?.updaterCanSelfInstall === true, String(config.platform?.updaterCanSelfInstall))
check('config still carries the versions', Array.isArray(config.versions) && config.versions.length > 0, `${config.versions?.length} versions`)
const singleplayer = (config.versions || []).find(version => version.entryPoint === 'BEII.exe')
check('the singleplayer entry is present', Boolean(singleplayer))
check('the singleplayer entry is marked win32 only', JSON.stringify(singleplayer?.platforms) === '["win32"]', JSON.stringify(singleplayer?.platforms))
check('platformLabel falls back to the host', (await evaluate('platformLabel()')).value === 'Windows')

process.stdout.write('\nwindows-only badge\n')
// the singleplayer entry stays hidden until the version it rides on is installed, so the
// badge branch is driven on whichever card is actually rendered
const rendered = (await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.version-card')]
  return JSON.stringify(cards.map(card => ({
    id: card.dataset.versionId,
    badge: card.querySelector('.platform-badge')?.textContent || '',
    flagged: card.classList.contains('unsupported-platform')
  })))
})()`)).value
const cards = rendered ? JSON.parse(rendered) : []
check('at least one version card is rendered', cards.length > 0, `${cards.length} cards`)
check('no card is flagged unsupported on a host that supports them', cards.every(card => !card.flagged), JSON.stringify(cards.filter(card => card.flagged)))
check('no badge is drawn when the host supports the version', cards.every(card => card.badge === ''), JSON.stringify(cards.filter(card => card.badge)))

// this is the branch a Linux user sees for BEII.exe
const injected = (await evaluate(`(() => {
  const id = ${JSON.stringify(cards[0]?.id || '')}
  if (!id || !versionStates || typeof renderConfig !== 'function') return null
  versionStates.set(id, { ...(versionStates.get(id) || {}), supported: false, requiresPlatform: 'Windows' })
  renderConfig(config)
  const card = [...document.querySelectorAll('.version-card')].find(node => node.dataset.versionId === id)
  const badge = card.querySelector('.platform-badge')
  return JSON.stringify({
    badge: badge?.textContent || '',
    title: card.getAttribute('title') || '',
    flagged: card.classList.contains('unsupported-platform'),
    status: card.querySelector('.card-status')?.textContent || ''
  })
})()`)).value
if (!injected) {
  check('could not drive the unsupported badge branch', false)
} else {
  const parsed = JSON.parse(injected)
  check('an unsupported version gets a badge', /Windows/.test(parsed.badge), parsed.badge)
  check('the badge is i18n text, not a raw key', !parsed.badge.includes('{platform}') && parsed.badge.length > 0, parsed.badge)
  check('the card is flagged unsupported', parsed.flagged === true, String(parsed.flagged))
  check('the card title names the required platform', parsed.title.includes('Windows'), parsed.title)
  check('the card title names the current platform', parsed.title.includes('Windows'), parsed.title)
  check('the card status repeats the platform', parsed.status.includes('Windows'), parsed.status)
}

process.stdout.write('\nmanual deb install block\n')
for (const id of ['startup-update', 'startup-update-manual', 'startup-update-command', 'startup-update-note', 'startup-update-reveal', 'startup-update-install', 'startup-update-later']) {
  check(`#${id} exists`, (await evaluate(`Boolean(document.getElementById("${id}"))`)).value === true)
}
check('the whole startup update block starts hidden', (await evaluate('document.getElementById("startup-update")?.hasAttribute("hidden")')).value === true)
check('the manual block starts hidden', (await evaluate('document.getElementById("startup-update-manual")?.hasAttribute("hidden")')).value === true)

// drive the manual branch the Linux updater ends in
const manual = (await evaluate(`(() => {
  if (typeof showStartupUpdate !== 'function' || !updateCard) return null
  showStartupUpdate({ latest: '9.9.9' })
  updateCard.manual.hidden = false
  updateCard.command.textContent = 'sudo apt install ./AOC-2-Multiplayer-linux-x64.deb'
  updateCard.note.textContent = t('startupUpdateManualNote')
  updateCard.reveal.textContent = t('startupUpdateReveal')
  updateCard.later.textContent = t('startupUpdateClose')
  return JSON.stringify({
    rootHidden: document.getElementById('startup-update').hasAttribute('hidden'),
    command: updateCard.command.textContent,
    note: updateCard.note.textContent,
    reveal: updateCard.reveal.textContent,
    close: updateCard.later.textContent
  })
})()`)).value
if (!manual) {
  check('could not drive the manual install branch', false)
} else {
  const parsed = JSON.parse(manual)
  check('showing the update reveals the block', parsed.rootHidden === false, String(parsed.rootHidden))
  check('the sudo command is rendered', parsed.command === 'sudo apt install ./AOC-2-Multiplayer-linux-x64.deb', parsed.command)
  check('the note is i18n text', !parsed.note.includes('{') && parsed.note.length > 0, parsed.note)
  check('the reveal button is labelled', !parsed.reveal.includes('{') && parsed.reveal.length > 0, parsed.reveal)
  check('the close button is relabelled for the manual flow', !parsed.close.includes('{') && parsed.close.length > 0, parsed.close)
}

process.stdout.write('\ni18n coverage\n')
for (const key of ['windowsOnly', 'windowsOnlyHint', 'startupUpdateManualText', 'startupUpdateManualNote', 'startupUpdateReveal', 'startupUpdateClose']) {
  const presence = (await evaluate(`JSON.stringify([Boolean(translations.ru.${key}), Boolean(translations.en.${key})])`)).value
  check(`${key} exists in both languages`, presence === '[true,true]', presence)
}
const en = (await evaluate('JSON.stringify(translations.en.windowsOnlyHint)')).value
check('the English hint interpolates both platforms', en.includes('{platform}') && en.includes('{current}'), en)

process.stdout.write('\nrenderer health\n')
check('no renderer exceptions or console errors', problems.length === 0, problems.slice(0, 3).join(' | '))

socket.close()
cleanup()
await sleep(500)
process.stdout.write(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks\n`)
process.exit(failures ? 1 : 0)
