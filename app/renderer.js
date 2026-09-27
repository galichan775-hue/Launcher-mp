const translations = {
  ru: {
    versions: 'Версии',
    aboutMod: 'О моде',
    settings: 'Настройки',
    editProfile: 'Настроить профиль',
    playerProfile: 'ПРОФИЛЬ ИГРОКА',
    editProfileTitle: 'Настроить профиль',
    nickname: 'Никнейм',
    avatar: 'Аватар',
    chooseAvatar: 'Выбрать изображение',
    saveProfile: 'Сохранить',
    cancel: 'Отмена',
    neverPlayed: 'Ещё не запускалась',
    readyToPlay: 'Готово к игре',
    versionsSubtitle: 'Управляй игрой и следи за временем в игре.',
    openGameFolder: 'Папка игры',
    selectExistingGame: 'Выбрать папку игры',
    resetGameFolder: 'Сбросить папку',
    searchingGame: 'Ищем AoH2MP.jar на дисках…',
    gameSearchFailed: 'Не удалось просканировать диски: {error}',
    gameFolderSelected: 'Игра найдена. Теперь запускай её кнопкой «Играть».',
    gameFolderReset: 'Возвращена папка игр рядом с лаунчером.',
    gameFolderInvalid: 'В выбранной папке не найден AoH2MP.jar. Выбери папку, где лежит рабочая игра.',
    installedVersionHeading: 'Версия мода',
    versionListHint: 'Age of History II · Multiplayer',
    gameOverview: 'ОБЗОР ИГРЫ',
    playTime: 'Время в игре',
    lastPlayed: 'Последний запуск',
    sessions: 'Сеансы',
    added: 'Добавлено',
    changed: 'Изменено',
    removed: 'Удалено',
    noChanges: 'Список изменений пока не добавлен.',
    download: 'Скачать',
    play: 'Играть',
    stop: 'Остановить',
    playing: 'Игра запущена',
    uninstall: 'Удалить',
    openVersionFolder: 'Файлы игры',
    installLocation: 'Расположение игры',
    open: 'Открыть',
    javaRequired: 'Для запуска требуется Java 17 или новее.',
    creators: 'СОЗДАТЕЛИ',
    projectCreators: 'Авторы проекта',
    settingsEyebrow: 'ПРИЛОЖЕНИЕ',
    settingsSubtitle: 'Игровые файлы и оформление приложения.',
    gameFolder: 'Папка игры',
    gameFolderDescription: 'Файлы игры хранятся рядом с лаунчером в папке Games.',
    customizeLauncher: 'Настройка лаунчера',
    customizeDescription: 'Логотип, баннер, описание и авторы настраиваются в исходниках приложения.',
    languageSetting: 'Язык интерфейса можно переключить в правом верхнем углу.',
    javaRequiredEyebrow: 'ТРЕБУЕТСЯ JAVA',
    javaRequiredTitle: 'Установи Java, чтобы играть',
    javaRequiredDescription: 'Для запуска AoH2MP нужна Java 17 или новее. Откроем официальную страницу загрузки Java.',
    downloadJava: 'Скачать Java 17',
    later: 'Позже',
    checkJava: 'Проверить снова',
    javaStillMissing: 'Java 17 не найдена. Установи её и попробуй ещё раз.',
    javaFound: 'Java найдена · запускаю игру',
    javaDownloadOpened: 'Открыта страница загрузки Java. После установки вернись и нажми «Играть».',
    installFirst: 'Сначала скачай игру.',
    downloadConfirm: 'Скачать Bloody Europe 1.9.3? Архив содержит файлы игры и может занимать несколько сотен мегабайт.',
    downloadStarted: 'Подготовка загрузки…',
    launchStarted: 'Запускаю игру…',
    gameExitedError: 'Игра завершилась с ошибкой: {error}',
    launchLogSaved: 'Подробности запуска сохранены. Открой журнал запуска для диагностики.',
    openLaunchLog: 'Журнал запуска',
    openLastCrash: 'Лог последнего краша',
    noCrashFound: 'Крашей не найдено',
    profileImageError: 'Не удалось загрузить это изображение. Выбери PNG, JPEG, WebP или GIF.',
    installedMessage: 'Bloody Europe 1.9.3 установлена',
    deletedMessage: 'Bloody Europe 1.9.3 удалена',
    deleteConfirm: 'Удалить файлы Bloody Europe 1.9.3? Время игры и статистика останутся.',
    downloadError: 'Не удалось скачать игру.',
    installError: 'Не удалось установить игру.',
    deleteError: 'Не удалось удалить игру.',
    launchError: 'Не удалось запустить игру.',
    configError: 'Не удалось загрузить настройки лаунчера.',
    statsError: 'Не удалось обновить статистику игры.',
    downloading: 'Загружаем файлы игры',
    downloadSource: 'Загрузка игровых файлов · можно свернуть окно',
    preparingFiles: 'Проверяем файлы и готовим игру…',
    verifyingFiles: 'Проверка файлов игры и подготовка к первому запуску',
    installed: 'Игра установлена',
    gameReady: 'Готово к запуску',
    wait: 'Осталось',
    starting: 'Запуск',
    justNow: 'Только что',
    minutesAgo: '{count} мин. назад',
    hoursAgo: '{count} ч. назад',
    daysAgo: '{count} дн. назад',
    hoursUnit: 'ч.',
    minutesUnit: 'мин.',
    neverInstalled: '—',
    launchedToast: 'Игра закрыта · статистика обновлена',
    language: 'Язык интерфейса',
    stoppingGame: 'Останавливаю игру…',
    updateChecking: 'Проверка обновления...',
    startupInitializing: 'Инициализация...',
    startupLoadingVersions: 'Загрузка версий...',
    startupCheckingUpdates: 'Проверка обновлений...',
    startupReady: 'Готово',
    startupUpdateTitle: 'Доступно обновление',
    startupUpdateText: 'Версия {version} готова к загрузке. Установка займёт несколько секунд.',
    startupUpdateInstall: 'Обновить',
    startupUpdateLater: 'Позже',
    startupUpdateDownloading: 'Загружаю обновление {version}...',
    startupUpdateStarted: 'Установщик запущен. Завершите обновление и перезапустите лаунчер.',
    updateDownloading: 'Загружаем обновление лаунчера',
    updateReady: 'Обновление лаунчера загружено. Перезапусти лаунчер для установки.',
    updateInstall: 'Перезапустить и обновить',
    updateLater: 'Позже',
    updateTitle: 'Обновление готово',
    updateDescription: 'Новая версия уже скачана. Перезапусти лаунчер, чтобы установить её.',
    updateError: 'Не удалось проверить обновление лаунчера.',
    launcherUpToDate: 'Установлена последняя версия лаунчера.',
    languagePickerEyebrow: 'ИНТЕРФЕЙС',
    languagePickerTitle: 'Выбери язык',
    confirmEyebrow: 'ПОДТВЕРЖДЕНИЕ',
    confirmAccept: 'Подтвердить',
    confirmCancel: 'Отмена',
    confirmDownloadTitle: 'Скачать версию?',
    confirmDeleteTitle: 'Удалить версию?',
    crashEyebrow: 'ОШИБКА ЗАПУСКА',
    crashTitle: 'Игра завершилась с ошибкой',
    crashDescription: 'Заполни форму, сохрани отчет вместе с журналом и прикрепи файл в поддержку.',
    crashSubject: 'Тема',
    crashDetails: 'Что произошло?',
    crashCreateReport: 'Сохранить отчет с логом',
    crashSendReport: 'Сообщить об ошибке',
    crashReportCopied: 'Текст ошибки скопирован. Вставь его в чат и прикрепи файл журнала.',
    crashOpenLogFolder: 'Открыть папку с логом',
    updateAvailable: 'Доступно обновление',
    updateMod: 'Обновить',
    rollback: 'Откатиться',
    installed: 'Установлена',
    modUpdatesFound: 'Доступны обновления модов: {count}.',
    updateConfirmVersion: 'Обновить {name} до последнего коммита? {message}',
    rollbackConfirmVersion: 'Установить {name} на коммит {short}? Текущая папка сохранится как .bak.',
    rollbackBackupCreated: 'Резервная копия: {path}',
    commitsLoading: 'Загружаю историю коммитов...',
    commitsUnavailable: 'История коммитов недоступна.',
    commitsNoInstalledVersions: 'Сначала установи хотя бы одну версию мода.',
    manageModVersions: 'Управление версиями мода',
    manageModVersionsDescription: 'Выбери коммит из истории репозитория, чтобы установить или откатить мод на нужную версию. Текущая папка сохраняется как резервная копия .bak.',
    crashAttachHint: 'После сохранения прикрепи отчет к сообщению в Discord поддержки.',
    reportSaved: 'Отчет сохранен. Прикрепи файл к сообщению в Discord.',
    archiveTooLarge: 'Архив слишком большой (больше 1 ГБ) и не будет распакован.',
    descriptionExpand: 'Показать полностью',
    descriptionCollapse: 'Свернуть описание',
    versionCommitMissing: 'Эта версия пока не опубликована. Скачивание станет доступно после добавления коммита в launcher-config.json.',
    versionNotPublished: 'Ожидает публикации',
    downloadConfirmVersion: 'Скачать {name}? Архив может занимать несколько сотен мегабайт.',
    deleteConfirmVersion: 'Удалить файлы {name}? Время игры и статистика останутся.',
    installedVersionMessage: '{name} установлена',
    deletedVersionMessage: '{name} удалена',
    closeMessage: 'Понятно',
    downloadErrorTitle: 'Не удалось загрузить версию',
    extractingFiles: 'Распаковка файлов · {percent}%',
    unpacked: 'распаковано',
    calculating: 'Расчёт…'
  },
  en: {
    versions: 'Versions',
    aboutMod: 'About the mod',
    settings: 'Settings',
    editProfile: 'Edit profile',
    playerProfile: 'PLAYER PROFILE',
    editProfileTitle: 'Customize profile',
    nickname: 'Nickname',
    avatar: 'Avatar',
    chooseAvatar: 'Choose an image',
    saveProfile: 'Save',
    cancel: 'Cancel',
    neverPlayed: 'Never played',
    readyToPlay: 'Ready to play',
    versionsSubtitle: 'Manage the game and keep track of your playtime.',
    openGameFolder: 'Game folder',
    selectExistingGame: 'Choose game folder',
    resetGameFolder: 'Reset folder',
    searchingGame: 'Searching drives for AoH2MP.jar…',
    gameSearchFailed: 'Could not search the drives: {error}',
    gameFolderSelected: 'Game found. You can now launch it with Play.',
    gameFolderReset: 'Using the Games folder beside the launcher again.',
    gameFolderInvalid: 'AoH2MP.jar was not found there. Choose the folder containing the working game.',
    installedVersionHeading: 'Mod version',
    versionListHint: 'Age of History II · Multiplayer',
    gameOverview: 'GAME OVERVIEW',
    playTime: 'Play time',
    lastPlayed: 'Last played',
    sessions: 'Sessions',
    added: 'Added',
    changed: 'Changed',
    removed: 'Removed',
    noChanges: 'No changelog has been added yet.',
    download: 'Download',
    play: 'Play',
    stop: 'Stop',
    playing: 'Game is running',
    uninstall: 'Uninstall',
    openVersionFolder: 'Game files',
    installLocation: 'Install location',
    open: 'Open',
    javaRequired: 'Java 17 or newer is required to play.',
    creators: 'CREDITS',
    projectCreators: 'Project creators',
    settingsEyebrow: 'APPLICATION',
    settingsSubtitle: 'Game files and launcher appearance.',
    gameFolder: 'Game folder',
    gameFolderDescription: 'Game files are stored in a Games folder beside the launcher.',
    customizeLauncher: 'Customize the launcher',
    customizeDescription: 'The logo, banner, description and creators are configured in the app source files.',
    languageSetting: 'Change the interface language in the top-right corner.',
    javaRequiredEyebrow: 'JAVA REQUIRED',
    javaRequiredTitle: 'Install Java to play',
    javaRequiredDescription: 'AoH2MP requires Java 17 or newer. Open the official Java download page?',
    downloadJava: 'Download Java 17',
    later: 'Later',
    checkJava: 'Check again',
    javaStillMissing: 'Java 17 was not found. Install it, then try again.',
    javaFound: 'Java found · launching the game',
    javaDownloadOpened: 'Java download page opened. Install Java, then return and press Play.',
    installFirst: 'Download the game first.',
    downloadConfirm: 'Download Bloody Europe 1.9.3? The archive contains game files and may be several hundred megabytes.',
    downloadStarted: 'Preparing download…',
    launchStarted: 'Launching the game…',
    gameExitedError: 'The game exited with an error: {error}',
    launchLogSaved: 'Launch details were saved. Open the launch log to diagnose the problem.',
    openLaunchLog: 'Launch log',
    openLastCrash: 'Last crash log',
    noCrashFound: 'No crashes found',
    profileImageError: 'Could not load this image. Choose PNG, JPEG, WebP, or GIF.',
    installedMessage: 'Bloody Europe 1.9.3 installed',
    deletedMessage: 'Bloody Europe 1.9.3 removed',
    deleteConfirm: 'Remove Bloody Europe 1.9.3 files? Playtime and stats will be kept.',
    downloadError: 'Could not download the game.',
    installError: 'Could not install the game.',
    deleteError: 'Could not remove the game.',
    launchError: 'Could not launch the game.',
    configError: 'Could not load launcher settings.',
    statsError: 'Could not update game statistics.',
    downloading: 'Downloading game files',
    downloadSource: 'Downloading game files · you can minimize this window',
    preparingFiles: 'Checking files and preparing the game…',
    verifyingFiles: 'Verifying game files and preparing for first launch',
    installed: 'Game installed',
    gameReady: 'Ready to play',
    wait: 'Remaining',
    starting: 'Starting',
    justNow: 'Just now',
    minutesAgo: '{count} min ago',
    hoursAgo: '{count} hr ago',
    daysAgo: '{count} days ago',
    hoursUnit: 'hr',
    minutesUnit: 'min',
    neverInstalled: '—',
    launchedToast: 'Game closed · stats updated',
    language: 'Interface language',
    stoppingGame: 'Stopping the game…',
    updateChecking: 'Checking for updates...',
    startupInitializing: 'Initializing...',
    startupLoadingVersions: 'Loading versions...',
    startupCheckingUpdates: 'Checking for updates...',
    startupReady: 'Ready',
    startupUpdateTitle: 'Update available',
    startupUpdateText: 'Version {version} is ready to download. Installing takes only a few seconds.',
    startupUpdateInstall: 'Update',
    startupUpdateLater: 'Later',
    startupUpdateDownloading: 'Downloading update {version}...',
    startupUpdateStarted: 'Installer started. Finish the update and restart the launcher.',
    updateDownloading: 'Downloading launcher update',
    updateReady: 'Launcher update downloaded. Restart to install it.',
    updateInstall: 'Restart and update',
    updateLater: 'Later',
    updateTitle: 'Update ready',
    updateDescription: 'The new version is downloaded. Restart the launcher to install it.',
    updateError: 'Could not check for launcher updates.',
    launcherUpToDate: 'The launcher is up to date.',
    languagePickerEyebrow: 'INTERFACE',
    languagePickerTitle: 'Choose a language',
    confirmEyebrow: 'CONFIRMATION',
    confirmAccept: 'Continue',
    confirmCancel: 'Cancel',
    confirmDownloadTitle: 'Download this version?',
    confirmDeleteTitle: 'Remove this version?',
    crashEyebrow: 'LAUNCH ERROR',
    crashTitle: 'The game closed unexpectedly',
    crashDescription: 'Fill in the form, save the report with the launch log, and attach it when contacting support.',
    crashSubject: 'Subject',
    crashDetails: 'What happened?',
    crashCreateReport: 'Save report with log',
    crashSendReport: 'Report the error',
    crashReportCopied: 'The error text is copied. Paste it into the chat and attach the log file.',
    crashOpenLogFolder: 'Open log folder',
    updateAvailable: 'Update available',
    updateMod: 'Update',
    rollback: 'Roll back',
    installed: 'Installed',
    modUpdatesFound: 'Mod updates available: {count}.',
    updateConfirmVersion: 'Update {name} to the latest commit? {message}',
    rollbackConfirmVersion: 'Install {name} from commit {short}? The current folder is kept as .bak.',
    rollbackBackupCreated: 'Backup: {path}',
    commitsLoading: 'Loading commit history...',
    commitsUnavailable: 'Commit history is unavailable.',
    commitsNoInstalledVersions: 'Install at least one mod version first.',
    manageModVersions: 'Manage mod versions',
    manageModVersionsDescription: 'Pick a commit from the repository history to install or roll the mod back. The current folder is kept as a .bak backup.',
    crashAttachHint: 'After saving, attach the report to your support Discord message.',
    reportSaved: 'Report saved. Attach the file to your Discord message.',
    archiveTooLarge: 'The archive is larger than 1 GB and cannot be extracted.',
    descriptionExpand: 'Show full description',
    descriptionCollapse: 'Collapse description',
    versionCommitMissing: 'This version is not published yet. Add its commit in launcher-config.json to enable downloads.',
    versionNotPublished: 'Awaiting publication',
    downloadConfirmVersion: 'Download {name}? The archive may be several hundred megabytes.',
    deleteConfirmVersion: 'Remove {name} files? Playtime and stats will be kept.',
    installedVersionMessage: '{name} installed',
    deletedVersionMessage: '{name} removed',
    closeMessage: 'Got it',
    downloadErrorTitle: 'Could not download this version',
    extractingFiles: 'Extracting files · {percent}%',
    unpacked: 'extracted',
    calculating: 'Calculating…'
  }
}

