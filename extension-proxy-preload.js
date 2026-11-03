// Runs before the library freezes chrome, in extension pages and service workers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__essentialProxy', {
  invoke: (id, name, details) => ipcRenderer.invoke('crx-msg', id, `proxy.settings.${name}`, details),
  listen: (id, name, cb) => {
    ipcRenderer.on(`crx-${name}`, (_event, details) => cb(details));
    ipcRenderer.send('crx-add-listener', id, name);
  },
});
contextBridge.executeInMainWorld({ func: () => {
  const bridge = globalThis.__essentialProxy;
  delete globalThis.__essentialProxy;
  const chrome = globalThis.chrome;
  const id = chrome?.runtime?.id;
  const manifest = chrome?.runtime?.getManifest?.();
  if (!id || ![...(manifest.permissions || []), ...(manifest.optional_permissions || [])].includes('proxy') || chrome.proxy) return;
  const event = (name) => {
    const listeners = new Set();
    let subscribed = false;
    return {
      addListener(fn) {
        listeners.add(fn);
        if (!subscribed) {
          subscribed = true;
          bridge.listen(id, name, (d) => { for (const f of listeners) f(d); });
        }
      },
      removeListener: (fn) => listeners.delete(fn),
      hasListener: (fn) => listeners.has(fn),
      hasListeners: () => listeners.size > 0,
    };
  };
  const call = (name) => (details, callback) => {
    const promise = bridge.invoke(id, name, details);
    if (typeof callback !== 'function') return promise;
    promise.then((value) => callback(value), (error) => {
      // Callback callers inspect lastError synchronously, Promise callers receive rejection.
      Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, value: { message: error.message } });
      try { callback(); } finally { delete chrome.runtime.lastError; }
    });
  };
  Object.defineProperty(chrome, 'proxy', { enumerable: true, configurable: true, value: {
    settings: { get: call('get'), set: call('set'), clear: call('clear'), onChange: event('proxy.settings.onChange') },
    onProxyError: event('proxy.onProxyError'),
  } });
} });
