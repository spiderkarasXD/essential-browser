const { app, BrowserWindow, WebContentsView, ipcMain, Menu, clipboard, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const importer = require('./importer');
const ext = require('./extensions');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore, uninstallExtension } = require('electron-chrome-web-store');

// Геометрия как в Zen: боковая панель слева, страница — карточка с отступами
const SIDEBAR_W = 264;
const GAP = 8;
const TOOLBAR_H = 40; // верхняя панель как в Arc, в полноэкранном режиме прячется
const NEWTAB_URL = pathToFileURL(path.join(__dirname, 'newtab.html')).href;
const PRELOAD = path.join(__dirname, 'preload.js');

const ICONS = ['🏠', '💼', '🎮', '🎵', '📚', '🌙', '🔥', '🌊', '🌿', '🌸', '⚡', '🚀',
  '🎨', '🧪', '💻', '📷', '🍿', '🛒', '✈️', '🐱', '❤️', '⭐', '🧠', '💬'];
const COLORS = ['#2f7bff', '#7c5cff', '#ff6a2b', '#1fa2ff', '#2ecc71', '#ff5fa2', '#f5c400', '#00c2b8', '#e84545'];

// Готовые градиенты для редактора тем
const THEME_PRESETS = [
  ['#2f7bff', '#16c2ff'], ['#ff6a2b', '#ffb02e'], ['#1fa2ff', '#12d8fa', '#a6ffcb'], ['#ff5fa2', '#7c5cff'],
  ['#2ecc71', '#00c2b8'], ['#f5c400', '#ff6a2b', '#e84545'], ['#3a1c71', '#d76d77', '#ffaf7b'], ['#0f2027', '#2c5364'],
  ['#ee9ca7', '#ffdde1'], ['#43cea2', '#185a9d'], ['#c471f5', '#fa71cd'], ['#8e9eab', '#eef2f3'],
];

const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  yandex: { name: 'Яндекс', url: 'https://ya.ru/search/?text=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
};

const DEFAULT_SETTINGS = {
  searchEngine: 'google',
  rememberSearches: true,
  restoreSession: true,
  doNotTrack: false,
  permissions: { notifications: 'ask', media: 'ask', geolocation: 'ask' },
  downloadsDir: '',
  downloadsAsk: false,
  spellcheck: true,
  // применяются только при запуске Chromium
  hardwareAcceleration: true,
  smoothScrolling: true,
  forceDarkSites: false,
  onboarded: false,
  autoPip: true, // видео уходит в «картинку в картинке», когда переключаешься на другую вкладку
  pinnedExtensions: [],
  micLabel: '', // микрофон и камера для сайтов; '' — как в Windows
  camLabel: '',
};
const RESTART_KEYS = ['hardwareAcceleration', 'smoothScrolling', 'forceDarkSites'];

// Браузер переименован из Nitro в Essential: один раз переносим профиль (вкладки, историю, входы на сайты)
(function migrateFromNitro() {
  const dst = app.getPath('userData');
  const src = path.join(app.getPath('appData'), 'Nitro');
  if (fs.existsSync(path.join(dst, 'settings.json')) || !fs.existsSync(src)) return;
  try {
    fs.cpSync(src, dst, {
      recursive: true,
      filter: (p) => !/[\\/](Cache|Code Cache|GPUCache|DawnCache|GrShaderCache|ShaderCache|Crashpad)([\\/]|$)/i.test(p) && !/[\\/]Singleton/i.test(p),
    });
    // новое имя — новое знакомство: покажем первую настройку ещё раз
    const file = path.join(dst, 'settings.json');
    if (fs.existsSync(file)) {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      s.onboarded = false;
      fs.writeFileSync(file, JSON.stringify(s));
    }
  } catch (e) {
    console.error('profile migration failed', e);
  }
})();

const dataFile = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  try {
    fs.writeFileSync(dataFile(name), JSON.stringify(data));
  } catch (e) {
    console.error('save failed', name, e);
  }
}

const settings = { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) };
settings.permissions = { ...DEFAULT_SETTINGS.permissions, ...settings.permissions };
const saveSettings = () => writeJson('settings.json', settings);

// ---------- флаги Chromium (до старта) ----------

// Убираем "Electron/x.y" из user agent, иначе часть сайтов (вход в Google и т.п.) ругается
app.userAgentFallback = app.userAgentFallback
  .replace(/ Electron\/\S+/, '')
  .replace(/ (essential-browser|Essential|nitro-browser|Essential)\/\S+/i, '');
// Google не пускает в аккаунт браузеры на Electron («Возможно, этот браузер небезопасен»),
// даже с чистым user agent: страницу входа открываем от имени Firefox, как делают другие браузеры на Electron
const GOOGLE_LOGIN = /^https:\/\/accounts\.google\.com\//;
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
// Русский интерфейс сайтов (Accept-Language), а не язык по IP/VPN
app.commandLine.appendSwitch('lang', 'ru');
if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();
if (!settings.smoothScrolling) app.commandLine.appendSwitch('disable-smooth-scrolling');
if (settings.forceDarkSites) app.commandLine.appendSwitch('enable-features', 'WebContentsForceDark');

// Одно окно на всё: ссылки, открытые из других программ, приходят вторым запуском
if (!app.requestSingleInstanceLock()) app.exit(0);

function urlFromArgv(argv) {
  for (const a of argv.slice(1)) {
    if (/^https?:\/\//i.test(a)) return a;
    if (/\.(html?|pdf|svg)$/i.test(a) && fs.existsSync(a)) return pathToFileURL(a).href;
  }
  return null;
}
let pendingUrl = urlFromArgv(process.argv);

let win;
let shownView = null;
const overlays = {}; // name -> WebContentsView (spotlight, panel)
const openOverlays = new Set();
const tabs = new Map(); // id -> { id, wsId, view, url, title, favicon }
let workspaces = []; // { id, name, icon, color, theme, tabIds, activeTab }
let activeWs = null;
let nextId = 1;
let compact = false;
let peek = false;
let htmlFullscreen = false;
const closedTabs = [];
let essentials = [];
let bookmarks = [];
let sitePerms = {}; // origin -> { notifications|media|geolocation: 'allow'|'block'|'ask' }
let history = [];
let historySaveTimer = null;
let searches = []; // [{ q, ts }] — что вводили в поиск

// ---------- утилиты ----------

const searchUrl = () => (ENGINES[settings.searchEngine] || ENGINES.google).url;

// null — значит ввод не похож на адрес и его надо искать
function parseUrl(input) {
  const s = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|view-source):/i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^/]+\.[a-zа-я]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return null;
}

function toUrl(input) {
  const s = input.trim();
  if (!s) return NEWTAB_URL;
  return parseUrl(s) || searchUrl() + encodeURIComponent(s);
}

// Достаёт поисковый запрос из адреса Google / Яндекса / DuckDuckGo / Bing
function searchFromUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    let q = null;
    if (/(^|\.)google\.[a-z.]+$/.test(h) && u.pathname === '/search') q = u.searchParams.get('q');
    else if (/(^|\.)(ya\.ru|yandex\.[a-z.]+)$/.test(h) && u.pathname.startsWith('/search')) q = u.searchParams.get('text');
    else if (/(^|\.)duckduckgo\.com$/.test(h)) q = u.searchParams.get('q');
    else if (/(^|\.)bing\.com$/.test(h) && u.pathname === '/search') q = u.searchParams.get('q');
    return (q || '').trim() || null;
  } catch {
    return null;
  }
}

// essential://settings/privacy (а по привычке и chrome://, arc://, edge://… и about:settings) → раздел настроек.
// null — это не адрес настроек.
const SETTINGS_ALIASES = { chromium: 'system', shortcuts: 'keys', hotkeys: 'keys', microphone: 'devices', camera: 'devices', content: 'privacy', clearbrowserdata: 'privacy' };
function settingsSection(url) {
  const m = /^(?:(?:essential|chrome|arc|edge|brave|opera|vivaldi):\/\/|about:)settings\/?([\w-]*)/i.exec((url || '').trim());
  if (!m) return null;
  const s = m[1].toLowerCase().replace(/-/g, '');
  return SETTINGS_ALIASES[s] || s || 'appearance';
}

const displayUrl = (url) => (!url || url === NEWTAB_URL ? '' : url);
const originOf = (u) => { try { return new URL(u).origin; } catch { return u; } };
const getWs = (id = activeWs) => workspaces.find((w) => w.id === id);
const activeTab = () => tabs.get(getWs()?.activeTab);
const activeWc = () => activeTab()?.view?.webContents;

function canGo(wc, dir) {
  const h = wc.navigationHistory;
  if (h) return dir < 0 ? h.canGoBack() : h.canGoForward();
  return dir < 0 ? wc.canGoBack() : wc.canGoForward();
}

function go(wc, dir) {
  const h = wc.navigationHistory;
  if (h) return dir < 0 ? h.goBack() : h.goForward();
  return dir < 0 ? wc.goBack() : wc.goForward();
}

