// chrome.proxy.settings → Electron's session proxy. Private sessions stay separate.
const fs = require('fs');
const { randomUUID } = require('node:crypto');

const rtcPolicies = new Set(['default', 'default_public_interface_only', 'default_public_and_private_interfaces', 'disable_non_proxied_udp']);

function proxyConfig(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid proxy configuration');
  if (['direct', 'system', 'auto_detect'].includes(value.mode)) return { mode: value.mode };
  if (value.mode === 'pac_script') {
    const pac = value.pacScript;
    if (typeof pac?.data === 'string' && pac.data && pac.data.length <= 1024 * 1024) {
      return { mode: 'pac_script', pacScript: `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac.data).toString('base64')}` };
    }
    if (typeof pac?.url === 'string' && /^https?:\/\//i.test(pac.url)) return { mode: 'pac_script', pacScript: pac.url };
    throw new Error('A PAC script or HTTP(S) URL is required');
  }
  if (value.mode !== 'fixed_servers' || !value.rules) throw new Error('Unsupported proxy mode');
  const rules = value.rules;
  const server = (s) => {
    const scheme = s.scheme || 'http';
    if (!['http', 'https', 'quic', 'socks4', 'socks5'].includes(scheme) ||
        typeof s.host !== 'string' || !s.host || /[\s/;=@]/.test(s.host) ||
        (s.port != null && (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535))) throw new Error('Invalid proxy server');
    return `${scheme}://${s.host}${s.port == null ? '' : ':' + s.port}`;
  };
  const entries = [['http', rules.proxyForHttp], ['https', rules.proxyForHttps], ['ftp', rules.proxyForFtp], ['socks', rules.fallbackProxy]];
  const proxyRules = rules.singleProxy ? server(rules.singleProxy) : entries.filter(([, s]) => s).map(([scheme, s]) => `${scheme}=${server(s)}`).join(';');
  if (!proxyRules) throw new Error('Missing proxy server');
  return { mode: 'fixed_servers', proxyRules, proxyBypassRules: (rules.bypassList || []).join(';') };
}

function install({ app, webContents, session, chromeExt, file }) {
  const router = chromeExt.ctx.router;
  const pending = new Map();
  const rtc = new Map();
  let state = null;
  let queue = Promise.resolve();
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  const loaded = (id) => (session.extensions || session).getExtension(id);
  const permissions = (extension) => chromeExt.api.permissions.permissionMap.get(extension.id)?.permissions || extension.manifest.permissions || [];
  const permitted = (extension) => {
    if (!permissions(extension).includes('proxy')) throw new Error('proxy permission required');
  };
  const senderExtension = ({ extension, sender }) => {
    const url = sender?.scope || sender?.getURL?.();
    if (!url?.startsWith(`chrome-extension://${extension.id}/`)) throw new Error('Invalid proxy extension context');
    permitted(extension);
    return extension;
  };
  const details = (id) => ({ value: state?.value || { mode: 'system' }, incognitoSpecific: false,
    levelOfControl: !state ? 'controllable_by_this_extension' : state.id === id ? 'controlled_by_this_extension' : 'controlled_by_other_extensions' });
  const notify = () => {
    for (const ext of (session.extensions || session).getAllExtensions()) {
      if (ext.manifest.permissions?.includes('proxy')) router.sendEvent(ext.id, 'proxy.settings.onChange', details(ext.id));
    }
  };
  const persist = () => fs.writeFileSync(file, JSON.stringify(state));
  const scope = (d) => {
    if (d?.incognito || (d?.scope && d.scope !== 'regular')) throw new Error('Incognito proxy settings are not supported');
  };
  router.handle('proxy.settings.get', (event, d = {}) => { const extension = senderExtension(event); scope(d); return details(extension.id); });
  router.handle('proxy.settings.set', (event, d = {}) => serialized(async () => {
    const extension = senderExtension(event);
    scope(d);
    if (!loaded(extension.id)) throw new Error('Proxy extension is no longer loaded');
    const config = proxyConfig(d.value);
    await session.setProxy(config);
    state = { id: extension.id, value: d.value };
    persist();
    await session.closeAllConnections();
    notify();
  }));
  router.handle('proxy.settings.clear', (event, d = {}) => serialized(async () => {
    const extension = senderExtension(event);
    scope(d);
    if (state?.id !== extension.id) return;
    await session.setProxy({ mode: 'system' });
    state = null;
    persist();
    await session.closeAllConnections();
    notify();
  }));
  const policy = () => [...rtc.values()].at(-1) || 'default';
  const applyPolicy = (wc) => {
    if (!wc.isDestroyed() && wc.session === session) wc.setWebRTCIPHandlingPolicy(policy());
  };
  const applyAll = () => webContents?.getAllWebContents().forEach(applyPolicy);
  const requirePrivacy = (event) => {
    const extension = senderExtension(event);
    if (!permissions(extension).includes('privacy')) throw new Error('privacy permission required');
    return extension;
  };
  router.handle('proxy.compat.webrtc:get', (event) => {
    requirePrivacy(event);
    return { value: policy(), levelOfControl: 'controllable_by_this_extension' };
  });
  router.handle('proxy.compat.webrtc:set', (event, { value } = {}) => {
    const extension = requirePrivacy(event);
    if (!rtcPolicies.has(value)) throw new Error('Invalid WebRTC IP handling policy');
    rtc.delete(extension.id);
    rtc.set(extension.id, value);
    applyAll();
  });
  router.handle('proxy.compat.prediction:get', (event) => {
    requirePrivacy(event);
    return { levelOfControl: 'not_controllable' };
  });
  router.handle('proxy.compat.prediction:set', (event) => {
    requirePrivacy(event);
    throw new Error('Network prediction is not configurable in Essential');
  });
  router.handle('proxy.compat.auth', (event, { id, response } = {}) => {
    const extension = senderExtension(event);
    const request = pending.get(id);
    if (request?.owner === extension.id && permissions(extension).includes('webRequestAuthProvider')) {
      request.finish(response?.authCredentials);
    }
  });
  app?.on('web-contents-created', (_event, wc) => {
    if (wc.session !== session) return;
    applyPolicy(wc);
    wc.on('did-fail-load', (_event, _code, error) => {
      if (state && /ERR_(PROXY_|TUNNEL_|NO_SUPPORTED_PROXIES|MANDATORY_PROXY_CONFIGURATION)/.test(error)) {
        router.sendEvent(state.id, 'proxy.onProxyError', { error, details: '', fatal: true });
      }
    });
  });
  app?.on('login', (event, wc, request, auth, callback) => {
    if (!auth.isProxy || !request.firstAuthAttempt || (wc && wc.session !== session) || !state) return;
    const extension = loaded(state.id);
    if (!extension?.manifest.background?.service_worker || !permissions(extension).includes('webRequestAuthProvider')) return;
    event.preventDefault();
    const id = randomUUID();
    const owner = extension.id;
    const finish = (credentials) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      if (state?.id === owner && typeof credentials?.username === 'string' && typeof credentials?.password === 'string') {
        callback(credentials.username, credentials.password);
      } else callback();
    };
    const timer = setTimeout(finish, 10000);
    pending.set(id, { owner, finish });
    session.serviceWorkers.startWorkerForScope(`chrome-extension://${owner}/`).then((worker) => {
      if (!pending.has(id) || state?.id !== owner) return finish();
      worker.send('essential:extension-proxy:auth', id, {
        requestId: id, url: request.url, isProxy: true, challenger: { host: auth.host, port: auth.port },
        scheme: auth.scheme, realm: auth.realm, type: request.isRequestForNavigation ? 'main_frame' : 'other',
        tabId: wc?.id ?? -1, timeStamp: Date.now(),
      });
    }).catch(() => finish());
  });
  (session.extensions || session).on('extension-unloaded', (_event, extension) => {
    if (rtc.delete(extension.id)) applyAll();
    serialized(async () => {
      if (state?.id !== extension.id) return;
      await session.setProxy({ mode: 'system' });
      state = null;
      persist();
      await session.closeAllConnections();
      notify();
    }).catch((e) => console.error('extension proxy cleanup', e));
  });
  return {
    async restore() {
      try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
      if (!state) return;
      const ext = loaded(state.id);
      try {
        if (!ext) throw new Error('Proxy extension is not loaded');
        permitted(ext);
        await session.setProxy(proxyConfig(state.value));
      } catch (e) {
        state = null;
        persist();
        console.error('extension proxy restore', e);
      }
    },
  };
}

module.exports = { install, proxyConfig };
