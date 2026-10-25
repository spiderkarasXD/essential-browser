'use strict';
// Интерфейс Essential для телефона. Страницы сайтов — нативные WebView под этим слоем;
// сюда приходит состояние браузера (app.on('state')), а команды уходят через Native.post.

const $ = (s, root = document) => root.querySelector(s);

// h('div.row', { onclick }, ...дети) — как в panel.js на ПК
function h(tag, props = {}, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const I = {
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  page: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  tab: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v6"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  ghost: '<svg viewBox="0 0 24 24"><path d="M5 20V10a7 7 0 0 1 14 0v10l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2z"/><circle cx="9.5" cy="10.5" r="1"/><circle cx="14.5" cy="10.5" r="1"/></svg>',
  find: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>',
  desk: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  closeTab: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.01"/></svg>',
};

// ---------- связь с браузером ----------

let seq = 0;
const waiting = new Map();
const call = (cmd, args = {}) => new Promise((resolve) => {
  const id = ++seq;
  waiting.set(id, resolve);
  Native.post(cmd, JSON.stringify(args), id);
});
const send = (cmd, args = {}) => Native.post(cmd, JSON.stringify(args), 0);
const handlers = {};
window.app = {
  reply(id, data) { const r = waiting.get(id); waiting.delete(id); if (r) r(data); },
  on(ev, data) { handlers[ev]?.(data); },
};

let S = null; // последнее состояние браузера

// ---------- нижняя панель ----------

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function applyInsets(i) {
  if (!i) return;
  document.documentElement.style.setProperty('--top', i.top + 'px');
  document.documentElement.style.setProperty('--nav', i.bottom + 'px');
  document.body.classList.toggle('kb', !!i.keyboard);
}

function applyTheme(theme) {
  const t = theme || { colors: ['#2f7bff'], strength: 55, grain: 0, mode: 'dark' };
  const root = document.documentElement.style;
  root.setProperty('--ws', t.colors[0]);
  t.colors.forEach((c, i) => root.setProperty(`--c${i + 1}`, c));
  root.setProperty('--themed', themeBackground(t));
  root.setProperty('--grain-img', GRAIN_URL);
  root.setProperty('--grain', String((t.grain / 100) * 0.55));
  const light = t.mode === 'light';
  root.setProperty('--bar-bg', light
    ? `linear-gradient(0deg, color-mix(in srgb, ${t.colors[0]} 10%, #f4f3f8), color-mix(in srgb, ${t.colors[0]} 16%, #f4f3f8))`
    : `linear-gradient(0deg, color-mix(in srgb, ${t.colors[0]} 10%, #121218), color-mix(in srgb, ${t.colors[0]} 18%, #121218))`);
  root.setProperty('--bar-solid', light ? '#eeedf3' : '#18181f');
  document.body.classList.toggle('light', light);
}

let lastDone = 0;
function render(state) {
  S = state;
  applyInsets(state.insets);
  const sp = state.spaces.find((s) => s.id === state.activeSpace);
  applyTheme(sp?.theme);
  const n = state.nav;
  document.body.classList.toggle('private', !!n.private);
  const addr = $('#addr');
  const text = $('.text', addr);
  text.textContent = n.url ? hostOf(n.url) : (n.private ? 'Приватная вкладка' : 'Поиск или адрес');
  text.classList.toggle('placeholder', !n.url);
  const lock = $('.lock', addr);
  lock.className = 'lock' + (n.secure === 'http' || n.secure === 'warn' ? ' warn' : '');
  lock.innerHTML = n.secure === 'https' ? I.lock : n.secure === 'newtab' ? I.search : I.warn;
  addr.classList.toggle('loading', n.loading);
  $('.prog', addr).style.transform = `scaleX(${n.loading ? Math.max(0.08, n.progress / 100) : 1})`;
  $('#b-back').disabled = !n.canBack;
  $('#b-tabs .count').textContent = state.tabs.length > 99 ? ':)' : String(state.tabs.length);
  $('#b-menu .dot').hidden = !(state.update.status === 'ready');

  // кружок загрузок
  const d = state.downloads;
  const btn = $('#b-dl');
  btn.hidden = !d.count;
  btn.classList.toggle('indeterminate', d.active > 0 && d.progress == null);
  btn.classList.toggle('idle', d.active === 0);
  btn.style.setProperty('--p', d.progress ?? 0);
  if (d.lastDone && d.lastDone !== lastDone && lastDone) send('toast', { text: 'Загрузка завершена' });
  lastDone = d.lastDone;

  for (const fn of listeners) fn(state);
}
const listeners = new Set(); // открытые экраны, которым нужно свежее состояние
handlers.state = render;
handlers.insets = applyInsets;

$('#b-back').onclick = () => send('back');
$('#addr').onclick = () => openSpotlight('current');
$('#b-tabs').onclick = () => openTabs();
$('#b-menu').onclick = () => openMenu();
$('#b-dl').onclick = () => openDownloads();
// свайп вверх по панели — экран вкладок, как в мобильных браузерах
let swipeY = null;
$('#bar').addEventListener('touchstart', (e) => { swipeY = e.touches[0].clientY; }, { passive: true });
$('#bar').addEventListener('touchend', (e) => {
  if (swipeY != null && swipeY - e.changedTouches[0].clientY > 40 && !findOpen) openTabs();
  swipeY = null;
});

// ---------- экраны (листы) ----------

const layer = $('#layer');
const stack = [];
let barTimer = null;

// Перед показом листа растягиваем интерфейс на весь экран; после закрытия последнего — сжимаем обратно в панель
function openSheet(el, { onclose } = {}) {
  clearTimeout(barTimer);
  if (!stack.length) send('ui', { mode: 'full' });
  layer.classList.add('on');
  layer.append(el);
  stack.push({ el, onclose });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  return el;
}

function closeTop() {
  const top = stack.pop();
  if (!top) return;
  top.el.classList.remove('in');
  top.onclose?.();
  setTimeout(() => top.el.remove(), 380);
  if (!stack.length) {
    layer.classList.remove('on');
    barTimer = setTimeout(() => send('ui', { mode: 'bar', keyboard: findOpen }), 300);
  }
}
const closeAll = () => { while (stack.length) closeTop(); };
handlers.back = () => (stack.length ? closeTop() : send('ui', { mode: 'bar' }));
$('#backdrop').onclick = () => closeTop();

const sheet = (cls, ...kids) => h('section.sheet' + (cls ? '.' + cls : ''), {}, ...kids);
const grip = () => h('div.grip');

// ---------- адресная строка ----------

function openSpotlight(mode) {
  const input = h('input.spot-input', { type: 'url', placeholder: 'Поиск или адрес сайта', autocomplete: 'off', spellcheck: false, enterKeyHint: 'go' });
  const list = h('div.scroll');
  const el = sheet('full.spot',
    h('div.top', {}, input, h('button.link-btn', { onclick: () => closeTop() }, 'Отмена')),
    list);
  if (mode === 'current' && S?.nav.url) input.value = S.nav.url;
  let items = [];
  let reqId = 0;
  const go = (it) => {
    input.blur();
    closeAll();
    if (it.type === 'tab') return send('switchTab', { id: it.tabId });
    send('open', { url: it.url, newTab: mode === 'new' });
  };
  const draw = () => {
    const nodes = [];
    let group = null;
    const label = { query: 'Недавние запросы', history: 'История', tab: 'Открытые вкладки', essential: 'Закреплённые', bookmark: 'Закладки' };
    items.forEach((it) => {
      const g = label[it.type] || null;
      if (g && g !== group) { nodes.push(h('div.group', {}, g)); group = g; }
      const ico = h('div.ico');
      if (it.type === 'search' || it.type === 'query') ico.innerHTML = it.type === 'query' ? I.clock : I.search;
      else if (it.type === 'tab') ico.innerHTML = I.tab;
      else ico.append(loadFavicon(new Image(), it.url, it.icon, () => { ico.innerHTML = I.page; }));
      const sub = it.type === 'search' ? `Искать в ${it.engine}` : it.type === 'tab' ? `${it.ws || ''} Перейти к вкладке` : it.type === 'query' ? '' : hostOf(it.url);
      const row = h('div.sug', { onclick: () => go(it) }, ico, h('div.t', {}, h('b', {}, it.title), sub && h('span', {}, sub)),
        // ↖ — подставить в строку, чтобы дописать
        (it.type === 'query' || it.type === 'search') && h('button.fill', { html: I.arrow, onclick: (e) => { e.stopPropagation(); input.value = it.title + ' '; input.focus(); update(); } }));
      // долгое нажатие на прошлый запрос — убрать его из подсказок (как Shift+Delete на ПК)
      if (it.type === 'query') {
        let t = null;
        row.addEventListener('touchstart', () => { t = setTimeout(() => { send('forgetSearch', { q: it.title }); send('toast', { text: 'Запрос удалён из подсказок' }); update(); t = 'done'; }, 600); }, { passive: true });
        row.addEventListener('touchend', (e) => { if (t === 'done') e.preventDefault(); clearTimeout(t); });
      }
      nodes.push(row);
    });
    list.replaceChildren(...nodes);
  };
  const update = async () => {
    const id = ++reqId;
    const r = await call('suggest', { q: input.value });
    if (id === reqId) { items = r || []; draw(); }
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.blur();
    closeAll();
    send('go', { text, newTab: mode === 'new' });
  });
  openSheet(el);
  input.focus(); // в том же нажатии, чтобы Android сразу показал клавиатуру
  if (mode === 'current') input.select();
  update();
}

