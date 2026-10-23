const { contextBridge, ipcRenderer } = require('electron');

const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// Открыть окно расширения (или вызвать chrome.action.onClicked) — то же сообщение, что шлёт
// <browser-action-list> из electron-chrome-extensions. anchorRect — в координатах окна.
const activateExt = (extensionId, anchorRect) => ipcRenderer.invoke('crx-msg-remote', '_self', 'browserAction.activate', {
  eventType: 'click',
  extensionId,
  tabId: -1, // активная вкладка окна
  alignment: 'bottom center',
  anchorRect,
}).catch((e) => console.error('extension popup', e));

contextBridge.exposeInMainWorld('browser', {
  ready: send('ui:ready'),
  minimize: send('win:minimize'),
  maximize: send('win:maximize'),
  close: send('win:close'),
  switchTab: send('tab:switch'),
  closeTab: send('tab:close'),
  tabMenu: send('tab:menu'),
  moveTab: send('tab:move'),
  moveTabToWs: send('tab:toWs'),
  muteTab: send('tab:mute'),
  back: send('nav:back'),
  forward: send('nav:forward'),
  reload: send('nav:reload'),
  stop: send('nav:stop'),
  resetZoom: send('zoom:reset'),
  copyUrl: send('tab:copyUrl'),
  siteMenu: send('site:menu'),
  togglePin: send('essential:toggle'),
  activateExt,
  extMenu: send('ext:menu'),
  switchWs: send('ws:switch'),
  createWs: send('ws:create'),
  updateWs: send('ws:update'),
  deleteWs: send('ws:delete'),
  openEssential: send('essential:open'),
  essentialFromTab: send('essential:fromTab'),
  essentialMenu: send('essential:menu'),
  toggleCompact: send('compact:toggle'),
  peek: send('sidebar:peek'),
  openSpotlight: send('spotlight:open'),
  openPanel: send('panel:open'),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, text) => cb(text)),
});

// Всплывающая адресная строка (spotlight.html)
contextBridge.exposeInMainWorld('spotlight', {
  onOpen: (cb) => ipcRenderer.on('spotlight:open', (_e, data) => cb(data)),
  suggest: invoke('spotlight:suggest'),
  go: send('spotlight:go'),
  forget: send('spotlight:forget'),
  close: send('spotlight:close'),
});

// Поиск на странице (find.html). Не «find»: window.find — встроенная функция браузера
contextBridge.exposeInMainWorld('finder', {
  onOpen: (cb) => ipcRenderer.on('find:open', (_e, data) => cb(data)),
  onResult: (cb) => ipcRenderer.on('find:result', (_e, r) => cb(r)),
  query: send('find:query'),
  close: send('find:close'),
});

// Панель «Сайт» (siteinfo.html)
contextBridge.exposeInMainWorld('site', {
  onOpen: (cb) => ipcRenderer.on('site:open', (_e, info) => cb(info)),
  info: invoke('site:info'),
  zoom: invoke('site:zoom'),
  perm: invoke('site:perm'),
  mute: invoke('site:mute'),
  clearCookies: invoke('site:clearCookies'),
  action: send('site:action'),
  close: send('site:close'),
  autoPip: invoke('site:autoPip'),
  activateExt,
  extMenu: send('ext:menu'),
  extPin: send('ext:pin'),
  importable: invoke('ext:importable'),
  importExt: invoke('ext:import'),
  loadUnpacked: invoke('ext:loadUnpacked'),
  openStore: send('ext:store'),
});

// Первый запуск и системная интеграция (onboarding.html, panel.html)
contextBridge.exposeInMainWorld('system', {
  onOnboarding: (cb) => ipcRenderer.on('onboarding:open', () => cb()),
  info: invoke('onboarding:info'),
  finish: send('onboarding:finish'),
  restartOnboarding: send('onboarding:open'),
  makeDefault: invoke('system:makeDefault'),
  setAutostart: send('system:autostart'),
});

// Настройки, темы и импорт (panel.html)
contextBridge.exposeInMainWorld('panel', {
  onOpen: (cb) => ipcRenderer.on('panel:open', (_e, section) => cb(section)),
  get: invoke('panel:get'),
  set: send('panel:set'),
  setTheme: send('panel:theme'),
  updateWs: send('ws:update'),
  clear: invoke('panel:clear'),
  counts: invoke('panel:counts'),
  snapshot: invoke('panel:snapshot'),
  pickFolder: invoke('panel:pickFolder'),
  openDownloads: send('panel:openDownloads'),
  restart: send('app:restart'),
  detectImport: invoke('import:detect'),
  runImport: invoke('import:run'),
  close: send('panel:close'),
});
