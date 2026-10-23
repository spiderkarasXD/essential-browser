const $ = (s) => document.querySelector(s);
const pop = $('#pop');
let info = null;
let page = 'main';
let anchorX = 0; // где на верхней панели кнопка «Сайт»
let importList = null;
const picked = new Set();

const PERMS = [
  { key: 'media', label: 'Камера и микрофон', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3"/></svg>' },
  { key: 'geolocation', label: 'Местоположение', icon: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>' },
  { key: 'notifications', label: 'Уведомления', icon: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>' },
];
const GLOBAL = { ask: 'спрашивать', allow: 'разрешено', block: 'запрещено' };
const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const WARN = '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
const PIN = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function iconOr(src, name, cls = '') {
  if (src) {
    const img = new Image();
    img.src = src;
    img.alt = '';
    return img;
  }
  const l = el('div', 'letter' + cls);
  l.textContent = (name || '?').trim().charAt(0).toUpperCase();
  return l;
}

// ---------- страницы ----------

function go(next) {
  const back = next === 'main';
  page = next;
  for (const p of document.querySelectorAll('.page')) {
    const show = p.id === 'page-' + next;
    p.hidden = !show;
    p.classList.remove('enter', 'back');
    if (show) {
      void p.offsetWidth;
      p.classList.add('enter');
      if (back) p.classList.add('back');
    }
  }
  $('#more-menu').classList.remove('open');
  $('#more').classList.remove('on');
  if (next === 'add') loadImportList();
}

// ---------- главная ----------

function renderMain() {
  const grid = $('#ext-grid');
  const tiles = info.extensions.map((e) => {
    const b = el('button', 'ext');
    b.title = e.name + (e.popup ? '' : ' — работает само на страницах');
    b.append(iconOr(e.icon, e.name));
    if (e.pinned) b.append(el('span', 'pin', PIN));
    b.onclick = () => {
      // панель закрывается, а окно расширения встаёт под кнопкой «Сайт» на верхней панели
      close();
      site.activateExt(e.id, { x: anchorX - 13, y: 6, width: 26, height: 28 });
    };
    b.oncontextmenu = (ev) => { ev.preventDefault(); site.extMenu(e.id); };
    return b;
  });
  const add = el('button', 'ext add');
  add.textContent = '+';
  add.title = 'Добавить расширения';
  add.onclick = () => go('add');
  if (!tiles.length) {
    const empty = el('div', 'empty');
    empty.textContent = 'Расширений пока нет — перенесите из Arc или Chrome';
    grid.replaceChildren(add, empty);
  } else {
    grid.replaceChildren(...tiles, add);
  }

  $('#pip').checked = info.autoPip;
  $('#pip-row').classList.toggle('on', info.autoPip);

  const pill = $('#secure-pill');
  pill.disabled = !!info.internal;
  pill.classList.toggle('bad', !info.internal && !info.secure);
  pill.innerHTML = info.internal
    ? '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/></svg>' + info.host
    : (info.secure ? LOCK : WARN) + (info.secure ? 'Защищено' : 'Не защищено');
  pill.title = info.internal ? 'Страница браузера — настроек сайта нет' : `Настройки сайта ${info.host}`;
  // на служебных страницах копировать и смотреть код нечего
  for (const a of ['copy', 'source']) document.querySelector(`[data-action="${a}"]`).hidden = !!info.internal;
}

// ---------- настройки сайта ----------

function renderSite() {
  $('#host').textContent = info.host;
  const conn = $('#conn');
  conn.classList.toggle('bad', !info.secure);
  conn.innerHTML = (info.secure ? LOCK + 'Защищённое соединение' : WARN + 'Соединение не защищено');

  const fav = $('#fav');
  fav.replaceChildren();
  const img = new Image();
  img.src = info.favicon || `${info.origin}/favicon.ico`;
  img.onerror = () => { fav.textContent = info.host[0].toUpperCase(); };
  fav.append(img);

  $('#zoom-val').textContent = info.zoom + '%';
  $('#sound').checked = !info.muted;
  $('#sound').closest('.row').classList.toggle('on', !info.muted);
  $('#cookies').textContent = info.cookies ? `${info.cookies} cookie у сайта` : 'сайт ничего не хранит';

  $('#perms').replaceChildren(...PERMS.map((p) => {
    const st = info.perms[p.key];
    const effective = st.site || st.global;
    const row = el('div', 'row' + (effective === 'allow' ? ' on' : ''), `<div class="ico">${p.icon}</div>`);
    const label = el('div', 'label');
    label.textContent = p.label;
    const hint = el('div', 'hint');
    if (st.site) {
      hint.textContent = 'настроено для сайта · ';
      const reset = el('button', 'reset');
      reset.textContent = 'сбросить';
      reset.onclick = async () => { info = await site.perm(p.key, null); render(); };
      hint.append(reset);
    } else {
      hint.textContent = `как везде: ${GLOBAL[st.global]}`;
    }
    label.append(hint);
    const sw = el('label', 'switch', `<input type="checkbox" ${effective === 'allow' ? 'checked' : ''}><span></span>`);
    sw.querySelector('input').onchange = async (e) => { info = await site.perm(p.key, e.target.checked ? 'allow' : 'block'); render(); };
    row.append(label, sw);
    return row;
  }));
}

// ---------- добавление расширений ----------

async function loadImportList() {
  const list = $('#import-list');
  if (!importList) {
    list.textContent = 'Ищем расширения в других браузерах…';
    importList = await site.importable();
    // по умолчанию отмечаем расширения из Arc, которых ещё нет
    for (const e of importList) if (e.from === 'Arc' && !e.installed) picked.add(e.id);
  }
  renderImport();
}

function renderImport() {
  const list = $('#import-list');
  if (!importList.length) {
    list.textContent = 'В других браузерах расширений не нашлось.';
    return;
  }
  const groups = new Map();
  for (const e of importList) {
    if (!groups.has(e.from)) groups.set(e.from, []);
    groups.get(e.from).push(e);
  }
  // Arc первым
  const order = [...groups.keys()].sort((a, b) => (b === 'Arc') - (a === 'Arc'));
  list.replaceChildren(...order.flatMap((from) => {
    const head = el('div', 'imp-group');
    head.textContent = from;
    return [head, ...groups.get(from).map((e) => {
      const row = el('button', 'imp' + (picked.has(e.id) ? ' on' : '') + (e.installed ? ' done' : ''));
      row.append(iconOr(e.icon, e.name));
      const nm = el('div', 'nm');
      nm.textContent = e.name;
      row.append(nm);
      if (e.installed) {
        const tag = el('span', 'tag');
        tag.textContent = 'уже есть';
        row.append(tag);
      } else {
        row.append(el('span', 'box', CHECK));
      }
      row.onclick = () => {
        picked.has(e.id) ? picked.delete(e.id) : picked.add(e.id);
        row.classList.toggle('on', picked.has(e.id));
        syncImportButton();
      };
      return row;
    })];
  }));
  syncImportButton();
}

function syncImportButton() {
  const n = [...picked].filter((id) => !importList?.find((e) => e.id === id)?.installed).length;
  const b = $('#do-import');
  b.disabled = !n;
  b.textContent = n ? `Перенести · ${n}` : 'Выберите расширения';
}

$('#do-import').onclick = async () => {
  const b = $('#do-import');
  b.disabled = true;
  b.textContent = 'Переносим…';
  const r = await site.importExt([...picked]);
  $('#import-note').textContent = `Перенесено: ${r.done.length}` + (r.failed.length ? ` · не загрузились: ${r.failed.length}` : '');
  importList = null;
  picked.clear();
  info = (await site.info()) || info;
  render();
  go('main');
};
$('#unpacked').onclick = async () => {
  const r = await site.loadUnpacked();
  if (!r) return;
  if (r.error) $('#import-note').textContent = r.error;
  else {
    info = (await site.info()) || info;
    render();
    go('main');
  }
};
$('#store').onclick = () => {
  document.body.classList.remove('open');
  site.openStore();
};

// ---------- общее ----------

function render() {
  document.documentElement.style.setProperty('--ws', info.color || '#2f7bff');
  renderMain();
  if (!info.internal) renderSite();
}

function place(x) {
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  pop.style.left = left + 'px';
  pop.style.setProperty('--ox', Math.max(18, Math.min(w - 18, x - left)) + 'px');
}

function close() {
  document.body.classList.remove('open');
  site.close();
}

site.onOpen((data) => {
  info = data;
  anchorX = data.x || window.innerWidth / 2;
  render();
  go('main');
  place(anchorX);
  requestAnimationFrame(() => document.body.classList.add('open'));
});

for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => go(b.dataset.go);
$('#secure-pill').onclick = () => go('site');
$('#more').onclick = (e) => {
  e.stopPropagation();
  $('#more-menu').classList.toggle('open');
  $('#more').classList.toggle('on');
};
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#more-menu, #more')) {
    $('#more-menu').classList.remove('open');
    $('#more').classList.remove('on');
  }
});
$('#pip').onchange = async (e) => { info = await site.autoPip(e.target.checked); render(); };
$('#zoom-in').onclick = async () => { info = await site.zoom(0.5); render(); };
$('#zoom-out').onclick = async () => { info = await site.zoom(-0.5); render(); };
$('#zoom-val').onclick = async () => { info = await site.zoom(0); render(); };
$('#sound').onchange = async () => { info = await site.mute(); render(); };
$('#clear').onclick = async () => {
  const btn = $('#clear');
  btn.textContent = 'Чистим…';
  info = (await site.clearCookies()) || info;
  btn.textContent = 'Готово ✓';
  render();
  setTimeout(() => { btn.textContent = 'Очистить'; }, 1500);
};
for (const b of document.querySelectorAll('[data-action]')) {
  b.onclick = () => {
    document.body.classList.remove('open');
    site.action(b.dataset.action);
  };
}

$('#backdrop').addEventListener('mousedown', close);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (page !== 'main') go('main');
  else close();
});
window.addEventListener('blur', () => { if (document.body.classList.contains('open')) close(); });
