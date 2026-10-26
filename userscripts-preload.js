// Внедрение зарегистрированных через chrome.userScripts скриптов в страницу (см. userscripts.js).
// Скрипты мира USER_SCRIPT живут в своём изолированном мире: страница не видит их переменных,
// а они не видят наш preload. Для связи с расширением им даётся chrome.runtime.sendMessage / connect.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

if (/^https?:$/.test(location.protocol)) {
  let list = [];
  try { list = ipcRenderer.sendSync('us:scripts', location.href, window === window.top) || []; } catch {}

  if (list.length) {
    // ---------- мост для сообщений: мир скриптов ⇄ браузер ⇄ сервис-воркер расширения ----------
    const portHandlers = new Map(); // portId -> callback(type, message)
    ipcRenderer.on('us:port', (_e, portId, type, message) => portHandlers.get(portId)?.(type, message));
    const bridge = {
      send: (extId, message) => ipcRenderer.invoke('us:send', extId, message),
      connect: (extId, name, onEvent) => {
        const portId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        portHandlers.set(portId, (type, message) => {
          if (type === 'disconnect') portHandlers.delete(portId);
          onEvent(type, message);
        });
        ipcRenderer.send('us:connect', extId, portId, name);
        return portId;
      },
      post: (portId, message) => ipcRenderer.send('us:port-post', portId, message),
      close: (portId) => { portHandlers.delete(portId); ipcRenderer.send('us:port-close', portId); },
    };

    // в мире скриптов — chrome.runtime, как в Chrome при configureWorld({ messaging: true })
    const worldApi = (extId, messaging) => `(() => {
      const b = globalThis.__essentialUS; delete globalThis.__essentialUS;
      if (globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.__essential) return;
      const ev = () => { const s = new Set(); return { s, api: { addListener: (f) => s.add(f), removeListener: (f) => s.delete(f), hasListener: (f) => s.has(f) } }; };
      const runtime = { __essential: true, id: ${JSON.stringify(extId)}, onMessage: ev().api,
        getURL: (p) => 'chrome-extension://${extId}/' + String(p || '').replace(/^\\//, '') };
      if (${messaging}) {
        runtime.sendMessage = (...args) => {
          const cb = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
          const message = args.length > 1 && typeof args[0] === 'string' ? args[1] : args[0];
          const p = b.send(${JSON.stringify(extId)}, message);
          if (cb) { p.then((r) => cb(r), () => cb()); return undefined; }
          return p;
        };
        runtime.connect = (a, c) => {
          const info = (typeof a === 'object' && a) || c || {};
          const onMsg = ev(); const onDisc = ev();
          let open = true;
          const port = { name: info.name || '', onMessage: onMsg.api, onDisconnect: onDisc.api,
            postMessage: (m) => { if (open) b.post(id, m); },
            disconnect: () => { if (open) { open = false; b.close(id); } } };
          const id = b.connect(${JSON.stringify(extId)}, port.name, (type, m) => {
            if (type === 'message') for (const f of onMsg.s) { try { f(m, port); } catch (e) { console.error(e); } }
            else { open = false; for (const f of onDisc.s) { try { f(port); } catch (e) { console.error(e); } } }
          });
          return port;
        };
      }
      globalThis.chrome = Object.assign(globalThis.chrome || {}, { runtime });
      if (!globalThis.browser) globalThis.browser = globalThis.chrome;
    })();`;

    const prepared = new Set();
    const inject = (s) => {
      try {
        if (s.world === 'MAIN') return webFrame.executeJavaScript(s.code).catch((e) => console.error(`[userscript ${s.id}]`, e));
        if (!prepared.has(s.worldNum)) {
          prepared.add(s.worldNum);
          webFrame.setIsolatedWorldInfo(s.worldNum, { name: 'User scripts', securityOrigin: location.origin, ...(s.csp ? { csp: s.csp } : {}) });
          contextBridge.exposeInIsolatedWorld(s.worldNum, '__essentialUS', bridge);
          webFrame.executeJavaScriptInIsolatedWorld(s.worldNum, [{ code: worldApi(s.extId, s.messaging) }]);
        }
        webFrame.executeJavaScriptInIsolatedWorld(s.worldNum, [{ code: s.code, url: `userscript:${s.id}` }]).catch((e) => console.error(`[userscript ${s.id}]`, e));
      } catch (e) {
        console.error(`[userscript ${s.id}]`, e);
      }
    };

    // document_start — сразу, document_end — после разбора страницы, document_idle — когда она загрузилась
    const at = (when) => list.filter((s) => s.runAt === when).forEach(inject);
    at('document_start');
    let idleDone = false;
    const idle = () => { if (!idleDone) { idleDone = true; at('document_idle'); } };
    document.addEventListener('DOMContentLoaded', () => { at('document_end'); setTimeout(idle, 300); }, { once: true });
    window.addEventListener('load', idle, { once: true });
  }
}
