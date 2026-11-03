// chrome.proxy.settings → Electron's session proxy. Private sessions stay separate.
const fs = require('fs');

function proxyConfig(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid proxy configuration');
  if (['direct', 'system', 'auto_detect'].includes(value.mode)) return { mode: value.mode };
  if (value.mode === 'pac_script') {
    const pac = value.pacScript;
    if (!pac || (!pac.url && !pac.data)) throw new Error('Missing PAC script');
    return { mode: 'pac_script', pacScript: pac.data ? `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac.data).toString('base64')}` : pac.url };
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

function install({ session, chromeExt, file }) {
  const router = chromeExt.ctx.router;
  let state = null;
  let queue = Promise.resolve();
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  const loaded = (id) => (session.extensions || session).getExtension(id);
  const permitted = (extension) => {
    const permissions = chromeExt.api.permissions.permissionMap.get(extension.id)?.permissions || extension.manifest.permissions || [];
    if (!permissions.includes('proxy')) throw new Error('proxy permission required');
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
  router.handle('proxy.settings.get', ({ extension }, d = {}) => { permitted(extension); scope(d); return details(extension.id); });
  router.handle('proxy.settings.set', ({ extension }, d = {}) => serialized(async () => {
    permitted(extension); scope(d);
    const config = proxyConfig(d.value);
    await session.setProxy(config);
    state = { id: extension.id, value: d.value };
    persist();
    await session.closeAllConnections();
    notify();
  }));
  router.handle('proxy.settings.clear', ({ extension }, d = {}) => serialized(async () => {
    permitted(extension); scope(d);
    if (state?.id !== extension.id) return;
    await session.setProxy({ mode: 'system' });
    state = null;
    persist();
    await session.closeAllConnections();
    notify();
  }));
  (session.extensions || session).on('extension-unloaded', (_event, extension) => {
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
