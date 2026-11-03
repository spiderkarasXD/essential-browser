const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { install, proxyConfig } = require('../extension-proxy');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'essential-proxy-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const extension = { id: 'vpn', manifest: { permissions: ['proxy'] } };
  const extensions = new EventEmitter();
  extensions.getExtension = (id) => id === extension.id ? extension : undefined;
  extensions.getAllExtensions = () => [extension];
  const applied = [];
  const handlers = {};
  const session = { extensions, setProxy: async (config) => applied.push(config), closeAllConnections: async () => {} };
  const chromeExt = { api: { permissions: { permissionMap: new Map() } }, ctx: { router: {
    handle: (name, fn) => { handlers[name] = fn; }, sendEvent() {},
  } } };
  const file = path.join(dir, 'proxy.json');
  const api = install({ session, chromeExt, file });
  const call = (method, details = {}, ext = extension) => handlers[`proxy.settings.${method}`]({ extension: ext }, details);
  return { api, call, applied, file, extension, session };
}

test('converts fixed servers, bypass rules and PAC configuration', () => {
  assert.deepEqual(proxyConfig({ mode: 'fixed_servers', rules: { singleProxy: { host: 'vpn.example', port: 443, scheme: 'https' }, bypassList: ['localhost', '*.internal'] } }), {
    mode: 'fixed_servers', proxyRules: 'https://vpn.example:443', proxyBypassRules: 'localhost;*.internal',
  });
  assert.equal(proxyConfig({ mode: 'pac_script', pacScript: { data: 'function FindProxyForURL(){return "DIRECT";}' } }).pacScript.startsWith('data:application/x-ns-proxy-autoconfig;base64,'), true);
  assert.throws(() => proxyConfig({ mode: 'fixed_servers', rules: { singleProxy: { host: 'bad;host' } } }));
});

test('set applies a real session proxy, reports its owner and clear resets it', async (t) => {
  const f = fixture(t);
  await f.call('set', { value: { mode: 'fixed_servers', rules: { singleProxy: { host: 'localhost', port: 8081 } } } });
  assert.equal(f.applied[0].proxyRules, 'http://localhost:8081');
  assert.equal(f.call('get').levelOfControl, 'controlled_by_this_extension');
  await f.call('clear');
  assert.deepEqual(f.applied.at(-1), { mode: 'system' });
  assert.equal(f.call('get').levelOfControl, 'controllable_by_this_extension');
});

test('rejects callers without permission and unsupported private scope', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.call('set', { value: { mode: 'direct' } }, { id: 'other', manifest: {} }), /permission/);
  await assert.rejects(f.call('set', { value: { mode: 'direct' }, scope: 'incognito_session_only' }), /Incognito/);
  assert.equal(f.applied.length, 0);
});

test('restores persisted settings only for a loaded, permitted extension', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.file, JSON.stringify({ id: 'vpn', value: { mode: 'direct' } }));
  await f.api.restore();
  assert.deepEqual(f.applied, [{ mode: 'direct' }]);
  fs.writeFileSync(f.file, JSON.stringify({ id: 'removed', value: { mode: 'direct' } }));
  await f.api.restore();
  assert.equal(f.call('get').levelOfControl, 'controllable_by_this_extension');
});

test('does not let another extension clear the active VPN', async (t) => {
  const f = fixture(t);
  await f.call('set', { value: { mode: 'direct' } });
  await f.call('clear', {}, { id: 'other', manifest: { permissions: ['proxy'] } });
  assert.equal(f.applied.length, 1);
});

test('unloading the owner resets the proxy and closes existing connections', async (t) => {
  const f = fixture(t);
  let closed = 0;
  f.session.closeAllConnections = async () => { closed++; };
  await f.call('set', { value: { mode: 'direct' } });
  f.session.extensions.emit('extension-unloaded', {}, f.extension);
  await f.call('clear'); // waits behind the queued unload operation
  assert.deepEqual(f.applied.at(-1), { mode: 'system' });
  assert.equal(closed, 2);
});

test('a failed proxy change rejects and does not prevent subsequent changes', async (t) => {
  const f = fixture(t);
  f.session.setProxy = async () => { throw new Error('network service failed'); };
  await assert.rejects(f.call('set', { value: { mode: 'direct' } }), /network service/);
  assert.equal(f.call('get').levelOfControl, 'controllable_by_this_extension');
  f.session.setProxy = async () => {};
  await f.call('set', { value: { mode: 'direct' } });
  assert.equal(f.call('get').levelOfControl, 'controlled_by_this_extension');
});

test('preload exposes proxy calls and change events before chrome is frozen', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension-proxy-preload.js'), 'utf8');
  const calls = [];
  const listeners = new Map();
  const context = vm.createContext({ chrome: { runtime: {
    id: 'vpn', getManifest: () => ({ permissions: ['proxy'] }),
  } } });
  context.require = () => ({
    contextBridge: {
      exposeInMainWorld: (name, value) => { context[name] = value; },
      executeInMainWorld: ({ func }) => vm.runInContext(`(${func.toString()})()`, context),
    },
    ipcRenderer: {
      invoke: async (...args) => { calls.push(args); return { value: { mode: 'system' } }; },
      on: (name, cb) => listeners.set(name, cb), send() {},
    },
  });
  vm.runInContext(source, context);
  Object.freeze(context.chrome);
  assert.equal(context.__essentialProxy, undefined);
  assert.equal((await context.chrome.proxy.settings.get({})).value.mode, 'system');
  assert.deepEqual(calls[0].slice(0, 3), ['crx-msg', 'vpn', 'proxy.settings.get']);
  await new Promise((resolve) => context.chrome.proxy.settings.set({ value: { mode: 'direct' } }, resolve));
  let change;
  const listener = (d) => { change = d; };
  context.chrome.proxy.settings.onChange.addListener(listener);
  listeners.get('crx-proxy.settings.onChange')({}, { value: { mode: 'direct' } });
  assert.equal(change.value.mode, 'direct');
  context.chrome.proxy.settings.onChange.removeListener(listener);
  assert.equal(context.chrome.proxy.settings.onChange.hasListeners(), false);
});