// ---------- вкладки и пространства ----------

function openTabs() {
  const spacesEl = h('div.spaces');
  const body = h('div.scroll');
  const el = sheet('full', spacesEl, body,
    h('div.dock', {},
      h('button.btn', { onclick: () => { closeAll(); send('newTab', { private: true }); } }, '🕶 Приватная'),
      h('button.btn.primary', { onclick: () => { closeAll(); newTab(); } }, '+ Новая вкладка')));

  const draw = async () => {
    const tabs = await call('tabs');
    const st = S;
    spacesEl.replaceChildren(
      ...st.spaces.map((s) => h('button.space' + (s.id === st.activeSpace ? '.on' : ''), {
        style: `--sc: ${s.theme.colors[0]}`,
        onclick: () => { if (s.id === st.activeSpace) openSpaceEditor(s); else send('space.switch', { id: s.id }); },
      }, h('span.em', {}, s.icon), s.name, h('span.n', {}, String(s.count)))),
      h('button.space', { onclick: () => send('space.create') }, h('span.em', { html: I.plus, style: 'width: 18px' }), 'Пространство'));
    const pins = st.essentials.slice(0, 8).map((e) => {
      const ico = h('div.ico');
      ico.append(loadFavicon(new Image(), e.url, e.icon, () => { ico.textContent = (e.title || '?').trim()[0].toUpperCase(); }));
      const b = h('button.pin', { onclick: () => { closeAll(); send('open', { url: e.url, newTab: true }); } }, ico, h('span', {}, e.title));
      b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (confirm(`Открепить ${e.title}?`)) send('pin.remove', { url: e.url }); });
      return b;
    });
    const cards = tabs.map((t) => {
      const fav = t.favicon ? h('img', { src: t.favicon, alt: '' }) : h('i.dot');
      const card = h('div.tcard' + (t.id === st.activeTab ? '.on' : '') + (t.private ? '.priv' : ''), {},
        h('div.head', {}, fav, h('b', {}, (t.private ? '🕶 ' : '') + t.title),
          h('button.x', { html: I.x, onclick: (e) => { e.stopPropagation(); card.classList.add('gone'); setTimeout(() => send('closeTab', { id: t.id }), 180); } })),
        t.thumb ? h('div.shot', { style: `background-image: url(${t.thumb})` }) : h('div.shot.blank', {}, t.url ? hostOf(t.url) : 'Новая вкладка'));
      card.onclick = () => { closeAll(); send('switchTab', { id: t.id }); };
      return card;
    });
    body.replaceChildren(
      pins.length ? h('div.pins', {}, pins) : '',
      h('h3', { style: 'display: flex; justify-content: space-between' }, `Вкладки · ${tabs.length}`,
        h('button', { style: 'color: var(--ws); font-weight: 700; text-transform: none; letter-spacing: 0', onclick: () => send('reopen') }, 'Вернуть закрытую')),
      h('div.grid', {}, cards));
  };
  let lastKey = '';
  const onState = (st) => {
    // перерисовываем, только когда поменялся состав, а не на каждом проценте загрузки
    const key = JSON.stringify([st.activeSpace, st.activeTab, st.tabs.map((t) => [t.id, t.title, t.favicon]), st.spaces, st.essentials.length]);
    if (key !== lastKey) { lastKey = key; draw(); }
  };
  listeners.add(onState);
  openSheet(el, { onclose: () => listeners.delete(onState) });
  onState(S);
}