function addHistory(url, title) {
  if (!displayUrl(url) || url.startsWith('file:')) return;
  const old = history.findIndex((h) => h.url === url);
  const entry = { url, title: title || (old !== -1 ? history[old].title : ''), ts: Date.now() };
  if (old !== -1) history.splice(old, 1);
  history.unshift(entry);
  if (history.length > 5000) history.length = 5000;
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => writeJson('history.json', history), 2000);
}

// Запоминаем запрос из любого поиска: spotlight, стартовая страница или сам поисковик
function rememberSearch(url) {
  if (!settings.rememberSearches) return;
  const q = searchFromUrl(url);
  if (!q) return;
  searches = searches.filter((s) => s.q.toLowerCase() !== q.toLowerCase());
  searches.unshift({ q, ts: Date.now() });
  if (searches.length > 500) searches.length = 500;
  writeJson('searches.json', searches);
}

function forgetSuggestion({ type, title, url }) {
  if (type === 'query') {
    searches = searches.filter((s) => s.q !== title);
    writeJson('searches.json', searches);
  } else if (type === 'history') {
    history = history.filter((h) => h.url !== url);
    writeJson('history.json', history);
  }
}

// ---------- темы ----------

const defaultTheme = (color) => ({ colors: [color], strength: 55, grain: 0, mode: 'dark' });

function sanitizeTheme(t, fallbackColor) {
  const hex = (c) => /^#[0-9a-f]{6}$/i.test(c);
  let colors = Array.isArray(t?.colors) ? t.colors.filter(hex).slice(0, 3) : [];
  // старая фиолетовая тема Nitro по умолчанию → новая синяя Essential
  if (colors.length === 1 && colors[0].toLowerCase() === '#7c5cff') colors = [COLORS[0]];
  return {
    colors: colors.length ? colors : [fallbackColor],
    strength: Math.max(0, Math.min(100, Number(t?.strength ?? 55))),
    grain: Math.max(0, Math.min(100, Number(t?.grain ?? 0))),
    mode: t?.mode === 'light' ? 'light' : 'dark',
  };
}

// ---------- состояние для интерфейса ----------

function tabInfo(tab) {
  const wc = tab.view?.webContents;
  const url = displayUrl(wc ? wc.getURL() : tab.url);
  return {
    id: tab.id,
    title: (wc ? wc.getTitle() : tab.title) || url || 'Новая вкладка',
    url,
    favicon: tab.favicon || null,
    loading: wc ? wc.isLoading() : false,
    sleeping: !wc,
    audible: wc ? wc.isCurrentlyAudible() : false,
    muted: wc ? wc.isAudioMuted() : false,
    isPrivate: !!tab.isPrivate,
  };
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  const wc = activeWc();
  const cur = activeTab();
  win.webContents.send('state', {
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      icon: w.icon,
      color: w.color,
      theme: w.theme,
      activeTab: w.activeTab,
      tabs: w.id === activeWs ? w.tabIds.map((id) => tabInfo(tabs.get(id))) : [],
    })),
    activeWs,
    icons: ICONS,
    essentials,
    compact,
    peek,
    maximized: win.isMaximized(),
    pinnedExt: pinnedExtensions(),
    fullscreen: win.isFullScreen(),
    nav: {
      url: cur ? tabInfo(cur).url : '',
      pinned: !!cur && essentials.some((e) => e.url === tabInfo(cur).url),
      loading: wc ? wc.isLoading() : false,
      canGoBack: wc ? canGo(wc, -1) : false,
      canGoForward: wc ? canGo(wc, 1) : false,
      zoom: wc ? Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100) : 100,
    },
  });
  const t = cur && tabInfo(cur);
  win.setTitle(t ? `${t.title} — Essential` : 'Essential');
}

// Левый край страницы. При скрытии/показе панели он плавно едет вслед за CSS-анимацией сайдбара
let viewLeft = SIDEBAR_W;
let leftAnim = null;
const targetLeft = () => (compact && !peek ? GAP : SIDEBAR_W);

function placeView() {
  if (!shownView || !win) return;
  const { width, height } = win.getContentBounds();
  if (htmlFullscreen) return shownView.setBounds({ x: 0, y: 0, width, height });
  const top = win.isFullScreen() ? GAP : TOOLBAR_H;
  shownView.setBounds({
    x: viewLeft,
    y: top,
    width: Math.max(0, width - viewLeft - GAP),
    height: Math.max(0, height - top - GAP),
  });
}

function layout() {
  if (!win) return;
  if (!leftAnim) viewLeft = targetLeft();
  placeView();
  const { width, height } = win.getContentBounds();
  for (const [name, view] of Object.entries(overlays)) {
    // панель поиска — маленькая, в правом верхнем углу страницы, чтобы не перекрывать сайт
    if (name === 'find') view.setBounds({ x: width - 380, y: (win.isFullScreen() ? GAP : TOOLBAR_H) + 6, width: 372, height: 64 });
    else view.setBounds({ x: 0, y: 0, width, height });
  }
}

function animateLeft() {
  clearInterval(leftAnim);
  const from = viewLeft;
  const to = targetLeft();
  const start = Date.now();
  const duration = 260;
  leftAnim = setInterval(() => {
    const p = Math.min(1, (Date.now() - start) / duration);
    const eased = 1 - Math.pow(1 - p, 4); // как cubic-bezier(.25,1,.5,1) в CSS
    viewLeft = Math.round(from + (to - from) * eased);
    placeView();
    if (p === 1) {
      clearInterval(leftAnim);
      leftAnim = null;
    }
  }, 8);
}

// ---------- вкладки ----------

function ensureView(tab) {
  if (tab.view) return tab.view;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      spellcheck: settings.spellcheck,
      // приватные вкладки живут в общем сеансе в памяти: ни cookies, ни кэша на диске
      ...(tab.isPrivate ? { partition: 'essential-private' } : {}),
    },
  });
  view.setBackgroundColor('#ffffff');
  if (view.setBorderRadius) view.setBorderRadius(10);
  tab.view = view;
  const wc = view.webContents;
  // в приватных (несохраняемых) сеансах расширения Chrome не поддерживаются
  if (chromeExt && !tab.isPrivate) chromeExt.addTab(wc, win);

  const sync = () => {
    tab.url = wc.getURL();
    tab.title = wc.getTitle();
    sendState();
  };
  for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate-in-page', 'audio-state-changed']) {
    wc.on(ev, sync);
  }
  wc.on('dom-ready', () => refreshNewtab(wc));
  wc.on('will-navigate', (e, url) => {
    if (settingsSection(url)) {
      e.preventDefault();
      return openPanel(settingsSection(url));
    }
    if (!url.startsWith('essential-action:')) return;
    e.preventDefault();
    handleNewtabAction(wc, url);
  });
  wc.on('did-navigate', (_e, url) => {
    sync();
    if (tab.isPrivate) return; // приватные вкладки не оставляют следов
    addHistory(url, '');
    rememberSearch(url);
  });
  wc.on('page-title-updated', (_e, title) => { sync(); if (!tab.isPrivate) addHistory(wc.getURL(), title); });
  wc.on('found-in-page', (_e, r) => {
    if (overlays.find && tab.view === shownView) overlays.find.webContents.send('find:result', { active: r.activeMatchOrdinal, total: r.matches });
  });
  // Ctrl+колесо мыши: Electron сам не масштабирует, только сообщает направление
  wc.on('zoom-changed', (_e, dir) => { if (tab.view === shownView) zoom(dir === 'in' ? 0.5 : -0.5); });
  wc.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) tab.favicon = null;
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons[0];
    sendState();
  });
  wc.setWindowOpenHandler(popupHandler(tab.isPrivate));
  googleLoginUA(wc);
  wc.on('did-create-window', (bw) => {
    bw.webContents.setWindowOpenHandler(popupHandler(tab.isPrivate));
    googleLoginUA(bw.webContents);
  });
  // страница закрыла себя сама (window.close(), например окно входа после OAuth) — закрываем и вкладку
  wc.once('destroyed', () => {
    if (tab.view !== view || !tabs.has(tab.id) || flushed || !win || win.isDestroyed()) return;
    if (shownView === view) {
      win.contentView.removeChildView(view);
      shownView = null;
    }
    tab.view = null;
    closeTab(tab.id);
  });
  wc.on('enter-html-full-screen', () => { htmlFullscreen = true; layout(); });
  wc.on('leave-html-full-screen', () => { htmlFullscreen = false; layout(); });
  wc.on('before-input-event', handleShortcut);
  // в компактном режиме прячем панель, как только мышь ушла на страницу
  wc.on('before-mouse-event', (_e, m) => {
    if (peek && m.type === 'mouseMove') setPeek(false);
  });
  wc.on('context-menu', (_e, p) => showPageMenu(wc, p));

  wc.loadURL(tab.url || NEWTAB_URL);
  return view;
}

// window.open с размерами (окна входа через Google, Telegram и т.п.) — настоящим попапом,
// чтобы у него остался window.opener и он мог вернуть результат входа; остальное — вкладками
function popupHandler(isPrivate) {
  return ({ url, disposition, features }) => {
    if (disposition === 'new-window') {
      const size = Object.fromEntries(features.split(',').map((f) => f.trim().split('=')).filter(([k]) => k === 'width' || k === 'height'));
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: Math.max(320, +size.width || 520),
          height: Math.max(320, +size.height || 640),
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          icon: path.join(__dirname, 'build', 'icon.png'),
        },
      };
    }
    createTab(url, { activate: disposition !== 'background-tab', isPrivate });
    return { action: 'deny' };
  };
}

