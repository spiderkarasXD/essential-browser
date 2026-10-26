// В сервис-воркере расширения: chrome.userScripts и runtime.onUserScriptMessage / onUserScriptConnect
// (см. userscripts.js). Должен выполниться ДО preload'а electron-chrome-extensions — тот замораживает chrome.
const { contextBridge, ipcRenderer } = require('electron');

if (process.type === 'service-worker') {
  let extensionId = null;
  let onEvent = null;
  const queued = [];

  const bridge = {
    // вызовы chrome.userScripts.* уходят в обработчики userscripts.js через маршрутизатор расширений
    invoke: (name, args) => ipcRenderer.invoke('crx-msg', extensionId, `userScripts.${name}`, ...args),
    respond: (msgId, response) => ipcRenderer.invoke('crx-msg', extensionId, 'essential.userScripts.respond', msgId, response),
    portPost: (portId, message) => ipcRenderer.invoke('crx-msg', extensionId, 'essential.userScripts.portPost', portId, message),
    portClose: (portId) => ipcRenderer.invoke('crx-msg', extensionId, 'essential.userScripts.portClose', portId),
    onEvent: (cb) => {
      onEvent = cb;
      while (queued.length) cb(queued.shift());
    },
  };

  // события от страниц (сообщения, порты) приходят как событие расширения
  ipcRenderer.on('crx-essential.userScripts.event', (_e, payload) => (onEvent ? onEvent(payload) : queued.push(payload)));

  function mainWorld() {
    const b = globalThis.__essentialUserScripts;
    delete globalThis.__essentialUserScripts;
    const chrome = globalThis.chrome;
    // chrome.webRequest в сервис-воркере расширения: Electron не присылает сюда ни одного события — даже для
    // fetch самого расширения. Tampermonkey по этим событиям получает заголовки ответа своих GM_xmlhttpRequest
    // и без них ждёт 5 секунд на каждый запрос. Поэтому для запросов, которые воркер делает сам через fetch,
    // события создаём сами (с настоящими заголовками ответа). Чужие запросы (вкладки) так получить нельзя.
    if (chrome && chrome.webRequest && typeof globalThis.fetch === 'function') {
      const native = chrome.webRequest;
      const NAMES = ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'];
      const listeners = Object.fromEntries(NAMES.map((n) => [n, []]));
      const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      const urlOk = (pattern, url) => {
        if (pattern === '<all_urls>') return true;
        const m = /^(\*|https?|wss?):\/\/([^/]*)(\/.*)?$/.exec(pattern);
        if (!m) return false;
        const u = new URL(url);
        if (m[1] === '*' ? !/^https?:$/.test(u.protocol) : u.protocol !== m[1] + ':') return false;
        const host = m[2];
        if (host !== '*' && !(host.startsWith('*.') ? u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1)) : u.hostname === host)) return false;
        return new RegExp('^' + esc(m[3] || '/').replace(/\*/g, '.*') + '$').test(u.pathname + u.search);
      };
      const filterOk = (f, d) => !f || ((!f.urls || f.urls.some((p) => urlOk(p, d.url))) && (!f.types || f.types.includes(d.type)) && (f.tabId == null || f.tabId === d.tabId));
      const makeEvent = (name) => ({
        addListener: (cb, filter, extra) => {
          listeners[name].push({ cb, filter });
          try { native[name] && native[name].addListener(cb, filter, extra); } catch (e) {}
        },
        removeListener: (cb) => {
          listeners[name] = listeners[name].filter((l) => l.cb !== cb);
          try { native[name] && native[name].removeListener(cb); } catch (e) {}
        },
        hasListener: (cb) => listeners[name].some((l) => l.cb === cb),
        hasListeners: () => listeners[name].length > 0,
      });
      const fire = (name, d) => {
        for (const l of listeners[name].slice()) if (filterOk(l.filter, d)) { try { l.cb(d); } catch (e) { console.error(e); } }
      };
      const wr = { ...native };
      for (const n of NAMES) wr[n] = makeEvent(n);
      Object.defineProperty(chrome, 'webRequest', { value: wr, enumerable: true, configurable: true });
      // electron-chrome-extensions после нас поставит заглушку onHeadersReceived — userscripts-sw-restore.js вернёт наше
      Object.defineProperty(globalThis, '__essentialHeadersReceived', { value: wr.onHeadersReceived, configurable: true });

      const nativeFetch = globalThis.fetch;
      let seqId = 1e9;
      globalThis.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
        if (!/^https?:/i.test(url || '') || !NAMES.some((n) => listeners[n].length)) return nativeFetch.call(this, input, init);
        const base = {
          requestId: String(++seqId), url, method: ((init && init.method) || (input && input.method) || 'GET').toUpperCase(),
          type: 'xmlhttprequest', tabId: -1, frameId: -1, parentFrameId: -1, initiator: self.location.origin, timeStamp: Date.now(),
        };
        let requestHeaders = [];
        try { requestHeaders = [...new Headers((init && init.headers) || (input && input.headers) || undefined)].map(([name, value]) => ({ name, value })); } catch (e) {}
        fire('onBeforeRequest', base);
        fire('onBeforeSendHeaders', { ...base, requestHeaders });
        fire('onSendHeaders', { ...base, requestHeaders });
        try {
          const res = await nativeFetch.call(this, input, init);
          const done = {
            ...base, timeStamp: Date.now(), statusCode: res.status, statusLine: `HTTP/1.1 ${res.status} ${res.statusText}`.trim(),
            responseHeaders: [...res.headers].map(([name, value]) => ({ name, value })), fromCache: false,
          };
          if (res.redirected && res.url !== url) fire('onBeforeRedirect', { ...done, redirectUrl: res.url });
          fire('onHeadersReceived', done);
          fire('onResponseStarted', done);
          fire('onCompleted', done);
          return res;
        } catch (e) {
          fire('onErrorOccurred', { ...base, timeStamp: Date.now(), error: e && e.name === 'AbortError' ? 'net::ERR_ABORTED' : 'net::ERR_FAILED' });
          throw e;
        }
      };
    }
    const manifest = chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest();
    if (!manifest || !(manifest.permissions || []).includes('userScripts')) return null;

    const withCb = (promise, cb) => {
      if (typeof cb === 'function') { promise.then((r) => cb(r), () => cb()); return undefined; }
      return promise;
    };
    const call = (name) => (...args) => {
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
      return withCb(b.invoke(name, args), cb);
    };
    const event = () => {
      const set = new Set();
      return { set, api: { addListener: (f) => set.add(f), removeListener: (f) => set.delete(f), hasListener: (f) => set.has(f), hasListeners: () => set.size > 0 } };
    };

    const userScripts = {
      register: call('register'),
      update: call('update'),
      unregister: call('unregister'),
      getScripts: call('getScripts'),
      configureWorld: call('configureWorld'),
      resetWorldConfiguration: call('resetWorldConfiguration'),
      getWorldConfigurations: call('getWorldConfigurations'),
      ExecutionWorld: { MAIN: 'MAIN', USER_SCRIPT: 'USER_SCRIPT' },
    };
    Object.defineProperty(chrome, 'userScripts', { value: userScripts, enumerable: true, configurable: true });

    const onMessage = event();
    const onConnect = event();
    chrome.runtime.onUserScriptMessage = onMessage.api;
    chrome.runtime.onUserScriptConnect = onConnect.api;

    const ports = new Map();
    b.onEvent((e) => {
      if (e.type === 'message') {
        // как chrome.runtime.onMessage: ответ синхронно, через return true или промисом
        let done = false;
        let async = false;
        const sendResponse = (r) => { if (!done) { done = true; b.respond(e.msgId, r); } };
        for (const f of onMessage.set) {
          try {
            const r = f(e.message, e.sender, sendResponse);
            if (r === true) async = true;
            else if (r && typeof r.then === 'function') { async = true; r.then(sendResponse, () => sendResponse()); }
          } catch (err) { console.error(err); }
        }
        if (!async) sendResponse(undefined);
      } else if (e.type === 'connect') {
        const msg = event();
        const disc = event();
        const port = {
          name: e.name || '',
          sender: e.sender,
          postMessage: (m) => { if (ports.has(e.portId)) b.portPost(e.portId, m); },
          disconnect: () => { if (ports.delete(e.portId)) b.portClose(e.portId); },
          onMessage: msg.api,
          onDisconnect: disc.api,
        };
        ports.set(e.portId, { port, msg, disc });
        for (const f of onConnect.set) { try { f(port); } catch (err) { console.error(err); } }
      } else if (e.type === 'port-message') {
        const p = ports.get(e.portId);
        if (p) for (const f of p.msg.set) { try { f(e.message, p.port); } catch (err) { console.error(err); } }
      } else if (e.type === 'port-disconnect') {
        const p = ports.get(e.portId);
        ports.delete(e.portId);
        if (p) for (const f of p.disc.set) { try { f(p.port); } catch (err) { console.error(err); } }
      }
    });
    return chrome.runtime.id;
  }

  try {
    contextBridge.exposeInMainWorld('__essentialUserScripts', bridge);
    extensionId = contextBridge.executeInMainWorld({ func: mainWorld });
    // подписываемся на события страниц только у расширений с правом userScripts
    if (extensionId) ipcRenderer.send('crx-add-listener', extensionId, 'essential.userScripts.event');
  } catch (e) {
    console.error('userScripts preload', e);
  }
}