function newTab() {
  if (S?.settings.newTabStyle === 'spotlight') openSpotlight('new');
  else send('newTab');
}

function openSpaceEditor(space) {
  const s = JSON.parse(JSON.stringify(space));
  const body = h('div.scroll');
  const el = sheet('', grip(), body);
  const save = (patch) => { Object.assign(s, patch); send('space.update', { id: s.id, ...patch }); draw(); };
  const draw = () => {
    const t = s.theme;
    const preview = h('div.preview', { style: `background: ${themeBackground(t)}` }, h('div.g'));
    applyGrain($('.g', preview), t);
    const same = (a, b) => a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i].toLowerCase());
    const setTheme = (patch) => save({ theme: { ...t, ...patch } });
    body.replaceChildren(
      h('h2', {}, `${s.icon} ${s.name}`),
      preview,
      h('h3', {}, 'Готовые градиенты'),
      h('div.presets', {}, (presets || []).map((colors) => h('button.preset' + (same(colors, t.colors) ? '.on' : ''), {
        style: `background: ${themeBackground({ colors, strength: 85, mode: t.mode })}`,
        onclick: () => setTheme({ colors: [...colors] }),
      }))),
      h('h3', {}, 'Свои цвета (до четырёх)'),
      h('div.colors', {},
        t.colors.map((c, i) => h('div.color', { style: `background: ${c}` },
          h('input', { type: 'color', value: c, onchange: (e) => { const colors = [...t.colors]; colors[i] = e.target.value; setTheme({ colors }); } }),
          t.colors.length > 1 && h('button.rm', { onclick: () => setTheme({ colors: t.colors.filter((_, j) => j !== i) }) }, '×'))),
        t.colors.length < 4 && h('button.add-color', { onclick: () => setTheme({ colors: [...t.colors, t.colors[t.colors.length - 1]] }) }, '+')),
      h('h3', {}, 'Настройка'),
      h('div.card', {},
        h('div.row-i', {}, h('div.label', {}, 'Насыщенность'), h('input', { type: 'range', min: 0, max: 100, value: t.strength, style: 'width: 55%', onchange: (e) => setTheme({ strength: +e.target.value }) })),
        h('div.row-i', {}, h('div.label', {}, 'Зернистость'), h('input', { type: 'range', min: 0, max: 100, value: t.grain, style: 'width: 55%', onchange: (e) => setTheme({ grain: +e.target.value }) })),
        h('div.row-i', {}, h('div.label', {}, 'Режим'), h('div.seg', {},
          h('button' + (t.mode === 'dark' ? '.on' : ''), { onclick: () => setTheme({ mode: 'dark' }) }, '🌙 Тёмный'),
          h('button' + (t.mode === 'light' ? '.on' : ''), { onclick: () => setTheme({ mode: 'light' }) }, '☀️ Светлый')))),
      h('h3', {}, 'Название и иконка'),
      h('input', { type: 'text', value: s.name, maxLength: 40, onchange: (e) => save({ name: e.target.value }) }),
      h('div.icons', { style: 'margin-top: 10px' }, (icons || []).map((i) => h('button' + (i === s.icon ? '.on' : ''), { onclick: () => save({ icon: i }) }, i))),
      S.spaces.length > 1 && h('button.btn.danger', { style: 'width: 100%; margin-top: 20px', onclick: () => { if (confirm(`Удалить пространство «${s.name}» и его вкладки?`)) { send('space.delete', { id: s.id }); closeAll(); } } }, 'Удалить пространство'),
    );
  };
  draw();
  openSheet(el);
}

let presets = null;
let icons = null;
call('settings').then((r) => { presets = r.presets; icons = r.icons; });

// ---------- меню ----------

function openMenu() {
  const n = S.nav;
  const u = S.update;
  const tile = (icon, label, fn, on = false) => h('button.tile' + (on ? '.on' : ''), { onclick: fn }, h('span', { html: icon }), label);
  const run = (fn) => () => { closeAll(); fn(); };
  const el = sheet('', grip(),
    h('div.quick', {},
      h('button.ib', { html: I.back, disabled: !n.canBack, onclick: run(() => send('back')) }),
      h('button.ib', { html: I.fwd, disabled: !n.canForward, onclick: run(() => send('forward')) }),
      h('button.ib', { html: n.loading ? I.x : I.reload, onclick: run(() => send('reload')) }),
      h('button.ib', { html: I.share, disabled: !n.url, onclick: run(() => send('share')) }),
      h('button.ib', { html: I.pin, disabled: !n.url, style: n.pinned ? 'color: var(--ws)' : '', onclick: run(() => send('pin.toggle')) })),
    u.status === 'ready' && h('div.upd', {}, h('div.label', {}, `Скачан Essential ${u.version}. Вкладки сохранятся.`), h('button.btn.primary', { onclick: run(() => send('update.install')) }, 'Обновить')),
    h('div.tiles', {},
      tile(I.plus, 'Новая вкладка', run(newTab)),
      tile(I.ghost, 'Приватная', run(() => send('newTab', { private: true }))),
      tile(I.find, 'Найти на странице', run(openFind)),
      tile(I.dl, 'Загрузки', () => { closeTop(); setTimeout(openDownloads, 50); }),
      tile(I.desk, 'Версия для ПК', run(() => send('desktop')), n.desktop),
      tile(I.copy, 'Копировать ссылку', run(() => n.url && send('copy', { text: n.url }))),
      tile(I.closeTab, 'Закрыть вкладку', run(() => send('closeTab', { id: S.activeTab }))),
      tile(I.gear, 'Настройки', () => { closeTop(); setTimeout(() => openSettings(), 50); })));
  openSheet(el);
}

// ---------- поиск на странице ----------

