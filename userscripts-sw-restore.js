// Выполняется ПОСЛЕ preload'а electron-chrome-extensions в сервис-воркере расширения: тот ставит заглушку
// chrome.webRequest.onHeadersReceived, которая никогда не срабатывает. Возвращаем наше событие
// (см. userscripts-sw-preload.js — там события webRequest создаются для fetch самого расширения).
const { contextBridge } = require('electron');

if (process.type === 'service-worker') {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const ours = globalThis.__essentialHeadersReceived;
        delete globalThis.__essentialHeadersReceived;
        const wr = globalThis.chrome && globalThis.chrome.webRequest;
        if (ours && wr && !Object.isFrozen(wr)) Object.defineProperty(wr, 'onHeadersReceived', { value: ours, enumerable: true, configurable: true });
      },
    });
  } catch (e) {
    console.error('webRequest restore', e);
  }
}