const pages = Object.fromEntries(
  ['library', 'screenshots', 'settings'].map((name) => [name, document.getElementById(`page-${name}`)])
)
const versionGrid = document.getElementById('version-grid')
const versionStates = new Map()
const versionUpdates = new Map()
let pendingRepoUpdate = null
const toast = document.getElementById('toast')
const notificationStack = document.getElementById('notification-stack')
let config
let selectedVersion
let versionsDirectory = ''
let javaAvailable = false
let language = 'ru'
let busy = false
let toastTimeout
let notificationIdSeed = 0
let statsErrorShown = false
let profileAvatarData = ''
let profileAvatarPos = { x: 50, y: 50 }
let targetProgress = 0
let displayedProgress = 0
let progressFrameAt = 0
let progressFrame = 0
let crashVersionId = null
let extractionSample = null

function confirmAction({ title, message, acceptLabel }) {
  const dialog = document.getElementById('confirm-dialog')
  document.getElementById('confirm-title').textContent = title
  document.getElementById('confirm-message').textContent = message
  document.getElementById('confirm-accept').textContent = acceptLabel
  document.getElementById('confirm-cancel').textContent = t('confirmCancel')
  dialog.showModal()
  return new Promise(resolve => {
    const finish = result => {
      dialog.close()
      document.getElementById('confirm-accept').removeEventListener('click', accept)
      document.getElementById('confirm-cancel').removeEventListener('click', cancel)
      dialog.removeEventListener('cancel', onCancel)
      resolve(result)
    }
    const accept = () => finish(true)
    const cancel = () => finish(false)
    const onCancel = event => {
      event.preventDefault()
      cancel()
    }
    document.getElementById('confirm-accept').addEventListener('click', accept, { once: true })
    document.getElementById('confirm-cancel').addEventListener('click', cancel, { once: true })
    dialog.addEventListener('cancel', onCancel, { once: true })
  })
}