function createTab(url = NEWTAB_URL, { activate = true, wsId = activeWs, restore = null, isPrivate = false } = {}) {
  const tab = { id: nextId++, wsId, view: null, url, title: restore?.title || '', favicon: restore?.favicon || null, isPrivate };
  tabs.set(tab.id, tab);
  const w = getWs(wsId);
  const idx = w.tabIds.indexOf(w.activeTab);
  if (restore) w.tabIds.push(tab.id);
  else w.tabIds.splice(idx === -1 ? w.tabIds.length : idx + 1, 0, tab.id);

  if (activate) switchTab(tab.id);
  else if (!restore) {
    ensureView(tab);
    sendState();
  }
  return tab.id;
}

function raiseOverlays() {
  for (const name of openOverlays) win.contentView.addChildView(overlays[name]);
}

function showActive() {
  const tab = activeTab();
  const view = tab ? ensureView(tab) : null;
  if (shownView !== view) {
    if (shownView) win.contentView.removeChildView(shownView);
    if (view) win.contentView.addChildView(view);
    shownView = view;
    raiseOverlays(); // оверлеи всегда сверху
    refreshNewtab(view?.webContents); // пространство могло смениться — у него своя тема
  }
  layout();
}

function switchTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (openOverlays.has('find') && getWs(tab.wsId)?.activeTab !== id) closeFind();
  const prev = activeTab();
  if (prev && prev !== tab) autoPip(prev, tab);
  activeWs = tab.wsId;
  getWs().activeTab = id;
  showActive();
  // расширения должны знать активную вкладку (chrome.tabs.query({ active: true }) и окна расширений)
  if (chromeExt && !tab.isPrivate) chromeExt.selectTab(tab.view.webContents);
  if (!openOverlays.size && tab.view.webContents.getURL() !== NEWTAB_URL) tab.view.webContents.focus();
  sendState();
}

// Как в Arc: играющее видео уходит в «картинку в картинке», когда уходишь с вкладки, и возвращается обратно
const PIP_ENTER = `(() => {
  const v = [...document.querySelectorAll('video')].find((v) => !v.paused && !v.ended && v.readyState > 2);
  if (v && !document.pictureInPictureElement) v.requestPictureInPicture().catch(() => {});
})()`;
const PIP_EXIT = 'document.pictureInPictureElement && document.exitPictureInPicture().catch(() => {})';

function autoPip(from, to) {
  if (!settings.autoPip) return;
  // userGesture=true: без «жеста пользователя» браузер не разрешит картинку в картинке
  const fromWc = from.view?.webContents;
  const toWc = to.view?.webContents;
  if (fromWc && !fromWc.isDestroyed() && fromWc.isCurrentlyAudible()) fromWc.executeJavaScript(PIP_ENTER, true).catch(() => {});
  if (toWc && !toWc.isDestroyed()) toWc.executeJavaScript(PIP_EXIT, true).catch(() => {});
}

let flushed = false; // окно уже закрывается: сессия сохранена, вкладки больше не трогаем

function destroyTab(tab) {
  const view = tab.view;
  tab.view = null; // до close(): 'destroyed' не должен закрыть вкладку второй раз
  if (view) {
    if (shownView === view) {
      win.contentView.removeChildView(view);
      shownView = null;
    }
    if (!view.webContents?.isDestroyed()) {
      if (chromeExt && !tab.isPrivate) chromeExt.removeTab(view.webContents);
      view.webContents.close();
    }
  }
  tabs.delete(tab.id);
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const w = getWs(tab.wsId);
  const url = tab.view ? tab.view.webContents.getURL() : tab.url;
  if (displayUrl(url)) closedTabs.push({ url, wsId: tab.wsId });
  const idx = w.tabIds.indexOf(id);
  w.tabIds.splice(idx, 1);
  destroyTab(tab);
  if (w.activeTab === id) {
    w.activeTab = null;
    if (w.tabIds.length) w.activeTab = w.tabIds[Math.min(idx, w.tabIds.length - 1)];
  }
  if (w.id !== activeWs) return sendState();
  if (!w.tabIds.length) return createTab(); // пустое пространство — открываем чистую вкладку
  switchTab(w.activeTab);
}

function cycleTab(step) {
  const w = getWs();
  const idx = w.tabIds.indexOf(w.activeTab);
  switchTab(w.tabIds[(idx + step + w.tabIds.length) % w.tabIds.length]);
}

function moveTab(id, toIndex) {
  const tab = tabs.get(id);
  if (!tab) return;
  const list = getWs(tab.wsId).tabIds;
  const from = list.indexOf(id);
  list.splice(from, 1);
  list.splice(from < toIndex ? toIndex - 1 : toIndex, 0, id);
  sendState();
}

function moveTabToWs(id, wsId) {
  const tab = tabs.get(id);
  if (!tab || tab.wsId === wsId) return;
  const src = getWs(tab.wsId);
  const dst = getWs(wsId);
  const idx = src.tabIds.indexOf(id);
  src.tabIds.splice(idx, 1);
  dst.tabIds.push(id);
  tab.wsId = wsId;
  if (shownView === tab.view && tab.view) {
    win.contentView.removeChildView(tab.view);
    shownView = null;
  }
  if (src.activeTab === id) src.activeTab = src.tabIds[Math.min(idx, src.tabIds.length - 1)] ?? null;
  if (!dst.activeTab) dst.activeTab = id;
  if (src.id === activeWs && !src.tabIds.length) return createTab();
  showActive();
  sendState();
}

// ---------- рабочие пространства ----------

function createWorkspace({ name, icon, color, theme } = {}) {
  const n = workspaces.length;
  const c = color || COLORS[n % COLORS.length];
  const w = {
    id: nextId++,
    name: name || (n ? `Пространство ${n + 1}` : 'Дом'),
    icon: icon || ICONS[n % 12],
    color: c,
    theme: theme ? sanitizeTheme(theme, c) : defaultTheme(c),
    tabIds: [],
    activeTab: null,
  };
  w.color = w.theme.colors[0];
  workspaces.push(w);
  return w;
}

function switchWorkspace(id) {
  const w = getWs(id);
  if (!w) return;
  activeWs = id;
  if (!w.tabIds.length) return createTab();
  switchTab(w.activeTab ?? w.tabIds[0]);
}

function updateWorkspace(id, patch) {
  const w = getWs(id);
  if (!w) return;
  if (typeof patch.name === 'string' && patch.name.trim()) w.name = patch.name.trim().slice(0, 40);
  if (typeof patch.icon === 'string' && patch.icon.trim()) w.icon = [...patch.icon.trim()].slice(0, 2).join('');
  if (patch.theme) {
    w.theme = sanitizeTheme(patch.theme, w.color);
    w.color = w.theme.colors[0];
    refreshNewtab(activeWc());
  }
  sendState();
}

function deleteWorkspace(id) {
  if (workspaces.length < 2) return;
  const w = getWs(id);
  for (const tid of [...w.tabIds]) destroyTab(tabs.get(tid));
  workspaces = workspaces.filter((x) => x !== w);
  if (activeWs === id) switchWorkspace(workspaces[0].id);
  else sendState();
}

// ---------- компактный режим ----------

function setCompact(on) {
  compact = on;
  peek = false;
  sendState();
  animateLeft();
}

function setPeek(on) {
  if (!compact || peek === on) return;
  peek = on;
  sendState();
  animateLeft();
}

// ---------- Essentials (закреплённые сайты) ----------

function addEssential(url, title, silent = false) {
  if (!displayUrl(url) || essentials.some((e) => e.url === url)) return false;
  essentials.push({ url, title: title || url });
  if (!silent) {
    writeJson('essentials.json', essentials);
    sendState();
    refreshNewtab(activeWc());
  }
  return true;
}

function removeEssential(url) {
  essentials = essentials.filter((e) => e.url !== url);
  writeJson('essentials.json', essentials);
  sendState();
  refreshNewtab(activeWc());
}

function openEssential(url) {
  const w = getWs();
  const found = w.tabIds.map((id) => tabs.get(id)).find((t) => originOf(tabInfo(t).url) === originOf(url));
  if (found) return switchTab(found.id);
  const cur = activeTab();
  if (cur && !tabInfo(cur).url) {
    ensureView(cur).webContents.loadURL(url);
    return;
  }
  createTab(url);
}

// ---------- оверлеи: spotlight и панель настроек ----------

function overlay(name, file) {
  if (!overlays[name]) {
    const view = new WebContentsView({ webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true } });
    view.setBackgroundColor('#00000000');
    view.webContents.on('will-navigate', (e) => e.preventDefault());
    view.webContents.loadFile(file);
    overlays[name] = view;
  }
  return overlays[name];
}

