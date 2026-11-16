const origin = 'https://zen-browser.github.io/theme-store/themes/';
const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const limit = 128 * 1024;
const platformNames = { win32: 'windows', darwin: 'macos', linux: 'linux' };

function modId(input) {
  const id = typeof input === 'string' && input.trim().match(
    /^(?:https:\/\/zen-browser\.app\/mods\/)?([\da-f-]{36})\/?(?:[?#].*)?$/i
  )?.[1].toLowerCase();
  if (!id || !idPattern.test(id)) throw new Error('Вставьте ссылку https://zen-browser.app/mods/… или UUID мода.');
  return id;
}

function assetURL(id, input) {
  const url = new URL(input, origin + id + '/');
  const directory = '/themes/' + id + '/';
  const registry = url.origin === 'https://zen-browser.github.io' && url.pathname.startsWith('/theme-store' + directory);
  const github = url.origin === 'https://raw.githubusercontent.com' &&
    url.pathname.startsWith('/zen-browser/theme-store/') && url.pathname.split('/').slice(4, 6).join('/') === 'themes/' + id;
  if ((!registry && !github) || url.username || url.password) throw new Error('Файл мода находится вне каталога Zen.');
  return url.href;
}

async function download(url, fetch) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'Мод или его файл не найден в каталоге Zen.' : 'Каталог Zen вернул HTTP ' + response.status + '.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw new Error('Файл мода больше 128 КБ.');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
}

const preferenceName = (name) => name.replaceAll('.', '-');
const validKey = (name) => typeof name === 'string' && /^[a-z][\w.-]{0,99}$/i.test(name);

function preferences(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, 60).flatMap((p) => {
    if (!validKey(p?.property) || typeof p.label !== 'string' ||
      (Array.isArray(p.disabledOn) && p.disabledOn.includes(platformNames[process.platform]))) return [];
    const key = preferenceName(p.property);
    if (seen.has(key)) return [];
    seen.add(key);
    const field = { key, label: p.label.trim().slice(0, 140), type: p.type };
    if (p.type === 'checkbox') return [{ ...field, defaultValue: p.defaultValue === true }];
    if (p.type === 'string') return [{ ...field, defaultValue: typeof p.defaultValue === 'string' ? p.defaultValue.slice(0, 4096) : '' }];
    if (p.type !== 'dropdown' || !Array.isArray(p.options)) return [];
    const options = p.options.slice(0, 60).filter((o) => typeof o?.label === 'string' &&
      (Number.isSafeInteger(o.value) || (typeof o.value === 'string' && o.value.length <= 100)))
      .map((o) => ({ label: o.label.slice(0, 100), value: o.value }));
    if (!options.length) return [];
    return [{ ...field, options, defaultValue: options.find((o) => o.value === p.defaultValue)?.value ?? options[0].value }];
  });
}

function values(fields, saved) {
  return Object.fromEntries(fields.map((p) => {
    const value = saved?.[p.key];
    const valid = p.type === 'checkbox' ? typeof value === 'boolean' :
      p.type === 'string' ? typeof value === 'string' && value.length <= 4096 : p.options.some((o) => o.value === value);
    return [p.key, valid ? value : p.defaultValue];
  }));
}

function normalize(source) {
  if (!source || !idPattern.test(source.id || '') || typeof source.title !== 'string') return undefined;
  const fields = preferences(Array.isArray(source.fields) ? source.fields.map((p) => ({ ...p, property: p?.key })) : []);
  return {
    id: source.id,
    title: source.title.slice(0, 160),
    author: typeof source.author === 'string' ? source.author.slice(0, 100) : '',
    fields,
    values: values(fields, source.values),
  };
}

async function load(input, fetch) {
  const id = modId(input);
  const metadata = JSON.parse(await download(origin + id + '/theme.json', fetch));
  if (metadata.id !== id || typeof metadata.name !== 'string' || typeof metadata.style !== 'string') {
    throw new Error('Метаданные мода Zen повреждены.');
  }
  const style = assetURL(id, metadata.style);
  const [css, raw] = await Promise.all([
    download(style, fetch),
    metadata.preferences ? download(assetURL(id, metadata.preferences), fetch) : '[]',
  ]);
  const fields = preferences(JSON.parse(raw));
  return {
    name: metadata.name,
    css: css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi, (match, double, single, bare) => {
      const url = double ?? single ?? bare;
      if (/^[\w+.-]+:|^#/i.test(url)) return match;
      try { return 'url(' + JSON.stringify(assetURL(id, new URL(url, style))) + ')'; }
      catch { return 'url("about:blank")'; }
    }),
    zen: { id, title: metadata.name, author: metadata.author, fields, values: values(fields) },
  };
}