function showCrashDialog(error) {
  crashVersionId = selectedVersion?.id || null
  document.getElementById('crash-subject').value = selectedVersion
    ? `${selectedVersion.name}: ${language === 'en' ? 'launch failed' : 'ошибка запуска'}`
    : t('crashTitle')
  document.getElementById('crash-details').value = error || ''
  document.getElementById('crash-dialog').showModal()
}

function showMessage(title, message) {
  document.getElementById('message-title').textContent = title
  document.getElementById('message-body').textContent = message
  document.getElementById('message-dialog').showModal()
}

document.addEventListener('copy', event => {
  if (event.target instanceof HTMLElement && event.target.matches('input,textarea,[contenteditable="true"]')) return
  event.preventDefault()
})
document.addEventListener('cut', event => {
  if (event.target instanceof HTMLElement && event.target.matches('input,textarea,[contenteditable="true"]')) return
  event.preventDefault()
})

function t(key, values = {}) {
  let message = translations[language][key] || translations.ru[key] || key
  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{${name}}`, value)
  }
  return message
}

function icon(name, className = 'icon') {
  return `<img class="${className} asset-icon" src="assets/icons/${name}.png" alt="" />`
}

function notify(message, error = false) {
  const item = document.createElement('div')
  item.className = `notification-card ${error ? 'notification-error' : 'notification-info'}`
  item.dataset.id = String(++notificationIdSeed)
  const icon = document.createElement('span')
  icon.className = 'notification-icon'
  icon.textContent = error ? '!' : '✓'
  const content = document.createElement('div')
  content.className = 'notification-copy'
  const title = document.createElement('strong')
  title.textContent = error ? 'Ошибка' : 'Готово'
  const text = document.createElement('span')
  text.textContent = message
  content.append(title, text)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'notification-close'
  close.setAttribute('aria-label', 'Закрыть уведомление')
  close.textContent = '×'
  close.addEventListener('click', () => item.remove())
  const bar = document.createElement('span')
  bar.className = 'notification-progress'
  item.append(icon, content, close, bar)
  notificationStack.append(item)
  requestAnimationFrame(() => item.classList.add('visible'))
  const timeout = setTimeout(() => {
    item.classList.remove('visible')
    setTimeout(() => item.remove(), 260)
  }, 5200)
  item.dataset.timeout = String(timeout)
  return item
}

function initials(name) {
  return [...(name.trim() || 'A')][0].toLocaleUpperCase()
}

function setAvatar(element, letterElement, name) {
  letterElement.textContent = initials(name)
  element.classList.toggle('has-avatar-image', Boolean(profileAvatarData))
  element.style.backgroundImage = profileAvatarData ? `url("${profileAvatarData}")` : ''
  if (profileAvatarPos && typeof profileAvatarPos.x === 'number' && typeof profileAvatarPos.y === 'number') {
    element.style.backgroundPosition = `${profileAvatarPos.x}% ${profileAvatarPos.y}%`
  } else {
    element.style.backgroundPosition = '50% 50%'
  }
}

function renderProfile() {
  let profile
  try {
    profile = JSON.parse(localStorage.getItem('aoc-player-profile') || '{}')
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    profile = {}
  }
  const name = typeof profile.name === 'string' && profile.name.trim()
    ? profile.name.trim().slice(0, 24)
    : (language === 'en' ? 'Player' : 'Игрок')
  profileAvatarData = typeof profile.avatar === 'string' && profile.avatar.startsWith('data:image/')
    ? profile.avatar
    : ''
  profileAvatarPos = profile.avatarPosition && typeof profile.avatarPosition.x === 'number' && typeof profile.avatarPosition.y === 'number'
    ? profile.avatarPosition
    : { x: 50, y: 50 }
  document.getElementById('sidebar-player-name').textContent = name
  document.getElementById('profile-name-input').value = name
  // update position sliders if present
  const px = document.getElementById('avatar-pos-x')
  const py = document.getElementById('avatar-pos-y')
  if (px) px.value = profileAvatarPos.x
  if (py) py.value = profileAvatarPos.y
  setAvatar(document.getElementById('sidebar-avatar'), document.getElementById('sidebar-avatar-letter'), name)
  setAvatar(document.getElementById('topbar-avatar'), document.getElementById('topbar-avatar-letter'), name)
  setAvatar(document.getElementById('dialog-avatar'), document.getElementById('dialog-avatar-letter'), name)
}

function openProfileDialog() {
  renderProfile()
  document.getElementById('profile-dialog').showModal()
}

function setLanguage(nextLanguage) {
  language = nextLanguage === 'en' ? 'en' : 'ru'
  document.documentElement.lang = language
  document.getElementById('language-select').value = language
  document.getElementById('language-select').setAttribute('aria-label', t('language'))
  document.getElementById('language-current').textContent = language === 'en' ? 'English' : 'Русский'
  document.querySelectorAll('.language-option').forEach(option => {
    option.classList.toggle('selected', option.dataset.language === language)
  })
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n)
  }
  const currentPage = document.querySelector('.nav-item.selected')?.dataset.page || 'library'
  const currentKey = currentPage === 'library' ? 'versions' : currentPage === 'screenshots' ? 'aboutMod' : 'settings'
  document.getElementById('current-section').textContent = t(currentKey)
  if (config) renderConfig(config)
  renderVersionDetails(selectedVersion)
  renderSelectedVersion()
}

function navigate(name) {
  if (!pages[name]) return
  for (const [key, page] of Object.entries(pages)) page.classList.toggle('active', key === name)
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('selected', button.dataset.page === name)
  })
  const key = name === 'library' ? 'versions' : name === 'screenshots' ? 'aboutMod' : 'settings'
  document.getElementById('current-section').textContent = t(key)
  if (name === 'settings') renderCommitList()
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => navigate(button.dataset.page))
})
document.querySelectorAll('[data-go-library]').forEach((button) => {
  button.addEventListener('click', () => navigate('library'))
})
document.getElementById('language-picker').addEventListener('click', () => document.getElementById('language-dialog').showModal())
document.getElementById('close-language-dialog').addEventListener('click', () => document.getElementById('language-dialog').close())
document.querySelectorAll('.language-option').forEach(option => {
  option.addEventListener('click', () => {
    setLanguage(option.dataset.language)
    document.getElementById('language-dialog').close()
  })
})
document.getElementById('message-close').addEventListener('click', () => document.getElementById('message-dialog').close())
document.getElementById('edit-profile').addEventListener('click', openProfileDialog)
document.getElementById('topbar-avatar').addEventListener('click', openProfileDialog)
document.getElementById('close-profile-dialog').addEventListener('click', () => document.getElementById('profile-dialog').close())
document.getElementById('cancel-profile').addEventListener('click', () => document.getElementById('profile-dialog').close())
async function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl.startsWith('data:image/')) {
        reject(new Error(t('profileImageError')))
        return
      }
      resolve(dataUrl)
    }
    reader.onerror = () => reject(new Error(t('profileImageError')))
    reader.readAsDataURL(file)
  })
}

async function applyAvatarFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error(t('profileImageError'))
  }

  const dataUrl = await readImageFileAsDataUrl(file)
  const image = new Image()
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error(t('profileImageError')))
    image.src = dataUrl
  })

  const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)

  const mime = file.type || 'image/png'
  try {
    profileAvatarData = canvas.toDataURL(mime, 0.82)
  } catch (error) {
    profileAvatarData = canvas.toDataURL('image/png', 0.82)
  }

  const name = document.getElementById('profile-name-input').value
  setAvatar(document.getElementById('dialog-avatar'), document.getElementById('dialog-avatar-letter'), name)
}

const profileAvatarInput = document.getElementById('profile-avatar-input')
const dialogAvatar = document.getElementById('dialog-avatar')

profileAvatarInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    await applyAvatarFile(file)
  } catch (error) {
    notify(error.message || t('profileImageError'), true)
  } finally {
    event.target.value = ''
  }
})

dialogAvatar.addEventListener('click', () => {
  profileAvatarInput.click()
})

dialogAvatar.addEventListener('dragover', (event) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dialogAvatar.classList.add('avatar-drop-target')
})

dialogAvatar.addEventListener('dragleave', (event) => {
  if (!dialogAvatar.contains(event.relatedTarget)) {
    dialogAvatar.classList.remove('avatar-drop-target')
  }
})

dialogAvatar.addEventListener('drop', async (event) => {
  event.preventDefault()
  dialogAvatar.classList.remove('avatar-drop-target')
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  try {
    await applyAvatarFile(file)
  } catch (error) {
    notify(error.message || t('profileImageError'), true)
  }
})
document.getElementById('save-profile').addEventListener('click', () => {
  const name = document.getElementById('profile-name-input').value.trim().slice(0, 24) || (language === 'en' ? 'Player' : 'Игрок')
  try {
    localStorage.setItem('aoc-player-profile', JSON.stringify({ name, avatar: profileAvatarData, avatarPosition: profileAvatarPos }))
  } catch (error) {
    notify(error.message || t('profileImageError'), true)
    return
  }
  renderProfile()
  document.getElementById('profile-dialog').close()
})
document.getElementById('profile-name-input').addEventListener('input', (event) => {
  setAvatar(document.getElementById('dialog-avatar'), document.getElementById('dialog-avatar-letter'), event.target.value)
})

// avatar position sliders
const pxInput = document.getElementById('avatar-pos-x')
const pyInput = document.getElementById('avatar-pos-y')
if (pxInput && pyInput) {
  const updatePos = () => {
    const x = parseInt(pxInput.value, 10) || 50
    const y = parseInt(pyInput.value, 10) || 50
    profileAvatarPos = { x, y }
    const dialogAvatar = document.getElementById('dialog-avatar')
    const sidebarAvatar = document.getElementById('sidebar-avatar')
    const topbarAvatar = document.getElementById('topbar-avatar')
    if (dialogAvatar) dialogAvatar.style.backgroundPosition = `${x}% ${y}%`
    if (sidebarAvatar) sidebarAvatar.style.backgroundPosition = `${x}% ${y}%`
    if (topbarAvatar) topbarAvatar.style.backgroundPosition = `${x}% ${y}%`
  }
  pxInput.addEventListener('input', updatePos)
  pyInput.addEventListener('input', updatePos)
}
document.getElementById('description-toggle').addEventListener('click', event => {
  const description = document.getElementById('version-description')
  const expanded = description.classList.toggle('expanded')
  description.classList.toggle('collapsed', !expanded)
  event.currentTarget.textContent = t(expanded ? 'descriptionCollapse' : 'descriptionExpand')
})
document.getElementById('open-launch-log').addEventListener('click', async () => {
  try {
    await window.aocLauncher.openLaunchLog(selectedVersion.id)
  } catch (error) {
    notify(error.message || t('launchError'), true)
  }
})
document.getElementById('open-last-crash').addEventListener('click', async () => {
  try {
    const result = await window.aocLauncher.openLastCrash()
    if (!result || !result.opened) notify(t('noCrashFound'), true)
  } catch (error) {
    notify(error.message || t('noCrashFound'), true)
  }
})
document.getElementById('check-launcher-update').addEventListener('click', async () => {
  const button = document.getElementById('check-launcher-update')
  const label = button.querySelector('.launcher-update-button-label')
  button.disabled = true
  label.textContent = 'Проверка…'
  try {
    const result = await window.aocLauncher.checkForUpdates()
    if (result?.supported === false) {
      label.textContent = 'Dev build'
      return
    }
    // electron-updater needs a published GitHub Release; fall back to the repository version file
    // so the button still works when the update is only pushed to the repository.
    const repo = await window.aocLauncher.checkRepoUpdate().catch(() => null)
    if (repo?.available) {
      pendingRepoUpdate = repo
      document.querySelector('#update-dialog p').textContent = t('startupUpdateText', { version: repo.latest })
      document.getElementById('update-dialog').showModal()
      return
    }
    const updateStatus = document.getElementById('launcher-update-message')
    if (updateStatus?.textContent) {
      label.textContent = updateStatus.textContent.includes('актуальна') || updateStatus.textContent.includes('latest') ? '✓' : 'v' + (result?.version || '…')
    } else {
      label.textContent = '✓'
    }
  } catch (error) {
    label.textContent = 'Ошибка'
    notify(error.message || t('updateError'), true)
  } finally {
    setTimeout(() => {
      button.disabled = false
      label.textContent = 'Проверить обновления'
    }, 1400)
  }
})

function createLink(label, url) {
  const item = document.createElement(url ? 'a' : 'span')
  item.className = 'community-link'
  item.textContent = label
  if (url) {
    item.href = url
    item.target = '_blank'
    item.rel = 'noreferrer'
  } else {
    item.classList.add('community-link-empty')
  }
  return item
}

function renderLinks(target, links) {
  target.replaceChildren()
  for (const link of links) target.append(createLink(language === 'en' ? link.labelEn || link.label : link.label, link.url))
}

function getCreator(version) {
  return version.creator || config.branding.modCreator
}

function renderCreators() {
  const creator = getCreator(selectedVersion)
  const modLabel = language === 'en' ? 'Mod by' : 'Автор мода'
  const launcherLabel = language === 'en' ? 'Launcher by' : 'Автор лаунчера'
  const links = [
    createLink(`${modLabel} · ${creator.name}`, creator.url),
    createLink(`${launcherLabel} · ${config.branding.launcherCreator.name}`, config.branding.launcherCreator.url)
  ]
  document.getElementById('about-creator-list').replaceChildren(...links.map(link => link.cloneNode(true)))
  document.getElementById('version-creator').replaceChildren(
    createLink(`${modLabel} · ${creator.name}`, creator.url)
  )
  renderLinks(document.getElementById('about-community-links'), config.community)
}

function renderConfig(nextConfig) {
  config = nextConfig
  const branding = config.branding
  document.title = branding.name
  document.getElementById('brand-logo').src = branding.logo
  document.getElementById('about-mod-logo').src = branding.logo
  document.getElementById('brand-logo').alt = `${branding.name} logo`
  document.querySelector('.brand').setAttribute('aria-label', `${branding.name} — ${t('versions')}`)
  document.querySelector('.brand-wordmark').firstChild.textContent = branding.name
  document.querySelector('.brand-caption').textContent = branding.caption
  document.querySelector('.crumb-muted').textContent = branding.name
  document.getElementById('brand-subtitle').textContent = branding.subtitle
  const aboutDescription = language === 'en' ? selectedVersion.descriptionEn : selectedVersion.description
  const paragraphs = aboutDescription.split(/\n\s*\n/)
  document.getElementById('about-mod-title').textContent = paragraphs.shift() || branding.name
  document.getElementById('about-mod-description').replaceChildren(...paragraphs.map((text) => {
    const paragraph = document.createElement('p')
    paragraph.textContent = text
    return paragraph
  }))

  versionGrid.replaceChildren()
  for (const version of config.versions) {
    const card = document.createElement('article')
    card.className = 'version-card'
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.dataset.versionId = version.id

    const art = document.createElement('div')
    art.className = 'version-card-art'
    const banner = document.createElement('img')
    banner.className = 'version-card-banner'
    banner.src = version.banner
    banner.alt = ''
    const icon = document.createElement('img')
    icon.className = 'version-card-logo'
    icon.src = version.icon || branding.logo
    icon.alt = ''
    art.append(banner, icon)

    const content = document.createElement('div')
    content.className = 'version-card-content'
    const header = document.createElement('div')
    header.className = 'version-card-header'
    const name = document.createElement('b')
    name.textContent = version.name
    const versionNumber = document.createElement('span')
    versionNumber.className = 'version-number'
    versionNumber.textContent = `v${version.version}`
    header.append(name, versionNumber)

    const creatorLine = document.createElement('span')
    creatorLine.className = 'version-card-creator'
    const creator = getCreator(version)
    creatorLine.textContent = `${language === 'en' ? 'by' : 'от'} ${creator.name}`

    const description = document.createElement('span')
    description.className = 'version-card-description'
    description.textContent = language === 'en' ? version.taglineEn || version.tagline : version.tagline

    const metadata = document.createElement('div')
    metadata.className = 'version-card-metadata'
    for (const label of ['Age of History II', 'Multiplayer', 'Java 17+']) {
      const chip = document.createElement('span')
      chip.textContent = label
      metadata.append(chip)
    }
    const footer = document.createElement('div')
    footer.className = 'version-card-footer'
    const versionStats = versionStates.get(version.id)?.stats
    const cardTime = document.createElement('span')
    cardTime.className = 'card-playtime'
    cardTime.textContent = versionStats ? formatPlaytime(versionStats.playSeconds) : formatPlaytime(0)
    const cardStatus = document.createElement('span')
    cardStatus.className = 'card-status'
    cardStatus.textContent = versionUpdates.get(version.id)?.available
      ? t('updateAvailable')
      : versionStates.get(version.id)?.searching
        ? t('searchingGame')
        : versionStates.get(version.id)?.installed
          ? versionStates.get(version.id)?.stats?.running
            ? t('playing')
            : (language === 'en' ? 'Installed' : 'Установлена')
          : /^[a-f0-9]{40}$/i.test(version.commit || '')
            ? (language === 'en' ? 'Ready to install' : 'Готова к установке')
            : t('versionNotPublished')
    if (versionUpdates.get(version.id)?.available) card.classList.add('has-update')
    footer.append(cardTime, cardStatus)
    content.append(header, creatorLine, description, metadata, footer)
    card.append(art, content)

    const select = () => selectVersion(version.id)
    card.addEventListener('click', select)
    versionGrid.append(card)
  }
  renderCreators()
}

function formatPlaytime(seconds) {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} ${t('minutesUnit')}`
  return minutes ? `${hours} ${t('hoursUnit')} ${minutes} ${t('minutesUnit')}` : `${hours} ${t('hoursUnit')}`
}