function showOverlay(name, file, channel, payload) {
  const view = overlay(name, file);
  openOverlays.add(name);
  win.contentView.addChildView(view);
  layout();
  const send = () => {
    view.webContents.focus();
    view.webContents.send(channel, payload);
  };
  if (view.webContents.isLoading()) view.webContents.once('did-finish-load', send);
  else send();
}

// Оверлей сам проигрывает анимацию закрытия, поэтому убираем его с задержкой
function hideOverlay(name, delay = 0) {
  if (!openOverlays.delete(name)) return;
  activeWc()?.focus();
  setTimeout(() => {
    if (!openOverlays.has(name)) win.contentView.removeChildView(overlays[name]);
  }, delay);
}

// mode: new — новая вкладка; current — адрес текущей; search — пустой поиск в текущей (Ctrl+K); history — недавнее (Ctrl+H)
function openSpotlight(mode) {
  const cur = activeTab();
  showOverlay('spotlight', 'spotlight.html', 'spotlight:open', {
    mode: mode === 'search' ? 'current' : mode === 'history' ? 'new' : mode,
    url: mode === 'current' && cur ? tabInfo(cur).url : '',
    color: getWs()?.color,
  });
}

function openPanel(section = 'appearance') {
  hideOverlay('spotlight');
  showOverlay('panel', 'panel.html', 'panel:open', section);
}

function suggest(input) {
  const raw = input.trim();
  const q = raw.toLowerCase();
  const out = [];
  const query = (s) => ({ type: 'query', title: s.q, url: toUrl(s.q) });
  if (!q) {
    for (const s of searches.slice(0, 5)) out.push(query(s));
    for (const h of history.slice(0, 4)) out.push({ type: 'history', title: h.title || h.url, url: h.url });
    return out;
  }
  const direct = parseUrl(raw);
  out.push(direct
    ? { type: 'url', title: direct, url: direct }
    : { type: 'search', title: raw, url: toUrl(raw), engine: (ENGINES[settings.searchEngine] || ENGINES.google).name });
  // «настройки», «settings», «микрофон» — подсказываем страницу настроек
  if (!settingsSection(raw) && /^(настр|settings?|парам|микроф|камер|essential:)/i.test(q)) {
    const sec = /^(микроф|камер)/i.test(q) ? 'devices' : '';
    out.splice(1, 0, { type: 'url', title: 'Настройки Essential', url: `essential://settings${sec ? '/' + sec : ''}` });
  }
  // прошлые запросы: сначала те, что начинаются с введённого, потом остальные совпадения
  const past = searches.filter((s) => s.q.toLowerCase() !== q && s.q.toLowerCase().includes(q));
  past.sort((a, b) => b.q.toLowerCase().startsWith(q) - a.q.toLowerCase().startsWith(q));
  for (const s of past.slice(0, 4)) out.push(query(s));
  const match = (t, u) => (t || '').toLowerCase().includes(q) || (u || '').toLowerCase().includes(q);
  const seen = new Set();
  for (const w of workspaces) {
    for (const id of w.tabIds) {
      const t = tabInfo(tabs.get(id));
      if (t.url && match(t.title, t.url) && out.length < 8) {
        out.push({ type: 'tab', title: t.title, url: t.url, tabId: id, ws: w.icon });
        seen.add(t.url);
      }
    }
  }
  for (const e of essentials) {
    if (!seen.has(e.url) && match(e.title, e.url)) {
      out.push({ type: 'essential', title: e.title, url: e.url });
      seen.add(e.url);
    }
  }
  let nb = 0;
  for (const b of bookmarks) {
    if (nb >= 3) break;
    if (!seen.has(b.url) && match(b.title, b.url)) {
      out.push({ type: 'bookmark', title: b.title, url: b.url });
      seen.add(b.url);
      nb++;
    }
  }
  for (const h of history) {
    if (out.length >= 13) break;
    if (!seen.has(h.url) && match(h.title, h.url)) {
      out.push({ type: 'history', title: h.title || h.url, url: h.url });
      seen.add(h.url);
    }
  }
  return out;
}

// ---------- импорт ----------

function runImport(ids, opts) {
  const d = importer.collect(ids, searchFromUrl);
  const added = { history: 0, bookmarks: 0, searches: 0, essentials: 0 };

  if (opts.history) {
    const byUrl = new Map(history.map((h) => [h.url, h]));
    for (const h of d.history) {
      const old = byUrl.get(h.url);
      if (!old) { byUrl.set(h.url, h); added.history++; }
      else if (h.ts > old.ts) byUrl.set(h.url, { ...h, title: h.title || old.title });
    }
    history = [...byUrl.values()].sort((a, b) => b.ts - a.ts).slice(0, 5000);
    writeJson('history.json', history);
  }
  if (opts.bookmarks) {
    const known = new Set(bookmarks.map((b) => b.url));
    for (const b of d.bookmarks) {
      if (!known.has(b.url)) { known.add(b.url); bookmarks.push(b); added.bookmarks++; }
    }
    writeJson('bookmarks.json', bookmarks);
  }
  if (opts.searches) {
    const byQ = new Map(searches.map((s) => [s.q.toLowerCase(), s]));
    for (const s of d.searches) {
      const k = s.q.toLowerCase();
      if (!byQ.has(k)) { byQ.set(k, s); added.searches++; }
    }
    searches = [...byQ.values()].sort((a, b) => b.ts - a.ts).slice(0, 500);
    writeJson('searches.json', searches);
  }
  if (opts.essentials) {
    for (const b of d.bar) {
      if (essentials.length >= 12) break;
      if (addEssential(b.url, b.title, true)) added.essentials++;
    }
    writeJson('essentials.json', essentials);
  }
  sendState();
  return { added, errors: d.errors };
}

// ---------- настройки ----------

function setSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) return;
  settings[key] = value;
  saveSettings();
  if (key === 'spellcheck') session.defaultSession.setSpellCheckerEnabled(!!value);
  if (key === 'searchEngine') refreshNewtab(activeWc());
  if (key === 'doNotTrack') applyDoNotTrack();
}

// «Не отслеживать» вешаем на webRequest только когда включено: пока Electron слушает webRequest,
// расширения не получают свои chrome.webRequest (ограничение electron-chrome-extensions)
// у сессии один обработчик заголовков: и «не отслеживать», и вход в Google
function applyDoNotTrack() {
  const headers = (d, cb) => {
    if (settings.doNotTrack) {
      d.requestHeaders.DNT = '1';
      d.requestHeaders['Sec-GPC'] = '1';
    }
    if (GOOGLE_LOGIN.test(d.url)) {
      d.requestHeaders['User-Agent'] = FIREFOX_UA;
      for (const h of Object.keys(d.requestHeaders)) if (/^sec-ch-ua/i.test(h)) delete d.requestHeaders[h];
    } else if (d.requestHeaders['User-Agent'] === FIREFOX_UA) {
      // первый запрос после ухода со страницы входа ещё несёт user agent Firefox
      d.requestHeaders['User-Agent'] = app.userAgentFallback;
    }
    cb({ requestHeaders: d.requestHeaders });
  };
  for (const ses of [session.defaultSession, session.fromPartition('essential-private')]) ses.webRequest.onBeforeSendHeaders(headers);
}

// navigator.userAgent на странице входа тоже должен быть от Firefox, иначе Google видит несовпадение
function googleLoginUA(wc) {
  wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    const ua = GOOGLE_LOGIN.test(url) ? FIREFOX_UA : app.userAgentFallback;
    if (wc.getUserAgent() !== ua) wc.setUserAgent(ua);
  });
}

function clearData({ history: h, searches: s, cache, cookies }) {
  const ses = session.defaultSession;
  const jobs = [];
  if (h) { history = []; writeJson('history.json', history); }
  if (s) { searches = []; writeJson('searches.json', searches); }
  if (cache) jobs.push(ses.clearCache());
  if (cookies) jobs.push(ses.clearStorageData());
  return Promise.all(jobs).then(() => true);
}

// Сессионные cookies Chromium на диск не пишет, и после перезапуска вход на многих сайтах слетает.
// Как Chrome с «продолжить с того же места»: пока включено восстановление вкладок, храним их 30 дней.
const SESSION_COOKIE_TTL = 30 * 24 * 3600;

