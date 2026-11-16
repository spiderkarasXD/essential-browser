// Runs before the library freezes chrome, in extension pages and service workers.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__essentialProxy', {
  invoke: (id, name, details) => ipcRenderer.invoke('crx-msg', id, `proxy.${name}`, details),
  listen: (id, name, cb) => {
    ipcRenderer.on(`crx-${name}`, (_event, details) => cb(details));
    ipcRenderer.send('crx-add-listener', id, name);
  },
  listenAuth: (id, callback) => {
    ipcRenderer.on('essential:extension-proxy:auth', (_event, requestId, details) => {
      const reply = (response) => ipcRenderer.invoke('crx-msg', id, 'proxy.compat.auth', { id: requestId, response }).catch(() => {});
      callback(details, reply);
    });
  },
});
contextBridge.executeInMainWorld({ func: () => {
  const bridge = globalThis.__essentialProxy;
  delete globalThis.__essentialProxy;
  const chrome = globalThis.chrome;
  const id = chrome?.runtime?.id;
  const manifest = chrome?.runtime?.getManifest?.();
  if (!id || globalThis.location?.protocol !== 'chrome-extension:') return;
  const permissions = [...(manifest?.permissions || []), ...(manifest?.optional_permissions || [])];
  if (!permissions.includes('proxy')) return;
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
    settings: { get: call('settings.get'), set: call('settings.set'), clear: call('settings.clear'), onChange: event('proxy.settings.onChange') },
    onProxyError: event('proxy.onProxyError'),
  } });
  if (permissions.includes('privacy')) {
    globalThis.__essentialNetworkPrivacy = {
      webRTCIPHandlingPolicy: { get: call('compat.webrtc:get'), set: call('compat.webrtc:set') },
      networkPredictionEnabled: { get: call('compat.prediction:get'), set: call('compat.prediction:set') },
    };
  }
  if (!permissions.includes('webRequestAuthProvider')) return;

  const listeners = new Map();
  if (!chrome.webRequest) Object.defineProperty(chrome, 'webRequest', { value: {}, enumerable: true, configurable: true });
  chrome.webRequest.onAuthRequired = {
    addListener: (fn, filter) => { listeners.set(fn, filter); },
    removeListener: (fn) => { listeners.delete(fn); },
    hasListener: (fn) => listeners.has(fn),
    hasListeners: () => listeners.size > 0,
  };
  function matches(pattern, url) {
    if (pattern === '<all_urls>') return true;
    const parts = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
    if (!parts) return false;
    const [, scheme, host, pathname] = parts;
    if (scheme !== '*' && url.protocol !== scheme + ':') return false;
    if (!(host === '*' || host === url.hostname || (host.startsWith('*.') &&
      (host.slice(2) === url.hostname || url.hostname.endsWith(host.slice(1)))))) return false;
    const regex = pathname.split('*').map((piece) => piece.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*');
    return new RegExp('^' + regex + '$').test(url.pathname + url.search);
  }
  bridge.listenAuth(id, (details, reply) => {
    const url = new URL(details.url);
    for (const [listener, filter] of listeners) {
      if (filter?.urls && !filter.urls.some((pattern) => matches(pattern, url))) continue;
      if (filter?.types && !filter.types.includes(details.type)) continue;
      try {
        const result = listener(details, reply);
        if (result?.then) result.then((response) => { if (response) reply(response); }, () => reply());
        else if (result && typeof result === 'object') reply(result);
      } catch { reply(); }
      return;
    }
    reply();
  });
} });