const selectors = {
  '#urlbar': ':is(#urlbar, #tb-url)',
  '#urlbar-input': '#tb-url',
  '#urlbar-background': ':is(#urlbar, .tb-center)',
  '#navigator-toolbox': '#sidebar',
  '#nav-bar': '#toolbar',
  '#TabsToolbar': '#sidebar',
  '#tabbrowser-tabs': '#tabs',
  '#tabbrowser-arrowscrollbox': '#tabs',
  '#vertical-pinned-tabs-container': '#essentials',
  '#zen-essentials-container': '#essentials',
  '#zen-workspaces-button': '#ws-list',
  '#zen-current-workspace-indicator': '#ws-header',
  '.zen-current-workspace-indicator': '#ws-header',
  '#tabs-newtab-button': '#newtab',
  '#vertical-tabs-newtab-button': '#newtab',
  '#PanelUI-menu-button': '.logo-btn img',
  '#downloads-button': '#dl-btn',
  '#unified-extensions-button': '[data-act="site"]',
  'scrollbox:nth-child(5)': '#tabs',
  'scrollbox': '#tabs',
};

function compile(item, expanded) {
  const marker = 'theme-' + item.zen.title.replace(/\s/g, '-').replace(/[^a-z_-]/gi, '');
  const prefs = item.zen.values;
  const platform = platformNames[process.platform];
  const get = (key) => preferenceName(key) === 'zen-view-sidebar-expanded' ? expanded : prefs[preferenceName(key)];
  const result = (condition) => condition ? '(min-width: 0px)' : '(width: -1px)';
  const bool = /\(\s*-moz-bool-pref\s*:\s*["']([\w.-]+)["']\s*\)/gi;
  const modern = /\(\s*-moz-pref\(\s*["']([\w.-]+)["']\s*(?:,\s*(?:"([^"]*)"|'([^']*)'|(-?\d+|true|false))\s*)?\)\s*\)/gi;
  const selectorTokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[\w-]+|\.[\w-]+|\bscrollbox(?::nth-child\(5\))?/g;
  // CSS nesting uses the same selector prelude as top-level rules.
  const preludes = /(?:^|(?<=[;{}]))((?:[^;{}"'\/]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/(?!\*))*?)\{/g;
  const css = item.css.replace(preludes, (_match, original) => {
    let rule = original.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (rule.startsWith('@-moz-document')) rule = /(?:chrome:\/\/browser\/content\/(?:browser\.xhtml|["']))/.test(rule) ? '@media all' : '@media not all';
    else if (rule.startsWith('@media')) {
      rule = rule.replace(bool, (_condition, key) => result(get(key) === true))
        .replace(modern, (_condition, key, double, single, literal) => {
          const expected = double ?? single ?? (literal === undefined || literal === 'true' ? true : literal === 'false' ? false : Number(literal));
          return result(get(key) === expected);
        }).replace(/\(\s*-moz-platform\s*:\s*(\w+)\s*\)/gi, (_condition, os) => result(os === platform));
    } else if (!rule.startsWith('@')) {
      rule = rule.replace(selectorTokens, (token) => selectors[token] || token);
    }
    return '\n' + rule + ' {';
  }).replace(/url\(\s*["']?chrome:\/\/branding\/content\/icon32\.png["']?\s*\)/gi, 'url(build/icon.png)')
    .replace(/(\.logo-btn img\s*\{[^{}]*?)\blist-style-image\s*:/gi, '$1content:');
  const variables = Object.fromEntries(item.zen.fields.filter((p) => p.type === 'string').map((p) => [p.key,
    String(prefs[p.key]).replace(/url\(\s*["']?chrome:\/\/branding\/content\/icon32\.png["']?\s*\)/gi, 'url(build/icon.png)')]));
  const attributes = Object.fromEntries(item.zen.fields.filter((p) => p.type === 'dropdown' && p.key.includes('-') && !/^on/i.test(p.key))
    .map((p) => [p.key, prefs[p.key]]));
  return { css, marker, attributes, variables };
}

module.exports = { load, normalize, values, compile };