function keepSessionCookie(_e, c, _cause, removed) {
  if (removed || !c.session || !settings.restoreSession) return;
  const details = {
    url: `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: Date.now() / 1000 + SESSION_COOKIE_TTL,
  };
  if (!c.hostOnly) details.domain = c.domain;
  // перезаписанная cookie уже постоянная, поэтому повторно сюда не попадёт
  session.defaultSession.cookies.set(details).catch(() => {});
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setSpellCheckerEnabled(settings.spellcheck);
  ses.setSpellCheckerLanguages(['ru', 'en-US']);
  ses.cookies.on('changed', keepSessionCookie);
  // выбранные в настройках микрофон и камера — подставляются сайтам в getUserMedia
  const mediaPreload = path.join(__dirname, 'media-preload.js');
  if (ses.registerPreloadScript) ses.registerPreloadScript({ type: 'frame', id: 'essential-media', filePath: mediaPreload });
  else ses.setPreloads([...ses.getPreloads(), mediaPreload]);

  applyDoNotTrack();

  // Разрешения сайтов: спрашивать / разрешать / блокировать
  const LABEL = { notifications: 'уведомления', media: 'камера и микрофон', geolocation: 'местоположение' };
  const decided = new Map();
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (!LABEL[permission]) return cb(true);
    // свои страницы браузера (настройки показывают список микрофонов и камер) — без вопросов
    if ((details.requestingUrl || '').startsWith(pathToFileURL(__dirname).href)) return cb(true);
    const origin = originOf(details.requestingUrl || wc.getURL());
    // своё решение для сайта (из панели «Сайт») важнее общего
    const mode = sitePerms[origin]?.[permission] || settings.permissions[permission];
    if (mode !== 'ask') return cb(mode === 'allow');
    const memo = origin + '|' + permission;
    if (decided.has(memo)) return cb(decided.get(memo));
    dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Разрешить', 'Блокировать'],
      defaultId: 0,
      cancelId: 1,
      title: 'Разрешение',
      message: `${origin.replace(/^https?:\/\//, '')} запрашивает доступ: ${LABEL[permission]}`,
    }).then(({ response }) => {
      decided.set(memo, response === 0);
      cb(response === 0);
    });
  });

  ses.on('will-download', (_e, item) => {
    const name = item.getFilename();
    if (!settings.downloadsAsk) {
      const dir = settings.downloadsDir || app.getPath('downloads');
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      let target = path.join(dir, name);
      for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${base} (${i})${ext}`);
      item.setSavePath(target);
    }
    trackDownload(item);
  });
}

// ---------- загрузки: кружок прогресса на панели и список, как в Arc ----------

const downloads = []; // { id, name, url, path, received, total, speed, state, started, icon }
const dlItems = new Map(); // id -> DownloadItem, пока загрузка идёт
let dlId = 0;
let dlTimer = null;

function trackDownload(item) {
  const d = {
    id: ++dlId,
    name: item.getFilename(),
    url: item.getURL(),
    path: item.getSavePath(),
    received: 0,
    total: item.getTotalBytes(),
    speed: 0,
    state: 'progressing',
    started: Date.now(),
    icon: null,
  };
  downloads.unshift(d);
  if (downloads.length > 30) downloads.length = 30;
  dlItems.set(d.id, item);
  item.on('updated', (_e, state) => {
    d.received = item.getReceivedBytes();
    d.total = item.getTotalBytes();
    // сглаживаем скорость, иначе она скачет на каждом обновлении
    const raw = item.getCurrentBytesPerSecond ? item.getCurrentBytesPerSecond() : 0;
    d.speed = d.speed ? d.speed * 0.85 + raw * 0.15 : raw;
    d.path = item.getSavePath() || d.path;
    d.state = item.isPaused() ? 'paused' : state;
    pushDownloads();
  });
  item.once('done', async (_e, state) => {
    d.state = state; // completed | cancelled | interrupted
    d.received = item.getReceivedBytes();
    d.path = item.getSavePath() || d.path;
    d.speed = 0;
    dlItems.delete(d.id);
    if (state === 'completed') {
      try { d.icon = (await app.getFileIcon(d.path, { size: 'normal' })).toDataURL(); } catch {}
    } else if (state === 'interrupted') {
      toast(`Загрузка прервана: ${d.name}`);
    }
    pushDownloads(true);
  });
  pushDownloads(true);
}

// Сводка для кружка: общий прогресс по активным загрузкам
function downloadSummary() {
  const active = downloads.filter((d) => d.state === 'progressing' || d.state === 'paused');
  const total = active.reduce((s, d) => s + d.total, 0);
  const received = active.reduce((s, d) => s + d.received, 0);
  const known = active.length && active.every((d) => d.total > 0);
  return {
    count: downloads.length,
    active: active.length,
    progress: known ? received / total : null, // null — размер неизвестен, кружок просто крутится
    paused: active.length > 0 && active.every((d) => d.state === 'paused'),
    lastDone: downloads[0]?.state === 'completed' ? downloads[0].id : null,
  };
}

// Не чаще 5 раз в секунду: 'updated' у DownloadItem приходит очень часто
function pushDownloads(now = false) {
  const send = () => {
    dlTimer = null;
    win?.webContents.send('downloads', downloadSummary());
    if (openOverlays.has('downloads')) overlays.downloads.webContents.send('downloads:list', downloads);
  };
  if (now) {
    clearTimeout(dlTimer);
    send();
  } else if (!dlTimer) {
    dlTimer = setTimeout(send, 200);
  }
}

function openDownloads(x) {
  showOverlay('downloads', 'downloads.html', 'downloads:open', { x, list: downloads, color: getWs()?.color });
}

ipcMain.on('dl:open', (_e, x) => openDownloads(x));
ipcMain.on('dl:close', () => hideOverlay('downloads', 200));
ipcMain.on('dl:action', (_e, id, action) => {
  const d = downloads.find((x) => x.id === id);
  const item = dlItems.get(id);
  if (!d) return;
  if (action === 'pause') item?.pause();
  else if (action === 'resume' && item?.canResume()) item.resume();
  else if (action === 'cancel') item?.cancel();
  else if (action === 'open') shell.openPath(d.path).then((err) => err && toast('Файл не найден — возможно, его переместили'));
  else if (action === 'show') shell.showItemInFolder(d.path);
  else if (action === 'remove') downloads.splice(downloads.indexOf(d), 1);
  else if (action === 'retry') { downloads.splice(downloads.indexOf(d), 1); win.webContents.downloadURL(d.url); }
  pushDownloads(true);
});
ipcMain.on('dl:clear', () => {
  for (let i = downloads.length - 1; i >= 0; i--) if (!dlItems.has(downloads[i].id)) downloads.splice(i, 1);
  pushDownloads(true);
});
ipcMain.on('dl:folder', () => { hideOverlay('downloads', 200); shell.openPath(settings.downloadsDir || app.getPath('downloads')); });

function restart() {
  saveSession();
  session.defaultSession.cookies.flushStore().finally(() => {
    app.relaunch();
    app.exit(0);
  });
}

// ---------- браузер по умолчанию и автозапуск ----------

const isDefaultBrowser = () => app.isDefaultProtocolClient('https');

// Регистрирует Essential как браузер в HKCU (без прав администратора) и открывает выбор браузера в Windows.
// Сам выбор Windows 10/11 разрешает сделать только пользователю.
function registerAsBrowser() {
  const exe = process.execPath;
  const launch = app.isPackaged ? `"${exe}"` : `"${exe}" "${app.getAppPath()}"`;
  const icon = `"${exe}",0`;
  const base = 'HKCU\\Software\\Clients\\StartMenuInternet\\Essential';
  const cls = 'HKCU\\Software\\Classes\\EssentialHTML';
  const entries = [
    [cls, '', 'Essential HTML Document'],
    [cls + '\\DefaultIcon', '', icon],
    [cls + '\\shell\\open\\command', '', `${launch} "%1"`],
    [base, '', 'Essential'],
    [base + '\\DefaultIcon', '', icon],
    [base + '\\shell\\open\\command', '', launch],
    [base + '\\Capabilities', 'ApplicationName', 'Essential'],
    [base + '\\Capabilities', 'ApplicationDescription', 'Браузер Essential на Chromium'],
    [base + '\\Capabilities', 'ApplicationIcon', icon],
    [base + '\\Capabilities\\URLAssociations', 'http', 'EssentialHTML'],
    [base + '\\Capabilities\\URLAssociations', 'https', 'EssentialHTML'],
    [base + '\\Capabilities\\FileAssociations', '.html', 'EssentialHTML'],
    [base + '\\Capabilities\\FileAssociations', '.htm', 'EssentialHTML'],
    [base + '\\Capabilities\\StartMenu', 'StartMenuInternet', 'Essential'],
    ['HKCU\\Software\\RegisteredApplications', 'Essential', 'Software\\Clients\\StartMenuInternet\\Essential\\Capabilities'],
  ];
  try {
    for (const [key, name, value] of entries) {
      execFileSync('reg', ['add', key, ...(name ? ['/v', name] : ['/ve']), '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true });
    }
  } catch (e) {
    console.error('register browser failed', e);
  }
  shell.openExternal('ms-settings:defaultapps?registeredAppUser=Essential');
  return true;
}

const setAutostart = (on) => app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
const getAutostart = () => app.getLoginItemSettings({ path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }).openAtLogin;

function openOnboarding() {
  hideOverlay('panel');
  hideOverlay('spotlight');
  showOverlay('onboarding', 'onboarding.html', 'onboarding:open');
}

// ---------- страница новой вкладки ----------

// Новая вкладка — обычная страница без доступа к IPC, поэтому тему, поисковик и Essentials ей передаём сами
function refreshNewtab(wc) {
  if (!wc || wc.isDestroyed() || wc.getURL() !== NEWTAB_URL) return;
  const engine = ENGINES[settings.searchEngine] || ENGINES.google;
  const data = { theme: getWs()?.theme, engine: { name: engine.name, url: engine.url }, essentials: essentials.slice(0, 12) };
  wc.executeJavaScript(`window.essentialInit && window.essentialInit(${JSON.stringify(data)})`).catch(() => {});
}

// Плитки новой вкладки просят добавить/убрать сайт переходом на essential-action:… — принимаем только от неё
function handleNewtabAction(wc, url) {
  if (wc.getURL() !== NEWTAB_URL) return;
  const u = new URL(url);
  const target = u.searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) return;
  if (u.pathname === 'add') addEssential(target, u.searchParams.get('title') || target);
  else if (u.pathname === 'remove') removeEssential(target);
}

// ---------- прочее ----------

function zoom(delta) {
  const wc = activeWc();
  if (!wc) return;
  wc.setZoomLevel(delta === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + delta)));
  sendState();
}

function toast(text) {
  win?.webContents.send('toast', text);
}

// Сочетания клавиш — те же, что в Chrome, плюс свои (Ctrl+S — сайдбар, Ctrl+Alt+цифра — пространства).
// Каждая запись: [условие, действие]. Порядок важен: сначала более длинные сочетания.
function handleShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const { shift, alt } = input;
  const key = input.key.toLowerCase();
  const code = input.code || '';
  const wc = activeWc();
  const url = activeTab() ? tabInfo(activeTab()).url : '';
  const only = (c, s = false, a = false) => ctrl === c && shift === s && alt === a;
  const digit = /^Digit[1-9]$/.test(code) ? +code.slice(5) : 0;
  const tabList = getWs()?.tabIds || [];

  const keys = [
    // вкладки и окна
    [only(true, false, true) && digit, () => { const w = workspaces[digit - 1]; if (w) switchWorkspace(w.id); }],
    [only(true) && digit, () => switchTab(digit === 9 ? tabList[tabList.length - 1] : tabList[digit - 1])],
    [only(true, true) && code === 'KeyT', () => { const c = closedTabs.pop(); if (c) createTab(c.url, { wsId: getWs(c.wsId) ? c.wsId : activeWs }); }],
    [only(true, true) && code === 'KeyN', () => createTab(NEWTAB_URL, { isPrivate: true })],
    [only(true) && (code === 'KeyT' || code === 'KeyN'), () => openSpotlight('new')],
    [(only(true) && (code === 'KeyW' || key === 'f4')), () => closeTab(getWs().activeTab)],
    [only(true, true) && code === 'KeyW', () => win.close()],
    [ctrl && !alt && key === 'tab', () => cycleTab(shift ? -1 : 1)],
    [only(true) && key === 'pagedown', () => cycleTab(1)],
    [only(true) && key === 'pageup', () => cycleTab(-1)],
    [only(true, true) && key === 'pagedown', () => moveActiveTab(1)],
    [only(true, true) && key === 'pageup', () => moveActiveTab(-1)],
    // адрес и поиск
    [(only(true) && (code === 'KeyL' || code === 'KeyK' || code === 'KeyE')) || only(false, false, true) && code === 'KeyD' || (only(false) && key === 'f6'),
      () => openSpotlight(code === 'KeyK' || code === 'KeyE' ? 'search' : 'current')],
    [only(true) && code === 'KeyF', () => openFind()],
    [(only(true) && code === 'KeyG') || (only(false) && key === 'f3'), () => findNext(true)],
    [(only(true, true) && code === 'KeyG') || (only(false, true) && key === 'f3'), () => findNext(false)],
    // навигация
    [(only(false, true) && key === 'f5') || (only(true) && key === 'f5') || (only(true, true) && code === 'KeyR'), () => wc?.reloadIgnoringCache()],
    [(only(false) && key === 'f5') || (only(true) && code === 'KeyR'), () => wc?.reload()],
    [only(false, false, true) && key === 'arrowleft', () => wc && go(wc, -1)],
    [only(false, false, true) && key === 'arrowright', () => wc && go(wc, 1)],
    [only(false, false, true) && key === 'home', () => wc?.loadURL(NEWTAB_URL)],
    // страница
    [only(true) && code === 'KeyP', () => wc?.print()],
    [only(true) && code === 'KeyO', () => openLocalFile()],
    [only(true) && code === 'KeyU', () => url && createTab('view-source:' + url)],
    [only(true) && code === 'KeyD', () => { const t = tabInfo(activeTab()); if (addEssential(t.url, t.title)) toast('Сайт закреплён'); }],
    [only(true, true) && code === 'KeyC', () => { if (url) { clipboard.writeText(url); toast('Ссылка скопирована'); } }],
    [only(true) && (key === '=' || key === '+'), () => zoom(0.5)],
    [only(true) && key === '-', () => zoom(-0.5)],
    [only(true) && key === '0', () => zoom(0)],
    [key === 'f12' || (only(true, true) && (code === 'KeyI' || code === 'KeyJ')), () => wc?.toggleDevTools()],
    // браузер
    [only(true) && code === 'KeyS', () => setCompact(!compact)],
    [only(true, false, true) && code === 'KeyC', () => setCompact(!compact)],
    [only(true) && code === 'Comma', () => openPanel()],
    [only(true) && code === 'KeyH', () => openSpotlight('history')],
    // панель загрузок; координату кружка знает только интерфейс, поэтому просим его открыть
    [only(true) && code === 'KeyJ', () => win.webContents.send('ui:openDownloads')],
    [only(true, true) && key === 'delete', () => openPanel('privacy')],
    [only(false) && key === 'f11', () => win.setFullScreen(!win.isFullScreen())],
  ];

  const hit = keys.find(([when]) => when);
  if (hit) {
    event.preventDefault();
    hit[1]();
    return;
  }
  // Esc останавливает загрузку, но саму клавишу сайту не съедаем
  if (only(false) && key === 'escape' && wc?.isLoading()) wc.stop();
}

function moveActiveTab(step) {
  const list = getWs().tabIds;
  const from = list.indexOf(getWs().activeTab);
  const to = Math.max(0, Math.min(list.length - 1, from + step));
  if (to === from) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  sendState();
}

async function openLocalFile() {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Веб-страницы, PDF, картинки', extensions: ['html', 'htm', 'pdf', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt'] }, { name: 'Все файлы', extensions: ['*'] }],
  });
  if (!r.canceled && r.filePaths[0]) createTab(pathToFileURL(r.filePaths[0]).href);
}

// ---------- поиск на странице (Ctrl+F) ----------

let findText = '';

function openFind() {
  if (!activeWc()) return;
  showOverlay('find', 'find.html', 'find:open', { text: findText, color: getWs()?.color });
}

function findNext(forward) {
  const wc = activeWc();
  if (!wc || !findText) return openFind();
  wc.findInPage(findText, { forward, findNext: true });
}

function closeFind() {
  activeWc()?.stopFindInPage('keepSelection');
  hideOverlay('find', 160);
}

function showPageMenu(wc, p) {
  const items = [];
  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    items.push(
      { label: 'Добавить в словарь', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
      { type: 'separator' },
    );
  }
  if (p.linkURL) {
    items.push(
      { label: 'Открыть ссылку в новой вкладке', click: () => createTab(p.linkURL, { activate: false }) },
      { label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      { label: 'Открыть картинку в новой вкладке', click: () => createTab(p.srcURL, { activate: false }) },
      { label: 'Сохранить картинку как…', click: () => wc.downloadURL(p.srcURL) },
      { label: 'Копировать адрес картинки', click: () => clipboard.writeText(p.srcURL) },
      { type: 'separator' },
    );
  }
  if (p.isEditable) {
    items.push(
      { role: 'cut', label: 'Вырезать' },
      { role: 'copy', label: 'Копировать' },
      { role: 'paste', label: 'Вставить' },
      { role: 'selectAll', label: 'Выделить всё' },
      { type: 'separator' },
    );
  } else if (p.selectionText) {
    const q = p.selectionText.trim();
    items.push(
      { role: 'copy', label: 'Копировать' },
      { label: `Найти «${q.length > 24 ? q.slice(0, 24) + '…' : q}»`, click: () => createTab(toUrl(q)) },
      { type: 'separator' },
    );
  }
  // пункты, которые добавили расширения через chrome.contextMenus
  const extItems = chromeExt && tabByWc(wc) && !tabByWc(wc).isPrivate ? chromeExt.getContextMenuItems(wc, p) : [];
  if (extItems.length) items.push(...extItems, { type: 'separator' });
  items.push(
    { label: 'Назад', enabled: canGo(wc, -1), click: () => go(wc, -1) },
    { label: 'Вперёд', enabled: canGo(wc, 1), click: () => go(wc, 1) },
    { label: 'Обновить', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Просмотреть код', click: () => wc.inspectElement(p.x, p.y) },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
}

function showTabMenu(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const t = tabInfo(tab);
  const w = getWs(tab.wsId);
  Menu.buildFromTemplate([
    { label: 'Обновить', click: () => ensureView(tab).webContents.reload() },
    { label: 'Дублировать', enabled: !!t.url, click: () => createTab(t.url) },
    { label: 'Копировать ссылку', enabled: !!t.url, click: () => clipboard.writeText(t.url) },
    { label: t.muted ? 'Включить звук' : 'Выключить звук', enabled: !!tab.view, click: () => { tab.view.webContents.setAudioMuted(!t.muted); sendState(); } },
    { label: 'Закрепить сайт', enabled: !!t.url, click: () => addEssential(t.url, t.title) },
    {
      label: 'Перенести в пространство',
      enabled: workspaces.length > 1,
      submenu: workspaces.filter((x) => x.id !== tab.wsId).map((x) => ({
        label: `${x.icon}  ${x.name}`,
        click: () => moveTabToWs(id, x.id),
      })),
    },
    { type: 'separator' },
    { label: 'Закрыть другие вкладки', enabled: w.tabIds.length > 1, click: () => w.tabIds.filter((x) => x !== id).forEach((x) => closeTab(x)) },
    { label: 'Закрыть вкладку', accelerator: 'Ctrl+W', click: () => closeTab(id) },
  ]).popup({ window: win });
}

// ---------- сессия ----------

function saveSession() {
  writeJson('session.json', {
    activeWs: workspaces.findIndex((w) => w.id === activeWs),
    compact,
    workspaces: workspaces.map((w) => {
      // приватные вкладки в сессию не попадают
      const kept = w.tabIds.filter((id) => !tabs.get(id).isPrivate);
      return {
        name: w.name,
        icon: w.icon,
        color: w.color,
        theme: w.theme,
        active: Math.max(0, kept.indexOf(w.activeTab)),
        tabs: kept.map((id) => {
          const t = tabInfo(tabs.get(id));
          return { url: t.url, title: t.title, favicon: t.favicon };
        }),
      };
    }),
  });
  writeJson('history.json', history);
}

function restoreSession() {
  const s = readJson('session.json', null);
  if (!s?.workspaces?.length) {
    activeWs = createWorkspace().id;
    createTab();
    return;
  }
  compact = !!s.compact;
  for (const sw of s.workspaces) {
    const w = createWorkspace(sw);
    activeWs = w.id;
    if (!settings.restoreSession) continue; // пространства и темы остаются, вкладки — нет
    for (const t of sw.tabs) createTab(t.url || NEWTAB_URL, { activate: false, restore: t });
    w.activeTab = w.tabIds[sw.active] ?? w.tabIds[0] ?? null;
  }
  const w = workspaces[s.activeWs] || workspaces[0];
  switchWorkspace(w.id);
}

// ---------- IPC ----------

const on = (ch, fn) => ipcMain.on(ch, (_e, ...args) => fn(...args));
const handle = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));

on('ui:ready', () => {
  if (!workspaces.length) restoreSession();
  else sendState();
  if (pendingUrl) {
    createTab(pendingUrl);
    pendingUrl = null;
  }
  if (!settings.onboarded) openOnboarding();
});
on('onboarding:open', openOnboarding);
on('onboarding:finish', () => {
  settings.onboarded = true;
  saveSettings();
  hideOverlay('onboarding');
});
handle('onboarding:info', () => ({
  settings,
  engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
  presets: THEME_PRESETS,
  workspace: { theme: getWs().theme },
  system: { isDefault: isDefaultBrowser(), autostart: getAutostart() },
}));
handle('system:makeDefault', registerAsBrowser);
on('system:autostart', setAutostart);
on('win:minimize', () => win.minimize());
on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
on('win:close', () => win.close());
on('tab:switch', switchTab);
on('tab:close', closeTab);
on('tab:menu', showTabMenu);
on('tab:move', moveTab);
on('tab:toWs', moveTabToWs);
on('tab:mute', (id) => {
  const wc = tabs.get(id)?.view?.webContents;
  if (wc) { wc.setAudioMuted(!wc.isAudioMuted()); sendState(); }
});
on('tab:copyUrl', () => {
  const u = activeTab() && tabInfo(activeTab()).url;
  if (u) { clipboard.writeText(u); toast('Ссылка скопирована'); }
});
on('essential:toggle', () => {
  const t = activeTab() && tabInfo(activeTab());
  if (!t?.url) return;
  if (essentials.some((e) => e.url === t.url)) { removeEssential(t.url); toast('Сайт откреплён'); }
  else if (addEssential(t.url, t.title)) toast('Сайт закреплён');
});
// ---------- панель «Сайт» (как Site Controls в Arc) ----------

async function siteInfo() {
  const tab = activeTab();
  const wc = tab?.view?.webContents;
  const url = tab && tabInfo(tab).url;
  const common = {
    color: getWs()?.color,
    autoPip: settings.autoPip,
    extensions: extList().map((e) => ({ ...e, pinned: settings.pinnedExtensions.includes(e.id) })),
  };
  // новая вкладка и служебные страницы: расширения и PiP доступны, настроек сайта нет
  if (!wc || !url || !/^https?:/i.test(url)) return { ...common, internal: true, host: url ? url.split('/')[0] : 'Новая вкладка', url: url || '' };
  const origin = originOf(url);
  const own = sitePerms[origin] || {};
  const perms = {};
  for (const p of Object.keys(DEFAULT_SETTINGS.permissions)) perms[p] = { site: own[p] || null, global: settings.permissions[p] };
  return {
    origin,
    host: origin.replace(/^https?:\/\//, ''),
    url,
    title: tabInfo(tab).title,
    secure: url.startsWith('https://'),
    favicon: tab.favicon,
    zoom: Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100),
    muted: wc.isAudioMuted(),
    perms,
    cookies: (await wc.session.cookies.get({ url })).length,
    ...common,
  };
}

// ---------- расширения ----------

// список с иконками читается с диска — держим в кэше и сбрасываем при установке/удалении
let extCache = null;
const extList = () => (extCache ||= ext.installed(session.defaultSession));
const extChanged = () => { extCache = null; sendState(); };

function pinnedExtensions() {
  const all = extList();
  return settings.pinnedExtensions.map((id) => all.find((e) => e.id === id)).filter(Boolean)
    .map(({ id, name, icon }) => ({ id, name, icon }));
}

// ---------- API расширений Chrome: electron-chrome-extensions (GPL-3.0) + Chrome Web Store ----------
// Библиотека доделывает chrome.tabs/windows/action/contextMenus/cookies… и сама открывает окна расширений.
// Ей нужно знать наши вкладки: addTab при создании, selectTab при переключении, removeTab при закрытии.

let chromeExt = null;
const STORE_DIR = () => path.join(app.getPath('userData'), 'WebStore'); // отдельно от перенесённых из Arc/Chrome
const tabByWc = (wc) => [...tabs.values()].find((t) => t.view?.webContents === wc);

function setupChromeExtensions() {
  chromeExt = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: session.defaultSession,
    async createTab(details) {
      const id = createTab(details.url || NEWTAB_URL, { activate: details.active !== false });
      return [ensureView(tabs.get(id)).webContents, win];
    },
    selectTab(wc) {
      const tab = tabByWc(wc);
      if (tab && activeTab() !== tab) switchTab(tab.id);
    },
    removeTab(wc) {
      const tab = tabByWc(wc);
      if (tab) closeTab(tab.id);
    },
    async createWindow(details) {
      const url = [].concat(details.url || [])[0];
      // окна-попапы (вход через OAuth и т.п.) — настоящими окнами, остальное — вкладками
      if (details.type === 'popup') {
        const bw = new BrowserWindow({
          width: details.width || 520,
          height: details.height || 640,
          autoHideMenuBar: true,
          icon: path.join(__dirname, 'build', 'icon.png'),
          webPreferences: { sandbox: true, contextIsolation: true },
        });
        if (url) bw.loadURL(url);
        return bw;
      }
      if (url) createTab(url);
      return win;
    },
    removeWindow(bw) {
      if (bw !== win && !bw.isDestroyed()) bw.close();
    },
  });
}

async function setupWebStore() {
  // кнопка «Установить» на chromewebstore.google.com + автообновление установленных оттуда расширений
  await installChromeWebStore({ session: session.defaultSession, extensionsPath: STORE_DIR(), autoUpdate: true });
  session.defaultSession.extensions?.on?.('extension-loaded', () => extChanged());
  session.defaultSession.extensions?.on?.('extension-unloaded', () => extChanged());
}

function extMenu(id) {
  const e = extList().find((x) => x.id === id);
  if (!e) return;
  const manifest = (session.defaultSession.extensions || session.defaultSession).getExtension(id)?.manifest || {};
  const options = manifest.options_ui?.page || manifest.options_page;
  const pinned = settings.pinnedExtensions.includes(id);
  Menu.buildFromTemplate([
    { label: e.name, enabled: false },
    { type: 'separator' },
    { label: pinned ? 'Открепить с панели' : 'Закрепить на панели', click: () => togglePinExt(id) },
    { label: 'Параметры', enabled: !!options, click: () => createTab(`chrome-extension://${id}/${options}`) },
    { type: 'separator' },
    { label: 'Удалить', click: () => removeExt(id) },
  ]).popup({ window: win });
}

