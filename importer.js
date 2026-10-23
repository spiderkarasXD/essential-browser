// Импорт истории, закладок и поисковых запросов из других браузеров.
// Chromium-семейство: Bookmarks (JSON) + History (SQLite). Firefox-семейство: places.sqlite.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const LOCAL = process.env.LOCALAPPDATA || '';
const ROAMING = process.env.APPDATA || '';
const CHROME_EPOCH_MS = 11644473600000; // 1601-01-01 → 1970-01-01

function arcUserData() {
  try {
    const pkg = fs.readdirSync(path.join(LOCAL, 'Packages')).find((d) => d.startsWith('TheBrowserCompany.Arc'));
    return pkg ? path.join(LOCAL, 'Packages', pkg, 'LocalCache', 'Local', 'Arc', 'User Data') : null;
  } catch {
    return null;
  }
}

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

// exe — откуда взять настоящую иконку браузера; site — запасной вариант (значок сайта), если exe не найден
const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome', kind: 'chromium', dir: () => path.join(LOCAL, 'Google', 'Chrome', 'User Data'),
    exe: [path.join(PF, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe')], site: 'https://www.google.com/chrome/' },
  { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', dir: () => path.join(LOCAL, 'Microsoft', 'Edge', 'User Data'),
    exe: [path.join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(PF, 'Microsoft', 'Edge', 'Application', 'msedge.exe')], site: 'https://www.microsoft.com/edge' },
  { id: 'yandex', name: 'Яндекс Браузер', kind: 'chromium', dir: () => path.join(LOCAL, 'Yandex', 'YandexBrowser', 'User Data'),
    exe: [path.join(LOCAL, 'Yandex', 'YandexBrowser', 'Application', 'browser.exe')], site: 'https://browser.yandex.ru' },
  { id: 'opera', name: 'Opera', kind: 'chromium', dir: () => path.join(ROAMING, 'Opera Software', 'Opera Stable'),
    exe: [path.join(LOCAL, 'Programs', 'Opera', 'opera.exe'), path.join(LOCAL, 'Programs', 'Opera', 'launcher.exe')], site: 'https://www.opera.com' },
  { id: 'operagx', name: 'Opera GX', kind: 'chromium', dir: () => path.join(ROAMING, 'Opera Software', 'Opera GX Stable'),
    exe: [path.join(LOCAL, 'Programs', 'Opera GX', 'opera.exe'), path.join(LOCAL, 'Programs', 'Opera GX', 'launcher.exe')], site: 'https://www.opera.com/gx' },
  { id: 'brave', name: 'Brave', kind: 'chromium', dir: () => path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    exe: [path.join(PF, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')], site: 'https://brave.com' },
  { id: 'vivaldi', name: 'Vivaldi', kind: 'chromium', dir: () => path.join(LOCAL, 'Vivaldi', 'User Data'),
    exe: [path.join(LOCAL, 'Vivaldi', 'Application', 'vivaldi.exe'), path.join(PF, 'Vivaldi', 'Application', 'vivaldi.exe')], site: 'https://vivaldi.com' },
  // у Arc в exe безликая иконка, поэтому логотип лежит в исходниках
  { id: 'arc', name: 'Arc', kind: 'chromium', dir: arcUserData, exe: [], iconFile: 'assets/browsers/arc.png', site: 'https://arc.net' },
  { id: 'chromium', name: 'Chromium', kind: 'chromium', dir: () => path.join(LOCAL, 'Chromium', 'User Data'),
    exe: [path.join(LOCAL, 'Chromium', 'Application', 'chrome.exe')], site: 'https://www.chromium.org' },
  { id: 'zen', name: 'Zen', kind: 'firefox', dir: () => path.join(ROAMING, 'zen', 'Profiles'),
    exe: [path.join(PF, 'Zen Browser', 'zen.exe'), path.join(LOCAL, 'Zen Browser', 'zen.exe'), path.join(LOCAL, 'Programs', 'Zen Browser', 'zen.exe')], site: 'https://zen-browser.app' },
  { id: 'firefox', name: 'Firefox', kind: 'firefox', dir: () => path.join(ROAMING, 'Mozilla', 'Firefox', 'Profiles'),
    exe: [path.join(PF, 'Mozilla Firefox', 'firefox.exe'), path.join(PF86, 'Mozilla Firefox', 'firefox.exe')], site: 'https://www.firefox.com' },
  { id: 'floorp', name: 'Floorp', kind: 'firefox', dir: () => path.join(ROAMING, 'Floorp', 'Profiles'),
    exe: [path.join(PF, 'Ablaze Floorp', 'floorp.exe')], site: 'https://floorp.app' },
  { id: 'librewolf', name: 'LibreWolf', kind: 'firefox', dir: () => path.join(ROAMING, 'librewolf', 'Profiles'),
    exe: [path.join(PF, 'LibreWolf', 'librewolf.exe')], site: 'https://librewolf.net' },
];

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const subdirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(p, d.name)); } catch { return []; } };

// Профили: у Chromium это Default / Profile N (у Opera — сама папка), у Firefox — папки в Profiles
function profilesOf(b) {
  const root = b.dir();
  if (!root || !exists(root)) return [];
  if (b.kind === 'firefox') return subdirs(root).filter((p) => exists(path.join(p, 'places.sqlite')));
  const candidates = [root, ...subdirs(root)];
  return candidates.filter((p) => exists(path.join(p, 'History')) || exists(path.join(p, 'Bookmarks')));
}

// Браузер держит базы открытыми — читаем копию
function openCopy(file, extra = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-import-'));
  const dst = path.join(tmp, path.basename(file));
  fs.copyFileSync(file, dst);
  for (const suffix of extra) {
    if (exists(file + suffix)) fs.copyFileSync(file + suffix, dst + suffix);
  }
  const db = new DatabaseSync(dst, { readOnly: true });
  return {
    db,
    done: () => {
      try { db.close(); } catch {}
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

const isWeb = (url) => /^https?:\/\//i.test(url || '');

function chromiumBookmarks(profile) {
  const out = { all: [], bar: [] };
  const file = path.join(profile, 'Bookmarks');
  if (!exists(file)) return out;
  const roots = JSON.parse(fs.readFileSync(file, 'utf8')).roots || {};
  const walk = (node, bar) => {
    if (!node) return;
    if (node.type === 'url' && isWeb(node.url)) {
      out.all.push({ title: node.name || node.url, url: node.url });
      if (bar) out.bar.push({ title: node.name || node.url, url: node.url });
    }
    for (const c of node.children || []) walk(c, bar && node === roots.bookmark_bar);
  };
  walk(roots.bookmark_bar, true);
  for (const [k, v] of Object.entries(roots)) if (k !== 'bookmark_bar' && v && typeof v === 'object') walk(v, false);
  return out;
}

function chromiumHistory(profile, limit) {
  const file = path.join(profile, 'History');
  if (!exists(file)) return { history: [], searches: [] };
  const { db, done } = openCopy(file, ['-wal', '-journal']);
  try {
    // время у Chromium в микросекундах с 1601 года — больше 2^53, поэтому переводим в мс прямо в SQL
    const history = db.prepare(
      `SELECT url, title, last_visit_time / 1000 - ${CHROME_EPOCH_MS} AS t FROM urls
       WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?`,
    ).all(limit)
      .filter((r) => isWeb(r.url))
      .map((r) => ({ url: r.url, title: r.title || '', ts: Number(r.t) }));
    let searches = [];
    try {
      searches = db.prepare(
        `SELECT k.term AS q, MAX(u.last_visit_time) / 1000 - ${CHROME_EPOCH_MS} AS t FROM keyword_search_terms k
         JOIN urls u ON u.id = k.url_id GROUP BY k.term ORDER BY t DESC LIMIT 500`,
      ).all().map((r) => ({ q: r.q, ts: Number(r.t) }));
    } catch {}
    return { history, searches };
  } finally {
    done();
  }
}

function firefoxData(profile, limit) {
  const { db, done } = openCopy(path.join(profile, 'places.sqlite'), ['-wal']);
  try {
    const history = db.prepare(
      `SELECT url, title, last_visit_date / 1000 AS t FROM moz_places
       WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ?`,
    ).all(limit)
      .filter((r) => isWeb(r.url))
      .map((r) => ({ url: r.url, title: r.title || '', ts: Number(r.t) }));
    const rows = db.prepare(
      `SELECT b.title AS title, p.url AS url, (b.parent = (SELECT id FROM moz_bookmarks WHERE guid = 'toolbar_____')) AS bar
       FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1`,
    ).all().filter((r) => isWeb(r.url));
    const bookmarks = {
      all: rows.map((r) => ({ title: r.title || r.url, url: r.url })),
      bar: rows.filter((r) => r.bar).map((r) => ({ title: r.title || r.url, url: r.url })),
    };
    return { history, bookmarks };
  } finally {
    done();
  }
}

function readProfile(b, profile, limit, searchFromUrl) {
  if (b.kind === 'firefox') {
    const { history, bookmarks } = firefoxData(profile, limit);
    // Firefox не хранит запросы отдельно — достаём их из адресов поисковиков
    const searches = history.map((h) => ({ q: searchFromUrl(h.url), ts: h.ts })).filter((s) => s.q);
    return { history, bookmarks, searches };
  }
  const { history, searches } = chromiumHistory(profile, limit);
  return { history, searches, bookmarks: chromiumBookmarks(profile) };
}

// Быстрый обзор: какие браузеры есть и сколько в них данных
function detect(searchFromUrl) {
  const found = [];
  for (const b of BROWSERS) {
    const profiles = profilesOf(b);
    if (!profiles.length) continue;
    const entry = {
      id: b.id, name: b.name, profiles: profiles.length, history: 0, bookmarks: 0, searches: 0, error: null,
      exe: b.exe.find(exists) || null,
      iconFile: b.iconFile || null,
      site: b.site,
    };
    for (const p of profiles) {
      try {
        const d = readProfile(b, p, 100000, searchFromUrl);
        entry.history += d.history.length;
        entry.bookmarks += d.bookmarks.all.length;
        entry.searches += d.searches.length;
      } catch (e) {
        entry.error = e.code === 'EBUSY' ? 'Закройте браузер и попробуйте снова' : String(e.message || e);
      }
    }
    found.push(entry);
  }
  return found;
}

function collect(ids, searchFromUrl) {
  const out = { history: [], bookmarks: [], bar: [], searches: [], errors: [] };
  for (const b of BROWSERS.filter((x) => ids.includes(x.id))) {
    for (const p of profilesOf(b)) {
      try {
        const d = readProfile(b, p, 20000, searchFromUrl);
        out.history.push(...d.history);
        out.bookmarks.push(...d.bookmarks.all);
        out.bar.push(...d.bookmarks.bar);
        out.searches.push(...d.searches);
      } catch (e) {
        out.errors.push(`${b.name}: ${e.code === 'EBUSY' ? 'файл занят, закройте браузер' : e.message}`);
      }
    }
  }
  return out;
}

// Все профили Chromium-браузеров — оттуда берутся расширения
function chromiumProfiles() {
  return BROWSERS.filter((b) => b.kind === 'chromium')
    .flatMap((b) => profilesOf(b).map((profile) => ({ browser: b.name, profile })));
}

module.exports = { detect, collect, chromiumProfiles };
