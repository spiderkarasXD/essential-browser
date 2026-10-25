// Автообновление из GitHub Releases.
// Установленная версия (NSIS) сама качает новую в фоне и ставит её при перезапуске — как Chrome.
// Portable-версию обновить на месте нельзя, поэтому ей только сообщаем о новой версии со ссылкой на скачивание.
const { app, net, shell } = require('electron');

const REPO = 'spiderkarasXD/essential-browser';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const CHECK_EVERY = 4 * 60 * 60 * 1000; // раз в 4 часа, плюс при запуске
const PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;

// status: idle | checking | downloading | ready | latest | error | available (portable: есть новая, качать вручную)
let state = { status: 'idle', version: null, progress: 0, error: null, portable: PORTABLE, current: app.getVersion() };
let notify = () => {};
let autoUpdater = null;
let timer = null;

function set(patch) {
  state = { ...state, ...patch };
  notify(state);
}

// '0.6.10' > '0.6.9' — сравниваем по числам
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function checkPortable() {
  set({ status: 'checking', error: null });
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('GitHub ответил ' + res.status);
    const tag = (await res.json()).tag_name || '';
    if (newer(tag, app.getVersion())) set({ status: 'available', version: tag.replace(/^v/, '') });
    else set({ status: 'latest', version: null });
  } catch (e) {
    set({ status: 'error', error: e.message });
  }
}

function setupInstalled() {
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // скачанное обновление ставится и при обычном закрытии браузера
  autoUpdater.logger = null;
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true; // проверка из исходников (ESSENTIAL_UPDATE_TEST) — по dev-app-update.yml
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', version: null }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100 }));
  autoUpdater.on('error', (e) => {
    // уже скачанное обновление ошибка повторной проверки не отменяет
    if (state.status !== 'ready') set({ status: 'error', error: (e && e.message ? e.message : String(e)).split('\n')[0] });
  });
}

function check() {
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
  if (PORTABLE) return checkPortable();
  if (!autoUpdater) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

// onState — в интерфейс; enabled() — включено ли «обновлять автоматически»
function setup({ onState, enabled }) {
  notify = onState;
  // из исходников (npm start) не обновляемся: обновлять нечего
  if (!app.isPackaged && !process.env.ESSENTIAL_UPDATE_TEST) return;
  if (!PORTABLE) setupInstalled();
  const auto = () => { if (enabled()) check(); };
  setTimeout(auto, 15000); // не мешаем запуску
  timer = setInterval(auto, CHECK_EVERY);
}

// beforeQuit — сохранить вкладки и cookies; ставить обновление можно только после этого
async function install(beforeQuit) {
  if (PORTABLE || state.status === 'available') return shell.openExternal(RELEASES);
  if (state.status !== 'ready' || !autoUpdater) return;
  await beforeQuit();
  // тихая установка поверх и сразу запуск новой версии
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { setup, check, install, getState: () => state, stop: () => clearInterval(timer) };