function togglePinExt(id) {
  const list = settings.pinnedExtensions;
  setSetting('pinnedExtensions', list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  sendState();
}

async function removeExt(id) {
  const loaded = (session.defaultSession.extensions || session.defaultSession).getExtension(id);
  // установленные из Chrome Web Store удаляет его библиотека, перенесённые — мы сами
  if (loaded && path.resolve(loaded.path).startsWith(path.resolve(STORE_DIR()))) {
    await uninstallExtension(id, { session: session.defaultSession, extensionsPath: STORE_DIR() });
  } else {
    ext.remove(session.defaultSession, id);
  }
  setSetting('pinnedExtensions', settings.pinnedExtensions.filter((x) => x !== id));
  extChanged();
  toast('Расширение удалено');
}

on('ext:menu', extMenu);
on('ext:pin', togglePinExt);
handle('ext:importable', () => ext.importable(session.defaultSession).map(({ dir, ...rest }) => rest));
handle('ext:import', async (ids) => {
  const list = ext.importable(session.defaultSession).filter((e) => ids.includes(e.id));
  const r = await ext.importExtensions(session.defaultSession, list);
  extChanged();
  return r;
});
handle('ext:loadUnpacked', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка распакованного расширения', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    const id = await ext.loadUnpacked(session.defaultSession, r.filePaths[0]);
    extChanged();
    return { id };
  } catch (e) {
    return { error: e.message };
  }
});
on('ext:store', () => { hideOverlay('site', 120); createTab('https://chromewebstore.google.com/'); });
handle('site:autoPip', (on) => { setSetting('autoPip', !!on); return siteInfo(); });