let findOpen = false;
function openFind() {
  findOpen = true;
  $('.row.main').hidden = true;
  $('.row.find').hidden = false;
  $('#find-n').textContent = '';
  const q = $('#find-q');
  q.value = '';
  send('ui', { mode: 'bar', keyboard: true });
  setTimeout(() => q.focus(), 60);
}
function closeFind() {
  findOpen = false;
  $('.row.main').hidden = false;
  $('.row.find').hidden = true;
  $('#find-q').blur();
  send('findClose');
  send('ui', { mode: 'bar' });
}
$('#find-q').addEventListener('input', (e) => send('find', { q: e.target.value }));
$('#find-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') send('find', { q: e.target.value, forward: true }); });
$('#find-up').onclick = () => send('find', { forward: false });
$('#find-down').onclick = () => send('find', { forward: true });
$('#find-x').onclick = closeFind;
handlers.find = ({ active, total }) => { $('#find-n').textContent = total ? `${active} из ${total}` : ($('#find-q').value ? 'Нет' : ''); };

// ---------- загрузки ----------

const units = ['Б', 'КБ', 'МБ', 'ГБ'];
function size(n) {
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
function dlStatus(d) {
  const of = d.total > 0 ? `${size(d.received)} / ${size(d.total)}` : size(d.received);
  switch (d.state) {
    case 'progressing': {
      const left = d.total > 0 && d.speed > 0 ? Math.ceil((d.total - d.received) / d.speed) : 0;
      return [of, d.speed > 0 ? `${size(d.speed)}/с` : '', left ? `ещё ${left < 60 ? left + ' с' : Math.ceil(left / 60) + ' мин'}` : ''].filter(Boolean).join(' · ');
    }
    case 'paused': return `Ждёт сети · ${of}`;
    case 'completed': return [size(d.total || d.received), hostOf(d.url)].filter(Boolean).join(' · ');
    case 'cancelled': return 'Отменено';
    default: return 'Ошибка загрузки';
  }
}

function openDownloads() {
  const body = h('div.scroll');
  const el = sheet('', grip(), h('div.top', {}, h('div.title', {}, 'Загрузки'), h('button.btn', { onclick: () => send('openDownloads') }, 'Папка')), body);
  const draw = async () => {
    const list = await call('downloads');
    if (!list.length) return body.replaceChildren(h('div.empty', {}, 'Загрузок пока нет'));
    body.replaceChildren(...list.map((d) => {
      const active = d.state === 'progressing' || d.state === 'paused';
      const ext = h('div.ext', {}, (d.name.split('.').pop() || '').slice(0, 4).toUpperCase());
      if (active) {
        const p = d.total > 0 ? (d.received / d.total) * 100 : 25;
        ext.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" stroke="rgba(127,127,127,.25)"/><circle cx="24" cy="24" r="22" stroke="var(--ws)" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - p}"/></svg>`);
      }
      const acts = active ? [h('button.ib', { html: I.x, onclick: () => send('download', { id: d.id, action: 'cancel' }) })]
        : d.state === 'completed' ? [h('button.ib', { html: I.x, onclick: (e) => { e.stopPropagation(); send('download', { id: d.id, action: 'remove' }); setTimeout(draw, 100); } })]
          : [h('button.ib', { html: I.reload, onclick: () => send('download', { id: d.id, action: 'retry' }) })];
      return h('div.dl-item' + (['cancelled', 'interrupted'].includes(d.state) ? '.bad' : ''), {
        onclick: () => d.state === 'completed' && send('download', { id: d.id, action: 'open' }),
      }, ext, h('div.info', {}, h('b', {}, d.name), h('span', {}, dlStatus(d))), ...acts);
    }));
  };
  const timer = setInterval(draw, 1000);
  openSheet(el, { onclose: () => clearInterval(timer) });
  draw();
}

// ---------- долгое нажатие на ссылку, вопросы сайтов ----------

handlers.context = ({ link, image, title, private: priv }) => {
  const act = (icon, label, fn) => h('button.act', { onclick: () => { closeAll(); fn(); } }, h('span', { html: icon }), label);
  const el = sheet('', grip(),
    h('div.ctx-head', {}, h('b', {}, title || link || image), link && title && h('div.hint', {}, link)),
    link && act(I.plus, 'Открыть в новой вкладке', () => send('open', { url: link, newTab: true, private: priv })),
    link && act(I.tab, 'Открыть в фоне', () => { send('open', { url: link, newTab: true, background: true, private: priv }); send('toast', { text: 'Открыто в фоне' }); }),
    link && !priv && act(I.ghost, 'Открыть в приватной вкладке', () => send('open', { url: link, newTab: true, private: true })),
    link && act(I.copy, 'Копировать ссылку', () => send('copy', { text: link })),
    image && act(I.img, 'Открыть изображение', () => send('open', { url: image, newTab: true, private: priv })),
    image && act(I.dl, 'Скачать изображение', () => send('open', { url: image, newTab: false })),
    h('div', { style: 'height: 8px' }));
  openSheet(el);
};

handlers.ask = (q) => {
  let answered = false;
  const answer = (ok) => { answered = true; send('answer', { id: q.id, ok }); closeTop(); };
  const el = sheet('', grip(),
    h('div.scroll', {},
      h('h2', {}, `${q.origin}`),
      h('p', { style: 'margin: 0 4px 18px; color: var(--muted)' }, `Сайт просит доступ: ${q.what}.`),
      h('div', { style: 'display: flex; gap: 10px' },
        h('button.btn', { style: 'flex: 1; height: 48px', onclick: () => answer(false) }, 'Блокировать'),
        h('button.btn.primary', { style: 'flex: 1; height: 48px', onclick: () => answer(true) }, 'Разрешить'))));
  openSheet(el, { onclose: () => { if (!answered) send('answer', { id: q.id, ok: false }); } });
};

// ---------- тревога: карточка и короткая сирена (как alert.js на ПК) ----------

const ALERT_TEXTS = {
  danger: ['Опасность в вашей области', 'Объявлена угроза БПЛА. Отойдите от окон, пройдите в помещение без окон или в укрытие, на улицу не выходите. Следите за сообщениями МЧС и местных властей: это сообщение браузера не заменяет официальное оповещение.'],
  clear: ['Опасность снята', 'По данным источника, в вашей области опасность больше не объявлена. Дождитесь официального отбоя от МЧС или местных властей, прежде чем выходить.'],
  lost: ['Мониторинг тревоги не работает', 'Уже давно нет свежих данных от источника. Сейчас на этот сигнал полагаться нельзя — следите за официальными оповещениями МЧС и местных властей.'],
  test: ['Проверка сигнала', 'Так будет выглядеть и звучать тревога, если в вашей области объявят опасность. Это только проверка, ничего не случилось.'],
};
let siren = null;
function stopSiren() {
  if (!siren) return;
  const c = siren;
  siren = null;
  c.close().catch(() => {});
}
function startSiren() {
  stopSiren();
  const ctx = new AudioContext();
  siren = ctx;
  ctx.resume().catch(() => {});
  const gain = ctx.createGain();
  gain.gain.value = 0.18;
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.connect(gain);
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i * 0.55 < 12; i++) osc.frequency.setValueAtTime(i % 2 ? 880 : 660, t0 + i * 0.55);
  osc.start(t0);
  osc.stop(t0 + 12);
  osc.onended = () => { if (siren === ctx) stopSiren(); };
}

handlers.alert = ({ kind, region, sound }) => {
  const [title, text] = ALERT_TEXTS[kind] || ALERT_TEXTS.danger;
  const loud = sound && (kind === 'danger' || kind === 'test');
  const mute = h('button.btn', { onclick: () => { stopSiren(); mute.hidden = true; } }, 'Выключить звук');
  mute.hidden = !loud;
  const el = h('div.alert.' + kind, { role: 'alertdialog' },
    h('div.hd', {}, h('div.ic', { html: I.alert }), h('div', {}, h('div.tt', {}, title), region && h('div.rg', {}, region + (kind === 'test' ? ' · проверка' : '')))),
    h('p', {}, text),
    h('div.acts2', {}, h('button.btn.primary', { onclick: () => closeTop() }, 'Понятно'), mute));
  openSheet(el, { onclose: stopSiren });
  if (loud) startSiren();
  if (kind === 'clear' || kind === 'test') setTimeout(() => { if (stack.some((x) => x.el === el)) { const i = stack.findIndex((x) => x.el === el); if (i === stack.length - 1) closeTop(); } }, 20000);
};

// ---------- настройки ----------

const toggle = (label, hint, checked, onchange) => h('div.row-i', {},
  h('div.label', {}, label, hint && h('div.hint', {}, hint)),
  h('label.switch', {}, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span')));
const set = (key, value) => { send('set', { key, value }); if (data) data.settings[key] = value; };
let data = null;

const SECTIONS = [
  ['appearance', '🎨', 'Внешний вид'],
  ['search', '🔎', 'Поиск'],
  ['privacy', '🛡️', 'Конфиденциальность'],
  ['alerts', '🚨', 'Тревога'],
  ['sites', '🌐', 'Сайты и текст'],
  ['browser', '⚙️', 'Браузер и обновления'],
];

async function openSettings(section) {
  data = await call('settings');
  const body = h('div.scroll');
  const el = sheet('full', h('div.top', {}, h('button.ib', { html: I.back, onclick: () => closeTop() }), h('div.title', {}, 'Настройки')), body);
  body.append(
    h('div.card', {}, SECTIONS.filter(([id]) => id !== 'alerts' || S.alerts.available || S.alerts.country).map(([id, em, name]) =>
      h('div.row-i.tap.nav-row', { onclick: () => openSection(id) }, h('span.em', {}, em), h('div.label', {}, name), h('span.chev', { html: I.chev })))),
    h('div.hint', { style: 'text-align: center; margin-top: 18px' }, `Essential ${data.version} для Android`));
  openSheet(el);
  if (section) openSection(section);
}

function openSection(id) {
  const [, , title] = SECTIONS.find((s) => s[0] === id);
  const body = h('div.scroll');
  const el = sheet('full', h('div.top', {}, h('button.ib', { html: I.back, onclick: () => closeTop() }), h('div.title', {}, title)), body);
  const draw = () => body.replaceChildren(...RENDER[id](draw).filter(Boolean));
  draw();
  if (id === 'alerts') {
    const fn = () => draw();
    listeners.add(fn);
    openSheet(el, { onclose: () => listeners.delete(fn) });
  } else openSheet(el);
}

function newTabChoice(value, onpick) {
  const card = (id, title, hint, mock) => h('button.nt' + (value === id ? '.on' : ''), { onclick: () => onpick(id) }, h('div.nt-mock', { html: mock }), h('b', {}, title), h('span', {}, hint));
  return h('div.nt-grid', {},
    card('page', 'Страница', 'Часы, поиск и закреплённые', '<div class="m-clock">00:16</div><div class="m-bar"></div><div class="m-tiles"><i></i><i></i><i></i><i></i></div>'),
    card('spotlight', 'Строка поиска', 'Сразу с недавними запросами', '<div class="m-pop"><div class="m-bar" style="width:100%"></div><div class="m-row on"></div><div class="m-row"></div><div class="m-row"></div></div>'));
}

const CLOCK_STYLES = [['thin', 'Тонкий'], ['bold', 'Жирный'], ['stacked', 'Столбиком'], ['outline', 'Контур'], ['mono', 'Моно'], ['analog', 'Стрелки'], ['hidden', 'Скрыты']];
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many}`;
};

const RENDER = {
  appearance(redraw) {
    const s = data.settings;
    const c = s.clock;
    const setClock = (patch) => { s.clock = { ...c, ...patch }; send('set', { key: 'clock', value: s.clock }); redraw(); };
    const sp = S.spaces.find((x) => x.id === S.activeSpace);
    return [
      h('h3', {}, 'Новая вкладка'),
      newTabChoice(s.newTabStyle, (v) => { set('newTabStyle', v); redraw(); }),
      h('h3', {}, 'Часы на новой вкладке'),
      h('div.card', {},
        h('div.row-i', {}, h('div.label', {}, 'Стиль'), h('select', { onchange: (e) => setClock({ style: e.target.value }) }, CLOCK_STYLES.map(([v, l]) => h('option', { value: v, selected: c.style === v }, l)))),
        h('div.row-i', {}, h('div.label', {}, 'Цвет'), h('select', { onchange: (e) => setClock({ color: e.target.value }) },
          [['white', 'Белый'], ['accent', 'Цвет темы'], ['gradient', 'Градиент']].map(([v, l]) => h('option', { value: v, selected: c.color === v }, l)))),
        toggle('Секунды', null, c.seconds, (v) => setClock({ seconds: v })),
        toggle('12-часовой формат', null, c.h12, (v) => setClock({ h12: v })),
        toggle('Приветствие и дата', null, c.date, (v) => setClock({ date: v }))),
      h('h3', {}, 'Тема пространства'),
      h('div.card', {}, h('div.row-i.tap', { onclick: () => openSpaceEditor(sp) },
        h('div', { style: `width: 40px; height: 40px; border-radius: 12px; flex: none; background: ${themeBackground(sp.theme)}` }),
        h('div.label', {}, `${sp.icon} ${sp.name}`, h('div.hint', {}, 'Цвета, насыщенность, зерно, светлая или тёмная')), h('span.chev', { html: I.chev }))),
    ];
  },

  search(redraw) {
    const s = data.settings;
    return [
      h('h3', {}, 'Поисковая система'),
      h('div.engines', {}, Object.entries(data.engines).map(([id, name]) => h('button.engine' + (s.searchEngine === id ? '.on' : ''), { onclick: () => { set('searchEngine', id); redraw(); } }, name))),
      h('h3', {}, 'История запросов'),
      h('div.card', {},
        toggle('Запоминать поисковые запросы', 'Подсказываются в адресной строке. Долгое нажатие на запрос убирает его', s.rememberSearches, (v) => set('rememberSearches', v)),
        h('div.row-i', {}, h('div.label', {}, 'Сохранено', h('div.hint', {}, plural(data.counts.searches, 'запрос', 'запроса', 'запросов'))),
          h('button.btn', { onclick: async () => { data.counts = await call('clear', { searches: true }); redraw(); } }, 'Очистить'))),
    ];
  },

  privacy(redraw) {
    const s = data.settings;
    const perm = (key, label) => h('div.row-i', {}, h('div.label', {}, label),
      h('select', { onchange: (e) => { s.permissions[key] = e.target.value; send('set', { key: 'permissions', value: s.permissions }); } },
        [['ask', 'Спрашивать'], ['allow', 'Разрешать'], ['block', 'Блокировать']].map(([v, l]) => h('option', { value: v, selected: s.permissions[key] === v }, l))));
    const ITEMS = [['history', 'История', plural(data.counts.history, 'страница', 'страницы', 'страниц')], ['searches', 'Запросы', plural(data.counts.searches, 'запрос', 'запроса', 'запросов')],
      ['cache', 'Кэш', 'картинки и файлы сайтов'], ['cookies', 'Cookies и данные', 'выйдет из аккаунтов']];
    const picked = new Set(['history', 'cache']);
    const button = h('button.btn.danger', { style: 'width: 100%; margin-top: 12px; height: 48px' });
    const sync = () => { button.disabled = !picked.size; button.textContent = picked.size ? `Щёлкнуть пальцами · ${picked.size}` : 'Ничего не выбрано'; };
    const tiles = ITEMS.map(([key, title, meta]) => {
      const t = h('button.wipe' + (picked.has(key) ? '.on' : ''), { onclick: () => { picked.has(key) ? picked.delete(key) : picked.add(key); t.classList.toggle('on', picked.has(key)); sync(); } }, h('b', {}, title), h('span', {}, meta));
      t.dataset.key = key;
      return t;
    });
    button.onclick = async () => {
      button.disabled = true;
      tiles.filter((t) => picked.has(t.dataset.key)).forEach((t, i) => setTimeout(() => t.classList.add('dust'), i * 120));
      data.counts = await call('clear', Object.fromEntries([...picked].map((k) => [k, true])));
      setTimeout(redraw, 1100);
    };
    sync();
    return [
      h('div.card', {},
        toggle('Отправлять «Не отслеживать»', 'Заголовки DNT и GPC для открываемых страниц', s.doNotTrack, (v) => set('doNotTrack', v)),
        toggle('Предупреждать о сайтах без HTTPS', 'Перед сайтом без сертификата спросит, точно ли туда идти. Роутеры и домашняя сеть — без вопросов', s.httpsWarning, (v) => set('httpsWarning', v)),
        s.httpAllowed.length > 0 && h('div.row-i', {}, h('div.label', {}, 'Разрешённые без HTTPS', h('div.hint', {}, s.httpAllowed.slice(-3).join(', '))),
          h('button.btn', { onclick: () => { set('httpAllowed', []); redraw(); } }, 'Сбросить'))),
      h('h3', {}, 'Разрешения сайтов'),
      h('div.card', {}, perm('media', 'Камера и микрофон'), perm('geolocation', 'Местоположение')),
      h('div.hint', { style: 'margin: 8px 6px 0' }, S.privateIsolated ? 'Приватные вкладки живут в отдельном профиле: свои cookies, всё стирается.' : 'На этом телефоне WebView старый: приватные вкладки не сохраняют историю, но cookies у них общие с обычными.'),
      h('h3', {}, 'Очистить данные'),
      h('div.wipe-grid', {}, tiles),
      button,
    ];
  },

  alerts(redraw) {
    const a = S.alerts;
    const hhmm = (sec) => new Date(sec * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const status = !a.available ? 'Источник данных не подключён — оповещения не работают.'
      : a.country !== 'ru' ? 'Выключено.'
        : !a.region ? 'Выберите область — тогда начнём следить.'
          : { danger: `⚠ В области «${a.regionName}» объявлена опасность.`, ok: `Слежу за областью «${a.regionName}». Данные от ${hhmm(a.updated)}. Сообщений об опасности нет — это не гарантия безопасности.`,
            stale: 'Источник давно не обновлялся. Сейчас на сигнал полагаться нельзя.', error: `Нет данных от источника: ${a.error}. Сейчас на сигнал полагаться нельзя.`, checking: 'Проверяем источник…' }[a.status] || 'Выключено.';
    const bad = ['danger', 'stale', 'error'].includes(a.status);
    const save = (patch) => send('alerts.set', patch);
    const out = [
      h('div.card.why-card', {}, ALERTS_WHY.map(([t, b]) => h('div.why-row', {}, h('b', {}, t), h('span', {}, b)))),
      h('h3', {}, 'Статус'),
      h('div.card', {},
        h('div.row-i', {}, h('div.label', {}, h('div.hint' + (bad ? '.err' : ''), { style: 'font-size: 14px' }, status))),
        h('div.row-i', {}, h('div.label', {}, 'Вы находитесь в России?'), h('div.seg', {},
          h('button' + (a.country === 'ru' ? '.on' : ''), { onclick: () => { save({ country: 'ru' }); send('notifications'); } }, 'Да'),
          h('button' + (a.country === 'other' ? '.on' : ''), { onclick: () => save({ country: 'other' }) }, 'Нет'))),
        toggle('Звуковой сигнал', 'Короткая сирена вместе с сообщением', a.sound, (v) => save({ sound: v })),
        h('div.row-i', {}, h('div.label', {}, 'Проверить сигнал', h('div.hint', {}, 'Покажет сообщение и сыграет сирену')), h('button.btn', { onclick: () => { closeAll(); setTimeout(() => send('alerts.test'), 350); } }, 'Проверить'))),
    ];
    if (a.country === 'ru') {
      const box = h('div.card', { style: 'padding: 12px' }, h('div.hint', {}, 'Загружаем список…'));
      call('alerts.regions').then((r) => box.replaceChildren(regionPicker(r.regions, a.region, (reg) => save({ region: reg.id, regionName: reg.name }))));
      out.push(h('h3', {}, 'Ваша область или край'), box);
    }
    out.push(h('h3', {}, 'Источник данных'), h('div.card', { style: 'padding: 12px' },
      h('input', { type: 'url', value: a.source, placeholder: 'https://… (пусто — по умолчанию)', onchange: (e) => save({ source: e.target.value.trim() }) }),
      h('div.hint', { style: 'margin-top: 8px' }, 'JSON со списком областей и их статусом. Формат описан в README проекта.')));
    return out;
  },

  sites(redraw) {
    const s = data.settings;
    const sample = h('div', { style: `padding: 14px; font-size: ${15 * s.textZoom / 100}px; line-height: 1.45` }, 'Съешь же ещё этих мягких французских булок, да выпей чаю.');
    return [
      h('h3', {}, 'Размер текста на сайтах'),
      h('div.card', {},
        h('div.row-i', {}, h('input', { type: 'range', min: 50, max: 200, step: 10, value: s.textZoom,
          oninput: (e) => { sample.style.fontSize = (15 * e.target.value / 100) + 'px'; e.target.parentNode.nextSibling.textContent = e.target.value + '%'; },
          onchange: (e) => set('textZoom', +e.target.value) })),
        h('div.row-i', { style: 'min-height: 0; padding-top: 0' }, `${s.textZoom}%`),
        sample),
      h('div.card', { style: 'margin-top: 12px' },
        h('div.row-i', {}, h('div.label', {}, 'Минимальный размер шрифта', h('div.hint', {}, 'Мельче сайты писать не смогут')),
          h('select', { onchange: (e) => set('minFontSize', +e.target.value) }, [0, 8, 10, 12, 14, 16].map((v) => h('option', { value: v, selected: s.minFontSize === v }, v ? v + ' px' : 'Нет')))),
        toggle('Тёмная тема для всех сайтов', 'WebView сам затемняет светлые страницы', s.forceDarkSites, (v) => set('forceDarkSites', v))),
    ];
  },

  browser(redraw) {
    const s = data.settings;
    const u = S.update;
    const utext = { idle: `Essential ${u.current}`, checking: 'Проверяем…', downloading: `Скачиваем Essential ${u.version}… ${u.progress}%`, ready: `Essential ${u.version} скачан — нажмите «Обновить»`,
      latest: `Essential ${u.current} — последняя версия`, error: `Не удалось проверить: ${u.error}` }[u.status] || '';
    return [
      h('div.card', {},
        h('div.row-i', {}, h('div.label', {}, 'Браузер по умолчанию', h('div.hint', {}, data.isDefault ? 'Essential уже браузер по умолчанию' : 'Ссылки из Telegram, VK и других приложений будут открываться здесь')),
          h('button.btn', { onclick: () => send('defaultBrowser') }, data.isDefault ? 'Изменить' : 'Сделать')),
        toggle('Восстанавливать вкладки при запуске', null, s.restoreSession, (v) => set('restoreSession', v))),
      h('h3', {}, 'Обновления'),
      h('div.card', {},
        h('div.row-i', {}, h('div.label', {}, 'Версия', h('div.hint', {}, utext)),
          u.status === 'ready' ? h('button.btn.primary', { onclick: () => send('update.install') }, 'Обновить')
            : h('button.btn', { disabled: u.status === 'checking' || u.status === 'downloading', onclick: () => { send('update.check'); setTimeout(redraw, 300); } }, 'Проверить')),
        toggle('Обновлять автоматически', 'Новая версия скачивается в фоне, установка — по кнопке «Обновить»', s.autoUpdate, (v) => set('autoUpdate', v))),
      h('h3', {}, 'Первый запуск'),
      h('div.card', {}, h('div.row-i.tap', { onclick: () => { closeAll(); setTimeout(openOnboarding, 350); } }, h('div.label', {}, 'Пройти первую настройку заново'), h('span.chev', { html: I.chev }))),
    ];
  },
};
// обновлять экран «Браузер» вместе с прогрессом загрузки обновления
listeners.add(() => {});

// ---------- первый запуск ----------

async function openOnboarding() {
  data = await call('settings');
  const st = S;
  const theme = JSON.parse(JSON.stringify(st.spaces.find((s) => s.id === st.activeSpace).theme));
  const aurora = h('div.aurora', {}, h('i'), h('i'), h('i'));
  const stage = h('div.stage');
  const el = h('section.sheet.onb', {}, aurora, stage);
  const steps = [intro, searchStep, themeStep, newTabStep, ...(st.alerts.available ? [alertsStep] : []), defaultStep, doneStep];
  let step = 0;
  const setAurora = (colors) => colors.forEach((c, i) => el.style.setProperty(`--c${i + 1}`, c));
  setAurora(theme.colors);

  const eyebrow = () => h('div.eyebrow', {}, `Шаг ${step} из ${steps.length - 2}`);
  const nav = (next = 'Дальше', back = true) => h('div.acts', {},
    back && h('button.btn.ghost', { onclick: () => go(step - 1) }, 'Назад'),
    h('button.btn.primary', { onclick: () => go(step + 1) }, next));
  const opt = (on, title, meta, fn) => h('button.opt' + (on ? '.on' : ''), { onclick: fn }, h('div.t', {}, h('b', {}, title), meta && h('span', {}, meta)), h('div.tick', { html: I.check }));

  function intro() {
    return [h('div.step.center', {},
      h('img.logo', { src: 'icon.png', alt: '' }),
      h('h1.word', { style: 'font-size: 44px' }, [...'Essential'].map((ch, i) => h('span', { style: `animation-delay: ${0.3 + i * 0.06}s` }, ch))),
      h('p.sub', {}, 'Быстрый браузер на Chromium. Настроим его под вас — это займёт минуту.')),
    h('div.acts', {}, h('button.btn.primary', { onclick: () => go(1) }, 'Начать'))];
  }
  function searchStep() {
    const list = h('div', { style: 'display: flex; flex-direction: column; gap: 8px' });
    const draw = () => list.replaceChildren(...Object.entries(data.engines).map(([id, name]) => opt(data.settings.searchEngine === id, name, null, () => { data.settings.searchEngine = id; send('set', { key: 'searchEngine', value: id }); draw(); })));
    draw();
    return [h('div.step', {}, eyebrow(), h('h1', {}, 'Где будем искать?'), h('p.sub', {}, 'Поисковик для адресной строки. Поменять можно в любой момент.'), list), nav()];
  }
  function themeStep() {
    const preview = h('div.preview');
    const grid = h('div.presets');
    const draw = () => {
      preview.style.background = themeBackground(theme);
      setAurora(theme.colors);
      grid.replaceChildren(...data.presets.map((colors) => h('button.preset' + (colors.join() === theme.colors.join() ? '.on' : ''), {
        style: `background: ${themeBackground({ colors, strength: 85, mode: 'dark' })}`,
        onclick: () => { theme.colors = [...colors]; send('space.update', { id: st.activeSpace, theme }); draw(); },
      })));
    };
    draw();
    return [h('div.step', {}, eyebrow(), h('h1', {}, 'Выберите настроение'), h('p.sub', {}, 'Цвет пространства. Потом можно собрать свой градиент из четырёх цветов.'), preview, grid), nav()];
  }
  function newTabStep() {
    const box = h('div');
    const draw = () => box.replaceChildren(newTabChoice(data.settings.newTabStyle, (v) => { data.settings.newTabStyle = v; send('set', { key: 'newTabStyle', value: v }); draw(); }));
    draw();
    return [h('div.step', {}, eyebrow(), h('h1', {}, 'Как открывать новую вкладку?'), h('p.sub', {}, 'Что появится по кнопке «+ Новая вкладка». Поменять можно в настройках.'), box), nav()];
  }
  function alertsStep() {
    const a = { ...st.alerts };
    const q = h('div', { style: 'display: flex; flex-direction: column; gap: 8px' });
    const regionBox = h('div');
    const draw = () => {
      q.replaceChildren(h('div.q', {}, 'Вы находитесь в России?'),
        opt(a.country === 'ru', 'Да', 'Спросим область и будем следить за ней', () => { a.country = 'ru'; send('alerts.set', { country: 'ru' }); send('notifications'); draw(); }),
        opt(a.country === 'other', 'Нет', 'Оповещения не нужны, ничего не сохраняем', () => { a.country = 'other'; a.region = ''; send('alerts.set', { country: 'other' }); draw(); }));
      if (a.country !== 'ru') return regionBox.replaceChildren();
      call('alerts.regions').then((r) => regionBox.replaceChildren(h('div.q', { style: 'margin: 6px 0 8px' }, 'В какой вы области или крае?'),
        regionPicker(r.regions, a.region, (reg) => { a.region = reg.id; send('alerts.set', { region: reg.id, regionName: reg.name }); })));
    };
    draw();
    return [h('div.step', {}, eyebrow(), h('h1', {}, 'Оповещения о беспилотной опасности'),
      h('p.sub', {}, 'Если в вашей области объявят опасность БПЛА, Essential включит сигнал и подскажет, что делать.'),
      h('div.card.why-card', {}, ALERTS_WHY.map(([t, b]) => h('div.why-row', {}, h('b', {}, t), h('span', {}, b)))),
      q, regionBox), nav()];
  }
  function defaultStep() {
    return [h('div.step', {}, eyebrow(), h('h1', {}, 'Сделать Essential главным?'),
      h('p.sub', {}, 'Тогда ссылки из Telegram, VK и других приложений будут открываться в Essential. Можно пропустить — это есть в настройках.'),
      opt(data.isDefault, 'Браузер по умолчанию', data.isDefault ? 'Уже выбран' : 'Android спросит подтверждение', () => send('defaultBrowser'))), nav()];
  }
  function doneStep() {
    return [h('div.step.center', {},
      h('div', { html: '<svg viewBox="0 0 100 100" style="width: 96px; height: 96px; stroke: #59c38a; stroke-width: 5"><circle cx="50" cy="50" r="46" opacity=".3"/><path d="M31 51l13 13 26-28"/></svg>' }),
      h('h1', {}, 'Всё готово'),
      h('p.sub', {}, 'Свайп вверх по нижней панели — все вкладки и пространства. Нажатие на адрес — поиск.')),
    h('div.acts', {}, h('button.btn.primary', { onclick: finish }, 'Поехали'))];
  }
  function finish() { send('onboarded'); closeTop(); }

  function go(n) {
    step = Math.max(0, Math.min(steps.length - 1, n));
    const kids = steps[step]();
    stage.replaceChildren(...kids, step > 0 && step < steps.length - 1 ? h('div.dots', {}, steps.slice(1, -1).map((_, i) => h('i' + (i + 1 === step ? '.on' : '')))) : '');
  }
  go(0);
  openSheet(el);
}

// ---------- запуск ----------

call('ready').then((state) => {
  render(state);
  if (!state.settings.onboarded) setTimeout(openOnboarding, 200);
});
