const { contextBridge } = require('electron');

// Chromium exposes both namespaces. The Electron compatibility APIs are installed on chrome.
if (process.type === 'service-worker' || location.protocol === 'chrome-extension:') {
  contextBridge.executeInMainWorld({
    func: () => {
      const chrome = globalThis.chrome;
      if (location.protocol !== 'chrome-extension:' || !chrome?.runtime?.id) return;
      const privacy = globalThis.__essentialNetworkPrivacy;
      delete globalThis.__essentialNetworkPrivacy;
      if (privacy && chrome.privacy?.network) Object.assign(chrome.privacy.network, privacy);
      // Расширения добавляют собственные полифилы к верхнему уровню API.
      const api = Object.isExtensible(chrome) ? chrome : Object.assign({}, chrome);
      const binding = { value: api, configurable: true, writable: true };
      if (api !== chrome) Object.defineProperty(globalThis, 'chrome', binding);
      if (globalThis.browser !== api) Object.defineProperty(globalThis, 'browser', binding);
    },
  });
}