on('site:menu', async (x) => {
  const info = await siteInfo();
  if (!info) return;
  showOverlay('site', 'siteinfo.html', 'site:open', { ...info, x });
});
on('site:close', () => hideOverlay('site', 200));
handle('site:info', siteInfo);
handle('site:zoom', (delta) => { zoom(delta); return siteInfo(); });
handle('site:perm', (perm, value) => {
  const tab = activeTab();
  if (!tab || !(perm in DEFAULT_SETTINGS.permissions)) return siteInfo();
  const origin = originOf(tabInfo(tab).url);
  sitePerms[origin] = { ...sitePerms[origin], [perm]: value };
  if (!value) delete sitePerms[origin][perm];
  if (!Object.keys(sitePerms[origin]).length) delete sitePerms[origin];
  writeJson('site-permissions.json', sitePerms);
  return siteInfo();
});
handle('site:mute', () => {
  const wc = activeWc();
  if (wc) wc.setAudioMuted(!wc.isAudioMuted());
  sendState();
  return siteInfo();
});
handle('site:clearCookies', async () => {
  const wc = activeWc();
  const url = activeTab() && tabInfo(activeTab()).url;
  if (!wc || !url) return null;
  await wc.session.clearStorageData({ origin: originOf(url) });
  wc.reload();
  toast('Данные сайта очищены');
  return siteInfo();
});
on('site:action', (action) => {
  const wc = activeWc();
  const url = activeTab() && tabInfo(activeTab()).url;
  hideOverlay('site', 200);
  if (!wc) return;
  if (action === 'copy' && url) { clipboard.writeText(url); toast('Ссылка скопирована'); }
  else if (action === 'hardReload') wc.reloadIgnoringCache();
  else if (action === 'source' && url) createTab('view-source:' + url);
  else if (action === 'devtools') wc.toggleDevTools();
});
on('nav:back', () => { const wc = activeWc(); if (wc) go(wc, -1); });
on('nav:forward', () => { const wc = activeWc(); if (wc) go(wc, 1); });
on('nav:reload', () => activeWc()?.reload());
on('nav:stop', () => activeWc()?.stop());
on('zoom:reset', () => zoom(0));
on('ws:switch', switchWorkspace);
on('ws:create', () => switchWorkspace(createWorkspace().id));
on('ws:update', updateWorkspace);
on('ws:delete', deleteWorkspace);
on('essential:open', openEssential);
on('essential:fromTab', (id) => { const t = tabs.get(id); if (t) { const i = tabInfo(t); addEssential(i.url, i.title); } });
on('essential:menu', (url) => {
  Menu.buildFromTemplate([
    { label: 'Открыть в новой вкладке', click: () => createTab(url) },
    { label: 'Открепить', click: () => removeEssential(url) },
  ]).popup({ window: win });
});
on('compact:toggle', () => setCompact(!compact));
on('sidebar:peek', setPeek);
on('spotlight:open', openSpotlight);
on('spotlight:close', () => hideOverlay('spotlight', 200));
on('spotlight:go', ({ text, url, tabId, mode, newTab }) => {
  hideOverlay('spotlight', 200);
  if (tabId) return switchTab(tabId);
  const target = url || toUrl(text || '');
  const section = settingsSection(target);
  if (section) return openPanel(section);
  const cur = activeTab();
  // Alt+Enter — всегда в новой вкладке, как в Chrome
  if (newTab || (mode === 'new' && !(cur && !tabInfo(cur).url))) createTab(target, { isPrivate: !!cur?.isPrivate && !newTab });
  else ensureView(cur).webContents.loadURL(target);
  activeWc()?.focus();
});
on('find:query', ({ text, forward = true, next = false }) => {
  const wc = activeWc();
  findText = text;
  if (!wc) return;
  if (!text) {
    wc.stopFindInPage('clearSelection');
    overlays.find?.webContents.send('find:result', { active: 0, total: 0 });
    return;
  }
  wc.findInPage(text, { forward, findNext: next });
});
on('find:close', closeFind);
ipcMain.on('media:prefs', (e) => { e.returnValue = { mic: settings.micLabel, cam: settings.camLabel }; });
on('spotlight:forget', forgetSuggestion);
handle('spotlight:suggest', suggest);