function formatLastPlayed(isoDate) {
  if (!isoDate) return t('neverPlayed')
  const elapsed = Math.max(0, Date.now() - new Date(isoDate).getTime())
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return t('justNow')
  if (minutes < 60) return t('minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hoursAgo', { count: hours })
  return t('daysAgo', { count: Math.floor(hours / 24) })
}

function renderVersionDetails(version) {
  if (!version) return
  const installed = versionStates.get(version.id)?.installed || false
  const stats = versionStates.get(version.id)?.stats || { playSeconds: 0, lastPlayed: null, sessions: 0 }
  document.getElementById('version-title').textContent = version.name
  document.getElementById('version-hero-title').textContent = version.name
  document.getElementById('version-banner').src = version.banner
  document.getElementById('version-banner').alt = `${version.name} banner`
  const description = document.getElementById('version-description')
  description.textContent = language === 'en'
    ? version.descriptionEn || version.taglineEn || version.tagline
    : version.description || version.tagline
  description.classList.remove('expanded')
  description.classList.toggle('collapsed', description.textContent.length > 420)
  const descriptionToggle = document.getElementById('description-toggle')
  descriptionToggle.hidden = description.textContent.length <= 420
  descriptionToggle.textContent = t('descriptionExpand')
  document.getElementById('total-playtime').textContent = formatPlaytime(stats.playSeconds)
  document.getElementById('last-played').textContent = formatLastPlayed(stats.lastPlayed)
  document.getElementById('session-count').textContent = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ru-RU').format(stats.sessions)

  const screenshots = document.getElementById('version-screenshots')
  screenshots.replaceChildren()
  for (const source of version.screenshots) {
    const image = document.createElement('img')
    image.src = source
    image.alt = `${version.name} ${language === 'en' ? 'screenshot' : 'скриншот'}`
    screenshots.append(image)
  }
  screenshots.hidden = version.screenshots.length === 0
  document.getElementById('delete-mod').hidden = !installed || Boolean(versionStates.get(version.id)?.external)
  renderVersionUpdateState()
}

