const $ = (s) => document.querySelector(s);
const tabsEl = $('#tabs');
const essEl = $('#essentials');
const wsListEl = $('#ws-list');
const wsName = $('#ws-name');

let state = null;
const tabEls = new Map(); // id -> элемент вкладки (не пересоздаём, чтобы favicon-ки не мигали)
let dragTab = null;

const ws = () => state.workspaces.find((w) => w.id === state.activeWs);
const originOf = (url) => { try { return new URL(url).origin; } catch { return url; } };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function dot() {
  const d = document.createElement('div');
  d.className = 'dot';
  return d;
}

// ---------- вкладки ----------

function makeTab(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.innerHTML = `
    <div class="fav"></div>
    <div class="title"></div>
    <button class="audio" title="Звук"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="waves" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/><path class="cross" d="M16 9l6 6M22 9l-6 6"/></svg></button>
    <button class="close" title="Закрыть (Ctrl+W)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  el.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.target.closest('button')) browser.switchTab(id);
  });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) browser.closeTab(id); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); browser.tabMenu(id); });
  el.querySelector('.close').addEventListener('click', () => browser.closeTab(id));
  el.querySelector('.audio').addEventListener('click', () => browser.muteTab(id));

  el.addEventListener('dragstart', (e) => {
    dragTab = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  });
  el.addEventListener('dragend', () => { dragTab = null; clearDrop(); });
  el.addEventListener('dragover', (e) => {
    if (dragTab == null) return;
    e.preventDefault();
    clearDrop();
    const r = el.getBoundingClientRect();
    el.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragTab == null) return;
    const ids = ws().tabs.map((t) => t.id);
    let index = ids.indexOf(id);
    if (el.classList.contains('drop-after')) index++;
    browser.moveTab(dragTab, index);
    clearDrop();
  });
  return el;
}

function clearDrop() {
  document.querySelectorAll('.drop-before, .drop-after, .drop').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop'));
}

// иконка вкладки: своя иконка страницы, а пока её нет (вкладка спит или грузится) — иконка сайта по адресу
function setFavicon(el, icon, pageUrl) {
  const fav = el.querySelector('.fav');
  const key = icon || originOf(pageUrl || '');
  if (fav.dataset.src === key) return;
  fav.dataset.src = key;
  if (!icon && !/^https?:/.test(pageUrl || '')) return fav.replaceChildren(dot());
  const img = new Image();
  img.draggable = false;
  fav.replaceChildren(loadFavicon(img, pageUrl, icon, () => img.replaceWith(dot())));
}

let shownWs = null;
let firstRender = true;

function replay(el, cls) {
  el.classList.remove('ws-next', 'ws-prev');
  void el.offsetWidth; // перезапуск анимации
  el.classList.add(cls);
}

function renderTabs() {
  const list = ws().tabs;
  const ids = new Set(list.map((t) => t.id));
  const wsChanged = shownWs !== null && shownWs !== state.activeWs;
  if (wsChanged) {
    // при смене пространства весь список уезжает вбок, без схлопывания по одной вкладке
    const order = state.workspaces.map((w) => w.id);
    const dir = order.indexOf(state.activeWs) > order.indexOf(shownWs) ? 'ws-next' : 'ws-prev';
    replay(tabsEl, dir);
    replay($('#ws-header'), dir);
  }
  shownWs = state.activeWs;
  for (const [id, el] of tabEls) {
    if (ids.has(id)) continue;
    tabEls.delete(id);
    if (wsChanged) el.remove();
    else {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 230);
    }
  }
  const live = () => [...tabsEl.children].filter((c) => !c.classList.contains('leaving'));
  list.forEach((t, i) => {
    let el = tabEls.get(t.id);
    if (!el) {
      el = makeTab(t.id);
      tabEls.set(t.id, el);
      if (!firstRender && !wsChanged) {
        el.classList.add('entering');
        el.addEventListener('animationend', () => el.classList.remove('entering'), { once: true });
      }
    }
    const at = live()[i];
    if (at !== el) tabsEl.insertBefore(el, at || null);
    el.classList.toggle('active', t.id === ws().activeTab);
    el.classList.toggle('loading', t.loading);
    el.classList.toggle('sleeping', t.sleeping);
    el.classList.toggle('audible', t.audible);
    el.classList.toggle('muted', t.muted);
    el.classList.toggle('private', t.isPrivate);
    el.querySelector('.waves').style.display = t.muted ? 'none' : '';
    el.querySelector('.cross').style.display = t.muted ? '' : 'none';
    el.querySelector('.title').textContent = t.title;
    el.title = t.url ? `${t.title}\n${t.url}` : t.title;
    setFavicon(el, t.favicon, t.url);
  });
  firstRender = false;
  tabEls.get(ws().activeTab)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- Essentials ----------

let lastEss = '';
function renderEssentials() {
  const curOrigin = originOf(state.nav.url);
  const key = JSON.stringify(state.essentials);
  if (key !== lastEss) {
    lastEss = key;
    const letter = (title) => () => {
      const d = document.createElement('div');
      d.className = 'letter';
      d.textContent = (title || '?').trim()[0].toUpperCase();
      return d;
    };
    essEl.replaceChildren(...state.essentials.map((e) => {
      const b = document.createElement('button');
      b.className = 'ess';
      b.title = `${e.title}\n${e.url}`;
      b.dataset.origin = originOf(e.url);
      const img = new Image();
      img.draggable = false;
      b.append(loadFavicon(img, e.url, e.icon, () => img.replaceWith(letter(e.title)())));
      b.addEventListener('click', () => browser.openEssential(e.url));
      b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); browser.essentialMenu(e.url); });
      return b;
    }));
    if (!state.essentials.length) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Перетащите вкладку сюда';
      essEl.append(hint);
    }
  }
  for (const b of essEl.querySelectorAll('.ess')) b.classList.toggle('active', b.dataset.origin === curOrigin);
}

// Закрепить вкладку перетаскиванием можно, только подержав её над закреплёнными: раньше вкладка закреплялась,
// если при перестановке её случайно отпускали чуть выше списка вкладок
const PIN_HOLD = 450;
let pinHoverSince = 0;
essEl.addEventListener('dragover', (e) => {
  if (dragTab == null) return;
  e.preventDefault();
  if (!pinHoverSince) pinHoverSince = performance.now();
  const ready = performance.now() - pinHoverSince >= PIN_HOLD;
  essEl.classList.toggle('drop', ready);
  e.dataTransfer.dropEffect = ready ? 'link' : 'none';
});
essEl.addEventListener('dragleave', (e) => {
  if (essEl.contains(e.relatedTarget)) return;
  essEl.classList.remove('drop');
  pinHoverSince = 0;
});
essEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const ready = pinHoverSince && performance.now() - pinHoverSince >= PIN_HOLD;
  essEl.classList.remove('drop');
  pinHoverSince = 0;
  if (dragTab != null && ready) browser.essentialFromTab(dragTab);
});
document.addEventListener('dragend', () => { pinHoverSince = 0; essEl.classList.remove('drop'); });

// ---------- рабочие пространства ----------

let lastWs = '';
let lastTheme = '';
function renderWorkspaces() {
  const w = ws();
  document.documentElement.style.setProperty('--ws', w.color);
  const themeKey = JSON.stringify(w.theme);
  if (themeKey !== lastTheme) {
    lastTheme = themeKey;
    // новая тема рисуется в заднем слое и проявляется поверх текущей
    const [a, b] = document.querySelectorAll('#bg .layer');
    const back = a.classList.contains('front') ? b : a;
    const front = back === a ? b : a;
    back.style.background = themeBackground(w.theme);
    back.classList.add('front');
    front.classList.remove('front');
    back.style.zIndex = '0';
    front.style.zIndex = '-1';
    document.body.classList.toggle('light', w.theme.mode === 'light');
    applyGrain($('#grain'), w.theme);
  }
  $('#ws-icon').textContent = w.icon;
  wsName.textContent = w.name;
  if (document.activeElement !== wsInput) wsInput.value = w.name;
  renderIconPicker(w);

  const key = JSON.stringify(state.workspaces.map((x) => [x.id, x.icon, x.name, x.color]));
  if (key !== lastWs) {
    lastWs = key;
    wsListEl.replaceChildren(...state.workspaces.map((x, i) => {
      const b = document.createElement('button');
      b.className = 'ws';
      b.dataset.id = x.id;
      b.textContent = x.icon;
      b.title = `${x.name} (Ctrl+Alt+${i + 1})`;
      b.addEventListener('click', () => browser.switchWs(x.id));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        browser.switchWs(x.id);
        setTimeout(() => setPopup(true), 50);
      });
      b.addEventListener('dragover', (e) => { if (dragTab != null) { e.preventDefault(); b.classList.add('drop'); } });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', (e) => {
        e.preventDefault();
        b.classList.remove('drop');
        if (dragTab != null) browser.moveTabToWs(dragTab, x.id);
      });
      return b;
    }));
  }
  for (const b of wsListEl.children) b.classList.toggle('active', +b.dataset.id === state.activeWs);
}

// ---------- попап пространства: название, иконка, тема ----------

const wsWrap = $('#ws-wrap');
const wsInput = $('#ws-name-input');
let lastIcons = '';

function renderIconPicker(w) {
  const key = w.icon + state.icons.join('');
  if (key === lastIcons) return;
  lastIcons = key;
  $('#ws-icons').replaceChildren(...state.icons.map((i) => {
    const b = document.createElement('button');
    b.textContent = i;
    b.classList.toggle('on', i === w.icon);
    b.addEventListener('click', () => browser.updateWs(state.activeWs, { icon: i }));
    return b;
  }));
  $('#ws-del').disabled = state.workspaces.length < 2;
}

function setPopup(open) {
  wsWrap.classList.toggle('open', open);
  if (open) {
    wsInput.value = ws().name;
    wsInput.focus();
    wsInput.select();
  }
}

const saveName = () => {
  if (wsInput.value.trim() && wsInput.value.trim() !== ws().name) browser.updateWs(state.activeWs, { name: wsInput.value });
};

$('#ws-header').addEventListener('click', () => setPopup(!wsWrap.classList.contains('open')));
$('#ws-header').addEventListener('contextmenu', (e) => { e.preventDefault(); setPopup(true); });
wsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { saveName(); setPopup(false); }
  if (e.key === 'Escape') setPopup(false);
});
wsInput.addEventListener('blur', saveName);
$('#ws-theme').addEventListener('click', () => { setPopup(false); browser.openPanel('appearance'); });
$('#ws-del').addEventListener('click', () => {
  if (confirm(`Удалить пространство «${ws().name}» вместе со всеми его вкладками?`)) {
    setPopup(false);
    browser.deleteWs(state.activeWs);
  }
});
document.addEventListener('mousedown', (e) => {
  if (wsWrap.classList.contains('open') && !wsWrap.contains(e.target)) setPopup(false);
});
window.addEventListener('blur', () => setPopup(false));

// ---------- верх панели ----------

const all = (act) => document.querySelectorAll(`[data-act="${act}"]`);

function renderNav() {
  const n = state.nav;
  for (const b of all('back')) b.disabled = !n.canGoBack;
  for (const b of all('forward')) b.disabled = !n.canGoForward;
  for (const b of all('reload')) {
    b.classList.toggle('loading', n.loading);
    b.title = n.loading ? 'Остановить' : 'Обновить (F5)';
  }
  const host = n.url ? hostOf(n.url) : '';
  const text = $('#urltext');
  text.textContent = host || 'Поиск или адрес';
  text.classList.toggle('placeholder', !n.url);
  $('#urlbar').classList.toggle('secure', n.url.startsWith('https://'));
  $('#urlbar').title = n.url || 'Адрес (Ctrl+L)';
  const tbUrl = $('#tb-url');
  tbUrl.textContent = host || 'Поиск или адрес';
  tbUrl.classList.toggle('placeholder', !n.url);
  tbUrl.title = n.url || 'Адрес (Ctrl+L)';
  for (const z of [$('#zoom'), ...all('zoom')]) {
    z.classList.toggle('on', n.zoom !== 100);
    z.textContent = n.zoom + '%';
  }
  for (const b of all('pin')) {
    b.classList.toggle('on', n.pinned);
    b.disabled = !n.url;
    b.title = n.pinned ? 'Открепить сайт (Ctrl+D)' : 'Закрепить сайт (Ctrl+D)';
  }
  for (const b of all('copy')) b.disabled = !n.url;
  renderPinnedExt();
}

// закреплённые расширения на верхней панели
let lastExt = '';
function renderPinnedExt() {
  const key = JSON.stringify(state.pinnedExt.map((e) => e.id));
  if (key === lastExt) return;
  lastExt = key;
  $('#tb-ext').replaceChildren(...state.pinnedExt.map((e) => {
    const b = document.createElement('button');
    b.className = 'icon ext-btn';
    b.title = e.name;
    if (e.icon) {
      const img = new Image();
      img.src = e.icon;
      b.append(img);
    } else {
      b.textContent = e.name[0];
    }
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      browser.activateExt(e.id, { x: r.left, y: r.top, width: r.width, height: r.height });
    });
    b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); browser.extMenu(e.id); });
    return b;
  }));
}

browser.onState((s) => {
  state = s;
  document.body.classList.toggle('compact', s.compact);
  document.body.classList.toggle('peek', s.peek);
  document.body.classList.toggle('maximized', s.maximized);
  document.body.classList.toggle('fs', s.fullscreen);
  renderWorkspaces();
  renderEssentials();
  renderTabs();
  renderNav();
});

let toastTimer;
browser.onToast((text) => {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
});

// ---------- кружок загрузок ----------

let lastDone = null;
let doneTimer = null;
const dlBtn = $('#dl-btn');

function openDownloads() {
  const r = dlBtn.getBoundingClientRect();
  browser.openDownloads(Math.round(r.left + r.width / 2) || window.innerWidth - 120);
}

browser.onDownloads((s) => {
  dlBtn.hidden = !s.count;
  dlBtn.classList.toggle('active', s.active > 0 && !s.paused);
  dlBtn.classList.toggle('paused', s.paused);
  dlBtn.classList.toggle('indeterminate', s.active > 0 && s.progress === null);
  dlBtn.classList.toggle('idle', !s.active);
  dlBtn.style.setProperty('--p', s.progress == null ? 0 : Math.round(s.progress * 100));
  dlBtn.querySelector('.dl-count').textContent = s.active > 1 ? s.active : '';
  dlBtn.title = s.active
    ? `Загружается: ${s.active}` + (s.progress != null ? ` · ${Math.round(s.progress * 100)}%` : '') + ' (Ctrl+J)'
    : 'Загрузки (Ctrl+J)';
  // загрузка закончилась — кружок на пару секунд становится зелёной галочкой
  if (!s.active && s.lastDone && s.lastDone !== lastDone) {
    lastDone = s.lastDone;
    dlBtn.classList.remove('done');
    void dlBtn.offsetWidth;
    dlBtn.classList.add('done');
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => dlBtn.classList.remove('done'), 2600);
  }
});
browser.onOpenDownloads(openDownloads);

// кнопки с data-act есть и в верхней панели, и в сайдбаре
const ACTIONS = {
  downloads: () => openDownloads(),
  back: () => browser.back(),
  forward: () => browser.forward(),
  reload: () => (state.nav.loading ? browser.stop() : browser.reload()),
  min: () => browser.minimize(),
  max: () => browser.maximize(),
  close: () => browser.close(),
  sidebar: () => browser.toggleCompact(),
  settings: () => browser.openPanel('appearance'),
  address: () => browser.openSpotlight('current'),
  copy: () => browser.copyUrl(),
  site: (el) => {
    const r = el.getBoundingClientRect();
    browser.siteMenu(Math.round(r.left + r.width / 2));
  },
  pin: () => browser.togglePin(),
  zoom: () => browser.resetZoom(),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) ACTIONS[el.dataset.act]?.(el);
});
$('#toolbar').addEventListener('dblclick', (e) => { if (e.target === e.currentTarget) browser.maximize(); });
$('#urlbar').addEventListener('click', (e) => {
  if (e.target.id === 'zoom') browser.resetZoom();
  else browser.openSpotlight('current');
});
$('#newtab').addEventListener('click', () => browser.openSpotlight('new'));
$('#ws-add').addEventListener('click', () => browser.createWs());
$('#edge').addEventListener('mouseenter', () => browser.peek(true));
$('#sidebar').addEventListener('mouseleave', (e) => { if (e.clientX > 20) browser.peek(false); });

browser.ready();