on('panel:open', openPanel);
on('panel:close', () => hideOverlay('panel', 260));
async function dataCounts() {
  const ses = session.defaultSession;
  return {
    history: history.length,
    searches: searches.length,
    bookmarks: bookmarks.length,
    cache: await ses.getCacheSize(),
    cookies: (await ses.cookies.get({})).length,
  };
}

handle('panel:get', async () => {
  const w = getWs();
  return {
    settings,
    engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
    downloadsDefault: app.getPath('downloads'),
    restartKeys: RESTART_KEYS,
    workspace: { id: w.id, name: w.name, icon: w.icon, theme: w.theme },
    presets: THEME_PRESETS,
    icons: ICONS,
    versions: { chromium: process.versions.chrome, electron: process.versions.electron, app: app.getVersion() },
    counts: await dataCounts(),
    system: { isDefault: isDefaultBrowser(), autostart: getAutostart() },
  };
});
on('panel:set', setSetting);
on('panel:theme', (theme) => updateWorkspace(activeWs, { theme }));
handle('panel:clear', clearData);
handle('panel:counts', dataCounts);
// скриншот куска панели настроек — из него рассыпается «пыль» при очистке
handle('panel:snapshot', async (rect) => (await overlays.panel.webContents.capturePage(rect)).toDataURL());
handle('panel:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: settings.downloadsDir || app.getPath('downloads') });
  if (r.canceled || !r.filePaths[0]) return null;
  setSetting('downloadsDir', r.filePaths[0]);
  return r.filePaths[0];
});
on('panel:openDownloads', () => shell.openPath(settings.downloadsDir || app.getPath('downloads')));
on('app:restart', restart);
// К каждому найденному браузеру прикладываем его настоящую иконку из exe (data: URL)
handle('import:detect', async () => {
  const list = importer.detect(searchFromUrl);
  for (const b of list) {
    if (!b.exe || b.iconFile) continue;
    try {
      b.icon = (await app.getFileIcon(b.exe, { size: 'large' })).toDataURL();
    } catch {}
    delete b.exe;
  }
  return list;
});
handle('import:run', runImport);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  essentials = readJson('essentials.json', [
    { title: 'YouTube', url: 'https://www.youtube.com/' },
    { title: 'GitHub', url: 'https://github.com/' },
    { title: 'ВКонтакте', url: 'https://vk.com/' },
    { title: 'Википедия', url: 'https://ru.wikipedia.org/' },
  ]);
  history = readJson('history.json', []);
  searches = readJson('searches.json', []);
  bookmarks = readJson('bookmarks.json', []);
  sitePerms = readJson('site-permissions.json', {});
  setupSession();
  setupChromeExtensions(); // до загрузки расширений и до первой вкладки
  ext.loadAll(session.defaultSession).then(extChanged);
  setupWebStore().catch((e) => console.error('web store', e));

  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 640,
    minHeight: 360,
    frame: false,
    backgroundColor: '#101015',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', handleShortcut);
  win.on('resize', layout);
  // боковые кнопки мыши «назад/вперёд»
  win.on('app-command', (_e, cmd) => {
    const wc = activeWc();
    if (wc && cmd === 'browser-backward') go(wc, -1);
    if (wc && cmd === 'browser-forward') go(wc, 1);
  });
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('enter-full-screen', () => { layout(); sendState(); });
  win.on('leave-full-screen', () => { layout(); sendState(); });
  // Chromium пишет cookies на диск пачками — перед выходом дожидаемся записи, иначе свежие входы теряются
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    flushed = true;
    saveSession();
    session.defaultSession.cookies.flushStore().finally(() => win.destroy());
  });
  win.loadFile('index.html');
});

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const url = urlFromArgv(argv);
  if (url) createTab(url);
});

app.on('window-all-closed', () => app.quit());