function renderVersionUpdateState() {
  const badge = document.getElementById('version-update-badge')
  const button = document.getElementById('update-mod')
  if (!selectedVersion || !badge || !button) return
  const update = versionUpdates.get(selectedVersion.id)
  const state = versionStates.get(selectedVersion.id) || { installed: false }
  const available = Boolean(update?.available)
  badge.hidden = !available
  button.hidden = !available
  button.disabled = busy || state.stats?.running
  if (available) {
    button.title = update.message || ''
  }
}

async function checkModUpdates() {
  try {
    const updates = await window.aocLauncher.checkModUpdates()
    for (const [id, update] of Object.entries(updates)) versionUpdates.set(id, update)
    renderVersionUpdateState()
    const updatable = [...versionUpdates.values()].filter(update => update.available).length
    if (updatable > 0) notify(t('modUpdatesFound', { count: updatable }))
  } catch (error) {
    console.warn('Could not check the mod versions for updates:', error)
  }
}

function selectVersion(versionId) {
  selectedVersion = config.versions.find((version) => version.id === versionId)
  if (!selectedVersion) return
  renderConfig(config)
  document.querySelectorAll('.version-card').forEach((card) => {
    card.classList.toggle('selected', card.dataset.versionId === versionId)
  })
  renderVersionDetails(selectedVersion)
  renderSelectedVersion()
}

