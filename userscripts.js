// chrome.userScripts для расширений (Tampermonkey, Violentmonkey и т.п.): в Electron этого API нет,
// а Tampermonkey для Manifest V3 без него не запускает ни одного скрипта («Please enable Allow User Scripts»).
// Здесь — сама реализация: расширение регистрирует скрипты, мы храним их и внедряем в подходящие страницы
// (userscripts-preload.js), а сообщения и порты между скриптом на странице и расширением гоняем через себя
// (в сервис-воркер расширения — userscripts-sw-preload.js).
const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'userscripts.json');
const RUN_AT = new Set(['document_start', 'document_end', 'document_idle']);

let ses = null;
let router = null;
let scripts = {}; // extId -> { id -> script }
let worlds = {}; // extId -> { worldId|'' -> { csp, messaging } }
const worldNums = new Map(); // `${extId}|${worldId}` -> номер изолированного мира в странице
let saveTimer = null;

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    scripts = d.scripts || {};
    worlds = d.worlds || {};
  } catch {}
}

// Chrome хранит зарегистрированные скрипты между запусками — мы тоже
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(FILE(), JSON.stringify({ scripts, worlds })); } catch (e) { console.error('userscripts save failed', e); }
  }, 500);
}

// ---------- шаблоны адресов (как в Chrome) ----------

const escape = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

function matchPattern(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp|wss?):/.test(url.protocol);
  const m = /^(\*|https?|file|ftp|wss?|urn):\/\/([^/]*)(\/.*)?$/.exec(pattern);
  if (!m) return false;
  const [, scheme, host, pathPart = '/'] = m;
  const proto = url.protocol.slice(0, -1);
  if (scheme === '*' ? !['http', 'https'].includes(proto) : scheme !== proto) return false;
  if (host !== '*' && proto !== 'file') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (url.hostname !== base && !url.hostname.endsWith('.' + base)) return false;
    } else if (host.replace(/:\d+$/, '') !== url.hostname) return false;
  }
  const re = new RegExp('^' + escape(pathPart).replace(/\*/g, '.*') + '$');
  return re.test(url.pathname + url.search);
}

