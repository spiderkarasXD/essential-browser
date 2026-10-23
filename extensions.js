// Расширения Chrome. Свои копии лежат в <userData>/extensions/<id>, Electron грузит их как распакованные.
// Поддержка API у Electron неполная: content-скрипты работают, часть chrome.* во всплывающих окнах — нет.
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const { chromiumProfiles } = require('./importer');

const EXT_DIR = () => path.join(app.getPath('userData'), 'extensions');
const api = (ses) => ses.extensions || ses; // в новых Electron методы переехали в session.extensions
// Без доступа к file://: весь интерфейс браузера — это file://-страницы, и расширения не должны в них встраиваться
const LOAD_OPTS = { allowFileAccess: false };

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

// «__MSG_appName__» → строка из _locales (сначала русский, потом язык по умолчанию)
function localize(dir, manifest, value) {
  const m = /^__MSG_(.+)__$/.exec(value || '');
  if (!m) return value || '';
  const want = m[1].toLowerCase();
  for (const loc of ['ru', manifest.default_locale, 'en', 'en_US']) {
    if (!loc) continue;
    const msgs = readJson(path.join(dir, '_locales', loc, 'messages.json'));
    const hit = msgs && Object.entries(msgs).find(([k]) => k.toLowerCase() === want);
    if (hit) return hit[1].message;
  }
  return value;
}

function iconPath(dir, manifest) {
  const pick = (icons) => {
    if (!icons) return null;
    if (typeof icons === 'string') return icons;
    const sizes = Object.keys(icons).map(Number).sort((a, b) => a - b);
    const best = sizes.find((s) => s >= 32) || sizes[sizes.length - 1];
    return best ? icons[best] : null;
  };
  const rel = pick(manifest.icons) || pick((manifest.action || manifest.browser_action || {}).default_icon);
  return rel ? path.join(dir, rel.replace(/^\//, '')) : null;
}

function iconData(dir, manifest) {
  const p = iconPath(dir, manifest);
  if (!p || !fs.existsSync(p)) return null;
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? null : img.resize({ width: 32, height: 32, quality: 'best' }).toDataURL();
}

function describe(dir, manifest, extra = {}) {
  const action = manifest.action || manifest.browser_action || {};
  return {
    name: localize(dir, manifest, manifest.name),
    version: manifest.version,
    icon: iconData(dir, manifest),
    popup: action.default_popup || null,
    mv: manifest.manifest_version,
    ...extra,
  };
}

async function loadAll(ses) {
  const root = EXT_DIR();
  if (!fs.existsSync(root)) return;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      await api(ses).loadExtension(path.join(root, d.name), LOAD_OPTS);
    } catch (e) {
      console.error('extension failed', d.name, e.message);
    }
  }
}

function installed(ses) {
  return api(ses).getAllExtensions().map((e) => ({ id: e.id, ...describe(e.path, e.manifest) }));
}

// Расширения, установленные в Chrome, Edge, Arc, Яндексе, Opera, Brave, Vivaldi — их можно перенести
function importable(ses) {
  const have = new Set(api(ses).getAllExtensions().map((e) => e.manifest.name + e.manifest.version));
  const found = new Map();
  for (const { browser, profile } of chromiumProfiles()) {
    const root = path.join(profile, 'Extensions');
    if (!fs.existsSync(root)) continue;
    for (const id of fs.readdirSync(root)) {
      const versions = fs.readdirSync(path.join(root, id)).filter((v) => fs.existsSync(path.join(root, id, v, 'manifest.json')));
      const version = versions.sort().pop();
      if (!version) continue;
      const dir = path.join(root, id, version);
      const manifest = readJson(path.join(dir, 'manifest.json'));
      if (!manifest || manifest.theme || found.has(id)) continue; // темы оформления Chrome — не расширения
      const info = describe(dir, manifest, { id, dir, from: browser });
      info.installed = have.has(manifest.name + manifest.version);
      found.set(id, info);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function importExtensions(ses, list) {
  const done = [];
  const failed = [];
  for (const { id, dir } of list) {
    const dst = path.join(EXT_DIR(), id);
    try {
      fs.rmSync(dst, { recursive: true, force: true });
      // _metadata — подписи Chrome Web Store, Electron с ней расширение не грузит
      fs.cpSync(dir, dst, { recursive: true, filter: (p) => path.basename(p) !== '_metadata' });
      await api(ses).loadExtension(dst, LOAD_OPTS);
      done.push(id);
    } catch (e) {
      failed.push(`${id}: ${e.message}`);
      fs.rmSync(dst, { recursive: true, force: true });
    }
  }
  return { done, failed };
}

async function loadUnpacked(ses, dir) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest) throw new Error('В папке нет manifest.json');
  const ext = await api(ses).loadExtension(dir, LOAD_OPTS);
  // запоминаем копию, чтобы расширение пережило перезапуск
  const dst = path.join(EXT_DIR(), ext.id);
  if (path.resolve(dir) !== path.resolve(dst)) {
    api(ses).removeExtension(ext.id);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(dir, dst, { recursive: true, filter: (p) => path.basename(p) !== '_metadata' });
    await api(ses).loadExtension(dst, LOAD_OPTS);
  }
  return ext.id;
}

function remove(ses, id) {
  try { api(ses).removeExtension(id); } catch {}
  fs.rmSync(path.join(EXT_DIR(), id), { recursive: true, force: true });
}

module.exports = { loadAll, installed, importable, importExtensions, loadUnpacked, remove };