function renderSelectedVersion() {
  if (!selectedVersion) return
  const state = versionStates.get(selectedVersion.id) || { installed: false }
  const action = document.getElementById('mod-action')
  const hasCommit = /^[a-f0-9]{40}$/i.test(getCurrentCommit(selectedVersion))
  const actionName = state.installed
    ? state.stats?.running ? 'stop' : 'play'
    : 'download'
  action.querySelector('.action-icon').outerHTML = icon(actionName, 'icon action-icon')
  action.querySelector('.action-label').textContent = state.installed
    ? state.stats?.running ? t('stop') : t('play')
    : t('download')
  action.disabled = busy || (!state.installed && !hasCommit)
  action.classList.toggle('button-loading', busy)
  const availability = document.getElementById('version-availability')
  availability.hidden = state.installed || hasCommit
  availability.textContent = availability.hidden ? '' : t('versionCommitMissing')
  document.getElementById('delete-mod').disabled = busy || state.stats?.running
  document.getElementById('delete-mod').title = state.stats?.running
    ? (language === 'en' ? 'Close the game before uninstalling.' : 'Закрой игру перед удалением.')
    : ''
  document.getElementById('games-directory').textContent = state.installDirectory || versionsDirectory || 'Games'
  document.getElementById('settings-games-directory').textContent = versionsDirectory || 'Games'
  document.getElementById('reset-game-folder').hidden = !state.external
  renderVersionUpdateState()
}

function setBusy(value) {
  busy = value
  renderSelectedVersion()
}

function renderInstallState(status) {
  versionStates.clear()
  for (const version of status.versions) versionStates.set(version.id, version)
  versionsDirectory = status.versionsDirectory
  javaAvailable = Boolean(status.java)
  if (config) renderConfig(config)
  renderVersionDetails(selectedVersion)
  renderSelectedVersion()
}

function formatBytes(bytes) {
  if (bytes < 1000) return `${Math.round(bytes)} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`
}