const globToRe = (g) => new RegExp('^' + escape(g).replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

function scriptMatches(s, url, isTop) {
  if (!s.allFrames && !isTop) return false;
  const href = url.href;
  if (!(s.matches || []).some((p) => matchPattern(p, url))) {
    // без matches скрипт подходит, если подходит includeGlobs
    if ((s.matches || []).length || !(s.includeGlobs || []).length) return false;
  }
  if ((s.excludeMatches || []).some((p) => matchPattern(p, url))) return false;
  if ((s.includeGlobs || []).length && !s.includeGlobs.some((g) => globToRe(g).test(href))) return false;
  if ((s.excludeGlobs || []).some((g) => globToRe(g).test(href))) return false;
  return true;
}

// ---------- API для расширения ----------

function clean(s, extension) {
  if (!s || typeof s.id !== 'string' || !s.id || s.id.startsWith('_')) throw new Error('Invalid script id');
  const js = (s.js || []).map((j) => (typeof j.code === 'string' ? { code: j.code } : { file: String(j.file || '') }));
  if (!js.length) throw new Error(`Script "${s.id}" has no js`);
  return {
    id: s.id,
    matches: (s.matches || []).map(String),
    excludeMatches: (s.excludeMatches || []).map(String),
    includeGlobs: (s.includeGlobs || []).map(String),
    excludeGlobs: (s.excludeGlobs || []).map(String),
    allFrames: !!s.allFrames,
    runAt: RUN_AT.has(s.runAt) ? s.runAt : 'document_idle',
    world: s.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT',
    worldId: typeof s.worldId === 'string' ? s.worldId : '',
    js,
    extPath: extension.path,
  };
}

const forExt = (extension) => (scripts[extension.id] ||= {});
const pick = (ext, filter) => Object.values(ext).filter((s) => !filter?.ids || filter.ids.includes(s.id));
const pub = ({ extPath, ...s }) => s;

const api = {
  register({ extension }, list = []) {
    const ext = forExt(extension);
    const add = list.map((s) => clean(s, extension));
    for (const s of add) if (ext[s.id]) throw new Error(`Duplicate script ID '${s.id}'`);
    for (const s of add) ext[s.id] = s;
    save();
  },
  update({ extension }, list = []) {
    const ext = forExt(extension);
    for (const s of list) {
      if (!ext[s.id]) throw new Error(`Script with ID '${s.id}' does not exist`);
      ext[s.id] = clean({ ...ext[s.id], ...s }, extension);
    }
    save();
  },
  unregister({ extension }, filter) {
    const ext = forExt(extension);
    for (const s of pick(ext, filter)) delete ext[s.id];
    save();
  },
  getScripts({ extension }, filter) {
    return pick(forExt(extension), filter).map(pub);
  },
  configureWorld({ extension }, props = {}) {
    const w = (worlds[extension.id] ||= {});
    w[props.worldId || ''] = { csp: typeof props.csp === 'string' ? props.csp : undefined, messaging: !!props.messaging };
    save();
  },
  resetWorldConfiguration({ extension }, worldId) {
    if (worlds[extension.id]) delete worlds[extension.id][worldId || ''];
    save();
  },
  getWorldConfigurations({ extension }) {
    return Object.entries(worlds[extension.id] || {}).map(([worldId, c]) => ({ worldId: worldId || undefined, ...c }));
  },
};

// ---------- сообщения и порты: страница ⇄ сервис-воркер расширения ----------

let seq = 0;
const pending = new Map(); // msgId -> resolve
const ports = new Map(); // portId -> { extId, frame }

function senderOf(e, extId) {
  const wc = e.sender;
  const frame = e.senderFrame;
  const top = frame && !frame.parent;
  const win = BrowserWindow.getAllWindows()[0];
  return {
    id: extId,
    url: frame?.url || wc.getURL(),
    origin: frame?.origin,
    frameId: top ? 0 : frame?.routingId ?? 0,
    tab: { id: wc.id, url: wc.getURL(), title: wc.getTitle(), active: true, windowId: win ? win.id : -1, index: -1, incognito: false, pinned: false, highlighted: false, status: wc.isLoading() ? 'loading' : 'complete' },
  };
}

const toWorker = (extId, payload) => router.sendEvent(extId, 'essential.userScripts.event', payload);

// скрипт можно запускать, только пока расширение установлено и включено
const loaded = (extId) => !!(ses.extensions || ses).getExtension(extId);

function install({ session, chromeExt }) {
  ses = session;
  router = chromeExt.ctx.router;
  load();

  for (const [name, fn] of Object.entries(api)) router.handle(`userScripts.${name}`, fn, { permission: 'userScripts' });

  // ответы и сообщения портов из сервис-воркера расширения
  router.handle('essential.userScripts.respond', (_e, msgId, response) => {
    pending.get(msgId)?.(response);
    pending.delete(msgId);
  });
  router.handle('essential.userScripts.portPost', ({ extension }, portId, message) => {
    const p = ports.get(portId);
    if (!p || p.extId !== extension.id) return;
    try { p.frame.send('us:port', portId, 'message', message); } catch { closePort(portId, false); }
  });
  router.handle('essential.userScripts.portClose', ({ extension }, portId) => {
    const p = ports.get(portId);
    if (!p || p.extId !== extension.id) return;
    try { p.frame.send('us:port', portId, 'disconnect'); } catch {}
    ports.delete(portId);
  });

  // Как в Chrome: <all_urls> покрывает любой шаблон сайтов. Библиотека сравнивала шаблоны как строки,
  // и Tampermonkey думал, что у него урезан доступ к сайтам («Limited runtime host permissions»).
  const perms = chromeExt.api.permissions;
  router.handle('permissions.contains', ({ extension }, req = {}) => {
    const cur = perms.permissionMap.get(extension.id) || { permissions: [], origins: [] };
    const all = cur.origins.some((o) => o === '<all_urls>' || o === '*://*/*');
    const okPerms = (req.permissions || []).every((p) => cur.permissions.includes(p));
    const okOrigins = (req.origins || []).every((o) => all ? /^(<all_urls>|(\*|https?|wss?|ftp):\/\/)/.test(o) : cur.origins.includes(o));
    return okPerms && okOrigins;
  });

  // страница при загрузке спрашивает, какие скрипты ей положены (синхронно — до скриптов самой страницы)
  ipcMain.on('us:scripts', (e, href, isTop) => {
    const out = [];
    let url;
    try { url = new URL(href); } catch { e.returnValue = out; return; }
    // только обычные вкладки: в приватном сеансе расширений нет
    if (!/^https?:$/.test(url.protocol) || e.sender.session.storagePath !== ses.storagePath) { e.returnValue = out; return; }
    for (const [extId, ext] of Object.entries(scripts)) {
      if (!loaded(extId)) continue;
      // Tampermonkey задаёт порядок номером в начале id («1|page» раньше «3|content»): page.js создаёт то, чем пользуется content.js
      const ordered = Object.values(ext).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
      for (const s of ordered) {
        if (!scriptMatches(s, url, isTop)) continue;
        const code = s.js.map((j) => (j.code != null ? j.code : readExtFile(s.extPath, j.file))).join('\n;\n');
        const key = `${extId}|${s.worldId}`;
        if (!worldNums.has(key)) worldNums.set(key, 1000 + worldNums.size);
        const w = worlds[extId]?.[s.worldId] || worlds[extId]?.[''] || {};
        out.push({ extId, id: s.id, code, runAt: s.runAt, world: s.world, worldNum: worldNums.get(key), csp: w.csp, messaging: !!w.messaging });
      }
    }
    e.returnValue = out;
  });

  ipcMain.handle('us:send', (e, extId, message) => {
    if (!loaded(extId)) return undefined;
    const msgId = ++seq;
    return new Promise((resolve) => {
      pending.set(msgId, resolve);
      // не отвечает 10 минут — освобождаем (GM_xmlhttpRequest может идти долго)
      setTimeout(() => { if (pending.delete(msgId)) resolve(undefined); }, 10 * 60 * 1000);
      toWorker(extId, { type: 'message', msgId, message, sender: senderOf(e, extId) });
    });
  });

  ipcMain.on('us:connect', (e, extId, portId, name) => {
    if (!loaded(extId) || !e.senderFrame) return;
    ports.set(portId, { extId, frame: e.senderFrame });
    toWorker(extId, { type: 'connect', portId, name, sender: senderOf(e, extId) });
  });
  ipcMain.on('us:port-post', (_e, portId, message) => {
    const p = ports.get(portId);
    if (p) toWorker(p.extId, { type: 'port-message', portId, message });
  });
  ipcMain.on('us:port-close', (_e, portId) => closePort(portId, true));

  // страница ушла — её порты закрываются, как в Chrome
  app.on('web-contents-created', (_e, wc) => {
    const drop = () => { for (const [id, p] of ports) if (p.frame.isDestroyed?.() || p.frame.detached) closePort(id, true); };
    wc.on('did-start-navigation', (_ev, _url, inPlace, isMain) => { if (isMain && !inPlace) setTimeout(drop, 0); });
    wc.on('destroyed', () => setTimeout(drop, 0));
  });
}

function closePort(portId, notifyWorker) {
  const p = ports.get(portId);
  if (!p) return;
  ports.delete(portId);
  if (notifyWorker) toWorker(p.extId, { type: 'port-disconnect', portId });
}

// js: [{ file }] — файл внутри папки расширения (никаких «../» наружу)
function readExtFile(extPath, file) {
  const full = path.resolve(extPath, file);
  if (!full.startsWith(path.resolve(extPath) + path.sep)) return '';
  try { return fs.readFileSync(full, 'utf8'); } catch { return ''; }
}

module.exports = { install };