function formatRate(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

function updateProgressAnimation(timestamp) {
  const delta = progressFrameAt ? Math.min(64, timestamp - progressFrameAt) : 16
  progressFrameAt = timestamp
  const easing = 1 - Math.pow(0.001, delta / 170)
  displayedProgress += (targetProgress - displayedProgress) * easing
  document.getElementById('progress-bar').style.transform = `scaleX(${displayedProgress})`
  document.getElementById('progress-glow').style.left = `${Math.max(0, displayedProgress * 100)}%`
  progressFrame = requestAnimationFrame(updateProgressAnimation)
}

function startProgressAnimation() {
  if (!progressFrame) progressFrame = requestAnimationFrame(updateProgressAnimation)
}

function resetProgress() {
  if (progressFrame) cancelAnimationFrame(progressFrame)
  progressFrame = 0
  progressFrameAt = 0
  displayedProgress = 0
  targetProgress = 0
  extractionSample = null
  document.getElementById('progress-bar').style.transform = 'scaleX(0)'
  document.getElementById('progress-glow').style.left = '0%'
}

function handleProgress(progress) {
  const panel = document.getElementById('download-progress')
  const label = document.getElementById('progress-message')
  const percent = document.getElementById('progress-percent')
  const bar = document.getElementById('progress-bar')
  const size = document.getElementById('progress-size')
  const speed = document.getElementById('progress-speed')
  const eta = document.getElementById('progress-eta')
  const footnote = document.getElementById('progress-footnote')
  panel.hidden = false
  bar.classList.remove('indeterminate')
  document.querySelector('.download-spinner').classList.add('spinning')

  if (progress.phase === 'download') {
    label.textContent = t('downloading')
    footnote.textContent = t('downloadSource')
    size.textContent = progress.total
      ? `${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
      : `${formatBytes(progress.received)}`
    speed.textContent = formatRate(progress.speedBytesPerSecond)
    if (progress.total) {
      targetProgress = Math.min(.9, progress.received / progress.total * .9)
      percent.textContent = `${Math.floor(progress.received / progress.total * 90)}%`
      const remaining = Math.max(0, progress.total - progress.received)
      const seconds = progress.speedBytesPerSecond > 0 ? Math.ceil(remaining / progress.speedBytesPerSecond) : 0
      eta.textContent = seconds
        ? `${t('wait')} ${seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} s`}`
        : t('starting')
    } else {
      targetProgress = Math.min(.72, .08 + Math.log10(Math.max(1, progress.received / 100_000)) * .2)
      percent.textContent = ''
      eta.textContent = t('starting')
      bar.classList.add('indeterminate')
    }
    startProgressAnimation()
  } else if (progress.phase === 'extract') {
    label.textContent = t('extractingFiles', { percent: progress.percent })
    footnote.textContent = t('verifyingFiles')
    targetProgress = .9 + .09 * (progress.percent / 100)
    percent.textContent = `${Math.min(99, 90 + Math.floor(progress.percent * .09))}%`
    speed.textContent = ''
    size.textContent = `${formatBytes(progress.expandedSize)} ${t('unpacked')}`
    const now = Date.now()
    if (!extractionSample || now - extractionSample.at > 700) {
      const entriesPerSecond = extractionSample
        ? (progress.completedEntries - extractionSample.completed) / Math.max((now - extractionSample.at) / 1000, .001)
        : 0
      extractionSample = { at: now, completed: progress.completedEntries }
      const remaining = progress.entryCount - progress.completedEntries
      const seconds = entriesPerSecond > 0 ? Math.ceil(remaining / entriesPerSecond) : 0
      eta.textContent = seconds ? `${t('wait')} ${seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds} s`}` : t('calculating')
    }
    bar.classList.remove('indeterminate')
    startProgressAnimation()
  } else if (progress.phase === 'complete') {
    label.textContent = t('installed')
    footnote.textContent = t('gameReady')
    targetProgress = 1
    percent.textContent = '100%'
    speed.textContent = ''
    eta.textContent = '✓'
    bar.classList.remove('indeterminate')
    startProgressAnimation()
    extractionSample = null
    setTimeout(() => {
      panel.hidden = true
      document.querySelector('.download-spinner').classList.remove('spinning')
      resetProgress()
    }, 1700)
  } else if (progress.phase === 'error') {
    panel.hidden = true
    document.querySelector('.download-spinner').classList.remove('spinning')
    resetProgress()
    extractionSample = null
  }
}

function renderStats(stats) {
  if (!selectedVersion) return
  const current = versionStates.get(selectedVersion.id) || { installed: false }
  versionStates.set(selectedVersion.id, { ...current, stats })
  document.getElementById('total-playtime').textContent = formatPlaytime(stats.playSeconds)
  document.getElementById('last-played').textContent = formatLastPlayed(stats.lastPlayed)
  document.getElementById('session-count').textContent = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ru-RU').format(stats.sessions)
  renderSelectedVersion()
  versionGrid.querySelectorAll('.version-card').forEach((card) => {
    if (card.dataset.versionId !== selectedVersion.id) return
    const playtime = card.querySelector('.card-playtime')
    const status = card.querySelector('.card-status')
    playtime.textContent = formatPlaytime(stats.playSeconds)
    status.textContent = current.installed
      ? stats.running
        ? t('playing')
        : (language === 'en' ? 'Installed' : 'Установлена')
      : /^[a-f0-9]{40}$/i.test(selectedVersion.commit || '')
        ? (language === 'en' ? 'Ready to install' : 'Готова к установке')
        : t('versionNotPublished')
  })
}

async function refreshStats() {
  if (!selectedVersion) return
  try {
    renderStats(await window.aocLauncher.getGameStats(selectedVersion.id))
    statsErrorShown = false
  } catch (error) {
    if (!statsErrorShown) notify(error.message || t('statsError'), true)
    statsErrorShown = true
  }
}

async function refreshStatus() {
  try {
    const [nextConfig, status] = await Promise.all([
      window.aocLauncher.getConfig(),
      window.aocLauncher.getModStatus()
    ])
    config = nextConfig
    selectedVersion = config.versions[0]
    setLanguage(language)
    renderInstallState(status)
  } catch (error) {
    notify(error.message || t('configError'), true)
  }
}

function showJavaPrompt() {
  const prompt = document.getElementById('java-dialog')
  if (!prompt.open) prompt.showModal()
}

async function installOrLaunch() {
  if (busy || !selectedVersion) return
  const version = selectedVersion
  const state = versionStates.get(version.id) || { installed: false }
  if (state.installed) {
    if (state.stats?.running) {
      setBusy(true)
      try {
        const result = await window.aocLauncher.stopMod(version.id)
        if (result.stopping) notify(t('stoppingGame'))
        await refreshStatus()
      } catch (error) {
        notify(error.message || t('launchError'), true)
      } finally {
        setBusy(false)
      }
      return
    }
    if (!javaAvailable) {
      showJavaPrompt()
      return
    }
    setBusy(true)
    try {
      const result = await window.aocLauncher.launchMod(version.id)
      if (result.javaMissing) {
        javaAvailable = false
        showJavaPrompt()
      } else if (result.alreadyRunning) {
        notify(t('playing'))
        await refreshStatus()
      } else if (result.started) {
        notify(t('launchStarted'))
        setTimeout(refreshStats, 900)
      }
    } catch (error) {
      showCrashDialog(error.message || t('launchError'))
    } finally {
      setBusy(false)
    }
    return
  }

  if (!/^[a-f0-9]{40}$/i.test(getCurrentCommit(version))) {
    notify(t('versionCommitMissing'), true)
    return
  }
  const confirmed = await confirmAction({
    title: t('confirmDownloadTitle'),
    message: t('downloadConfirmVersion', { name: version.name }),
    acceptLabel: t('download')
  })
  if (!confirmed) return
  await downloadVersion(version)
}

function getCurrentCommit(version) {
  return versionStates.get(version.id)?.commit || version.commit || ''
}

async function downloadVersion(version, options = {}) {
  const { commit = '', backup = false, confirmMessage = '', acceptLabel = t('download') } = options
  if (busy) return
  if (confirmMessage) {
    const confirmed = await confirmAction({
      title: t('confirmDownloadTitle'),
      message: confirmMessage,
      acceptLabel
    })
    if (!confirmed) return
  }
  busy = true
  document.getElementById('download-progress').hidden = false
  document.getElementById('progress-message').textContent = t('downloadStarted')
  document.getElementById('progress-footnote').textContent = ''
  document.getElementById('progress-size').textContent = '0 B'
  document.getElementById('progress-speed').textContent = '—'
  document.getElementById('progress-eta').textContent = t('starting')
  document.getElementById('progress-percent').textContent = '0%'
  renderSelectedVersion()
  resetProgress()
  try {
    const result = backup
      ? await window.aocLauncher.installModCommit({ versionId: version.id, commit })
      : await window.aocLauncher.downloadMod({ versionId: version.id, commit })
    renderInstallState(await window.aocLauncher.getModStatus())
    if (result?.backupDirectory) notify(t('rollbackBackupCreated', { path: result.backupDirectory }))
    notify(t('installedVersionMessage', { name: version.name }))
  } catch (error) {
    document.getElementById('download-progress').hidden = true
    if (error.message === 'ARCHIVE_TOO_LARGE') showMessage(t('downloadErrorTitle'), t('archiveTooLarge'))
    else notify(error.message || t('downloadError'), true)
  } finally {
    busy = false
    renderSelectedVersion()
  }
}

async function deleteVersion() {
  if (busy || !selectedVersion) return
  const version = selectedVersion
  const state = versionStates.get(version.id)
  if (!state?.installed || state.stats?.running || state.external) return
  const confirmed = await confirmAction({
    title: t('confirmDeleteTitle'),
    message: t('deleteConfirmVersion', { name: version.name }),
    acceptLabel: t('uninstall')
  })
  if (!confirmed) return
  setBusy(true)
  try {
    await window.aocLauncher.deleteMod(version.id)
    renderInstallState(await window.aocLauncher.getModStatus())
    document.getElementById('download-progress').hidden = true
    notify(t('deletedVersionMessage', { name: version.name }))
  } catch (error) {
    notify(error.message || t('deleteError'), true)
  } finally {
    setBusy(false)
  }
}

function openFolder(versionId) {
  window.aocLauncher.openModFolder(versionId).catch((error) => {
    notify(error.message || t('installError'), true)
  })
}

async function renderCommitList() {
  const container = document.getElementById('mod-commit-list')
  if (!container) return
  const installed = config.versions.filter(version => versionStates.get(version.id)?.installed)
  container.replaceChildren()
  if (!installed.length) {
    const empty = document.createElement('p')
    empty.className = 'commit-list-hint'
    empty.textContent = t('commitsNoInstalledVersions')
    container.append(empty)
    return
  }
  for (const version of installed) {
    const group = document.createElement('div')
    group.className = 'commit-group'
    const title = document.createElement('h3')
    title.className = 'commit-group-title'
    title.textContent = version.name
    const list = document.createElement('div')
    list.className = 'commit-group-list'
    const loading = document.createElement('p')
    loading.className = 'commit-list-hint'
    loading.textContent = t('commitsLoading')
    list.append(loading)
    group.append(title, list)
    container.append(group)
    try {
      const commits = await window.aocLauncher.openModCommits(version.id)
      list.replaceChildren()
      if (!commits.length) {
        const empty = document.createElement('p')
        empty.className = 'commit-list-hint'
        empty.textContent = t('commitsUnavailable')
        list.append(empty)
        continue
      }
      const current = getCurrentCommit(version)
      for (const commit of commits) {
        const row = document.createElement('div')
        row.className = 'commit-row'
        if (commit.sha === current) row.classList.add('commit-current')
        const copy = document.createElement('span')
        copy.className = 'commit-copy'
        const message = document.createElement('b')
        message.textContent = commit.message || commit.short
        const meta = document.createElement('small')
        meta.textContent = `${commit.short} · ${formatLastPlayed(commit.date)}`
        copy.append(message, meta)
        const action = document.createElement('button')
        action.type = 'button'
        action.className = 'soft-button'
        action.dataset.commit = commit.sha
        action.dataset.version = version.id
        action.textContent = commit.sha === current ? t('installed') : t('rollback')
        action.disabled = commit.sha === current || busy
        row.append(copy, action)
        list.append(row)
      }
    } catch (error) {
      list.replaceChildren()
      const failed = document.createElement('p')
      failed.className = 'commit-list-hint'
      failed.textContent = error.message || t('commitsUnavailable')
      list.append(failed)
    }
  }
}

document.querySelectorAll('.mod-action').forEach((button) => {
  button.addEventListener('click', installOrLaunch)
})
document.getElementById('delete-mod').addEventListener('click', deleteVersion)
document.getElementById('update-mod').addEventListener('click', async () => {
  if (busy || !selectedVersion) return
  const version = selectedVersion
  const update = versionUpdates.get(version.id)
  if (!update?.available) return
  await downloadVersion(version, {
    commit: update.latest,
    confirmMessage: t('updateConfirmVersion', { name: version.name, message: update.message || update.latest.slice(0, 7) }),
    acceptLabel: t('updateMod')
  })
  await checkModUpdates()
  renderCommitList()
})
document.getElementById('mod-commit-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-commit]')
  if (!button || busy) return
  const version = config.versions.find(entry => entry.id === button.dataset.version)
  if (!version) return
  const commit = button.dataset.commit
  await downloadVersion(version, {
    commit,
    backup: true,
    confirmMessage: t('rollbackConfirmVersion', { name: version.name, short: commit.slice(0, 7) }),
    acceptLabel: t('rollback')
  })
  await checkModUpdates()
  renderCommitList()
})
for (const id of ['open-mod-folder', 'open-mod-folder-secondary', 'open-mod-folder-settings']) {
  document.getElementById(id).addEventListener('click', () => openFolder())
}
document.getElementById('select-game-folder').addEventListener('click', async () => {
  if (!selectedVersion) return
  try {
    const result = await window.aocLauncher.selectGameFolder(selectedVersion.id)
    if (result.canceled) return
    renderInstallState(await window.aocLauncher.getModStatus())
    notify(t('gameFolderSelected'))
  } catch (error) {
    notify(error.message || t('gameFolderInvalid'), true)
  }
})
document.getElementById('reset-game-folder').addEventListener('click', async () => {
  if (!selectedVersion) return
  try {
    await window.aocLauncher.resetGameFolder(selectedVersion.id)
    renderInstallState(await window.aocLauncher.getModStatus())
    notify(t('gameFolderReset'))
  } catch (error) {
    notify(error.message || t('installError'), true)
  }
})
document.getElementById('download-java').addEventListener('click', async () => {
  try {
    await window.aocLauncher.downloadJava()
    document.getElementById('java-dialog').close()
    notify(t('javaDownloadOpened'))
  } catch (error) {
    notify(error.message || t('launchError'), true)
  }
})
document.getElementById('cancel-java').addEventListener('click', () => document.getElementById('java-dialog').close())
document.getElementById('close-java-dialog').addEventListener('click', () => document.getElementById('java-dialog').close())
document.getElementById('check-java').addEventListener('click', async () => {
  try {
    const java = await window.aocLauncher.getJava()
    javaAvailable = Boolean(java)
    if (!javaAvailable) {
      notify(t('javaStillMissing'), true)
      return
    }
    document.getElementById('java-dialog').close()
    notify(t('javaFound'))
    await installOrLaunch()
  } catch (error) {
    notify(error.message || t('launchError'), true)
  }
})

for (const id of ['window-minimize', 'startup-minimize']) {
  document.getElementById(id).addEventListener('click', () => window.aocLauncher.minimizeWindow())
}
for (const id of ['window-close', 'startup-close']) {
  document.getElementById(id).addEventListener('click', () => window.aocLauncher.closeWindow())
}
document.getElementById('install-update').addEventListener('click', async () => {
  if (pendingRepoUpdate) {
    const update = pendingRepoUpdate
    pendingRepoUpdate = null
    document.getElementById('update-dialog').close()
    const button = document.getElementById('startup-update-install')
    const startupMessage = document.getElementById('startup-message')
    if (button) button.disabled = true
    if (startupMessage) startupMessage.textContent = t('startupUpdateDownloading', { version: update.latest })
    try {
      await window.aocLauncher.applyRepoUpdate()
      if (startupMessage) startupMessage.textContent = t('startupUpdateStarted')
    } catch (error) {
      if (button) button.disabled = false
      notify(error.message || t('updateError'), true)
    }
    return
  }
  window.aocLauncher.installUpdate()
})
document.getElementById('later-update').addEventListener('click', () => document.getElementById('update-dialog').close())
document.getElementById('close-crash-dialog').addEventListener('click', () => document.getElementById('crash-dialog').close())
document.getElementById('create-crash-report').addEventListener('click', async () => {
  if (!crashVersionId) return
  try {
    const result = await window.aocLauncher.createCrashReport({
      versionId: crashVersionId,
      subject: document.getElementById('crash-subject').value,
      details: document.getElementById('crash-details').value
    })
    if (result.canceled) return
    document.getElementById('crash-dialog').close()
    notify(t('reportSaved'))
  } catch (error) {
    notify(error.message || t('launchError'), true)
  }
})

document.getElementById('send-crash-report').addEventListener('click', async () => {
  if (!crashVersionId) return
  const hint = document.getElementById('crash-report-hint')
  try {
    const result = await window.aocLauncher.sendCrashReport({
      versionId: crashVersionId,
      subject: document.getElementById('crash-subject').value,
      details: document.getElementById('crash-details').value
    })
    document.getElementById('crash-report-log').textContent = result.logPath
    hint.hidden = false
  } catch (error) {
    notify(error.message || t('launchError'), true)
  }
})
document.getElementById('open-crash-log-folder').addEventListener('click', async () => {
  try {
    await window.aocLauncher.openLogsFolder()
  } catch (error) {
    notify(error.message || t('launchError'), true)
  }
})

window.aocLauncher.onDownloadProgress(handleProgress)
window.aocLauncher.onGameDiscovery(({ error } = {}) => {
  if (error) notify(t('gameSearchFailed', { error }), true)
  refreshStatus()
})
window.aocLauncher.onGameExit(({ error } = {}) => {
  if (error) showCrashDialog(error)
  else notify(t('launchedToast'))
  refreshStatus()
})
window.aocLauncher.onUpdateStatus(status => {
  const startupMessage = document.getElementById('startup-message')
  const updatePanel = document.getElementById('launcher-update-panel')
  const updateMessage = document.getElementById('launcher-update-message')
  const updateProgress = document.getElementById('launcher-update-progress')
  updatePanel.hidden = false
  if (status.phase === 'checking') {
    startupMessage.textContent = t('updateChecking')
    updateMessage.textContent = t('updateChecking')
    updateProgress.style.width = '0%'
    updateProgress.parentElement.classList.add('checking')
  } else if (status.phase === 'current') {
    updateMessage.textContent = t('launcherUpToDate')
    updateProgress.parentElement.classList.remove('checking')
  } else if (status.phase === 'available') {
    startupMessage.textContent = `${t('updateDownloading')} · ${status.version}`
    updateMessage.textContent = `${t('updateDownloading')} · ${status.version}`
    updateProgress.parentElement.classList.add('checking')
    notify(t('updateDownloading'))
  } else if (status.phase === 'downloading') {
    startupMessage.textContent = `${t('updateDownloading')} · ${status.percent}%`
    updateMessage.textContent = `${t('updateDownloading')} · ${status.percent}%`
    updateProgress.parentElement.classList.remove('checking')
    updateProgress.style.width = `${status.percent}%`
  } else if (status.phase === 'downloaded') {
    updateMessage.textContent = t('updateReady')
    updateProgress.parentElement.classList.remove('checking')
    updateProgress.style.width = '100%'
    document.getElementById('update-dialog').showModal()
    notify(t('updateReady'))
  } else if (status.phase === 'error') {
    updateMessage.textContent = `${t('updateError')} ${status.message}`
    updateProgress.parentElement.classList.remove('checking')
    console.warn('Launcher update check failed:', status.message)
  }
})

function hideStartupScreen() {
  const startupScreen = document.getElementById('startup-screen')
  if (!startupScreen) return
  startupScreen.classList.add('startup-screen-leaving')
  setTimeout(() => startupScreen.remove(), 650)
}

function showStartupUpdate(update) {
  pendingRepoUpdate = update
  document.getElementById('startup-update-title').textContent = t('startupUpdateTitle')
  document.getElementById('startup-update-text').textContent = t('startupUpdateText', { version: update.latest })
  document.getElementById('startup-update-install').textContent = t('startupUpdateInstall')
  document.getElementById('startup-update-later').textContent = t('startupUpdateLater')
  document.getElementById('startup-update').hidden = false
  // The load is finished, so drop the spinner and the stale "checking for updates" caption.
  const track = document.querySelector('.startup-track')
  if (track) track.hidden = true
  const startupMessage = document.getElementById('startup-message')
  if (startupMessage) startupMessage.textContent = ''
}

document.getElementById('startup-update-install').addEventListener('click', async () => {
  if (!pendingRepoUpdate) return
  const button = document.getElementById('startup-update-install')
  const startupMessage = document.getElementById('startup-message')
  button.disabled = true
  startupMessage.textContent = t('startupUpdateDownloading', { version: pendingRepoUpdate.latest })
  try {
    await window.aocLauncher.applyRepoUpdate()
    startupMessage.textContent = t('startupUpdateStarted')
  } catch (error) {
    button.disabled = false
    notify(error.message || t('updateError'), true)
  }
})
document.getElementById('startup-update-later').addEventListener('click', hideStartupScreen)

async function runStartupSequence() {
  const startupMessage = document.getElementById('startup-message')
  const startedAt = Date.now()
  const minimumDuration = 2000
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  startupMessage.textContent = t('startupInitializing')
  await wait(340)
  startupMessage.textContent = t('startupLoadingVersions')
  const versionsReady = window.aocLauncher.getModStatus().catch(error => {
    console.warn('Could not read the mod list during startup:', error)
  })
  const modUpdates = checkModUpdates()
  await wait(300)
  startupMessage.textContent = t('startupCheckingUpdates')
  const updateCheck = window.aocLauncher.checkForUpdates().catch(error => {
    console.warn('Launcher update check failed:', error)
  })
  const repoUpdateCheck = window.aocLauncher.checkRepoUpdate().catch(error => {
    console.warn('Repository update check failed:', error)
    return null
  })
  await Promise.race([
    Promise.all([versionsReady, updateCheck, modUpdates]),
    wait(8000)
  ])
  const repoUpdate = await Promise.race([repoUpdateCheck, wait(3500).then(() => null)])
  if (repoUpdate?.available) {
    showStartupUpdate(repoUpdate)
    return
  }
  startupMessage.textContent = t('startupReady')
  const remaining = minimumDuration - (Date.now() - startedAt)
  if (remaining > 0) await wait(remaining)
  hideStartupScreen()
}

renderProfile()
refreshStatus()
setInterval(refreshStats, 1000)
runStartupSequence()
setInterval(checkModUpdates, 30 * 60 * 1000)
