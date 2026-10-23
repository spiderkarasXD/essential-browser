const content = document.getElementById('content');
let data = null;
let section = 'appearance';
let importList = null;
const changedRestart = new Set();

// маленький помощник для разметки: h('div.row', { onclick }, ...children)
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

function toggleRow(label, hint, checked, onchange, restart = false) {
  return h('div.row', {},
    h('div.label', {}, label, restart && h('span.badge', {}, 'перезапуск'), hint && h('div.hint', {}, hint)),
    h('label.switch', {}, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span')));
}

function setSetting(key, value) {
  data.settings[key] = value;
  panel.set(key, value);
  if (data.restartKeys.includes(key)) {
    changedRestart.has(key) ? changedRestart.delete(key) : changedRestart.add(key);
    render();
  }
}

// ---------- Внешний вид ----------

function renderAppearance() {
  const ws = data.workspace;
  const t = ws.theme;
  const update = (patch) => {
    Object.assign(t, patch);
    panel.setTheme(t);
    document.documentElement.style.setProperty('--ws', t.colors[0]);
    render();
  };

  const preview = h('div.preview' + (t.mode === 'light' ? '.light' : ''), { style: `background: ${themeBackground(t)}` },
    h('div.grain'),
    h('div.mock', {}, h('div.side', {}, h('i'), h('i'), h('i'), h('i')), h('div.page')));
  applyGrain(preview.querySelector('.grain'), t);

  const same = (a, b) => a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i].toLowerCase());
  const presets = h('div.presets', {}, data.presets.map((colors) => h('button.preset' + (same(colors, t.colors) ? '.active' : ''), {
    style: `background: ${themeBackground({ colors, strength: 80, mode: t.mode })}`,
    onclick: () => update({ colors: [...colors] }),
  })));

  const colorInputs = h('div.colors', {},
    t.colors.map((c, i) => h('div.color', {},
      h('input', { type: 'color', value: c, oninput: (e) => { t.colors[i] = e.target.value; panel.setTheme(t); preview.style.background = themeBackground(t); }, onchange: () => update({}) }),
      t.colors.length > 1 && h('button.rm', { title: 'Убрать цвет', onclick: () => update({ colors: t.colors.filter((_, j) => j !== i) }) }, '×'))),
    t.colors.length < 3 && h('button.add-color', { title: 'Добавить цвет', onclick: () => update({ colors: [...t.colors, t.colors[t.colors.length - 1]] }) }, '+'));

  const range = (label, key) => h('div.row', {},
    h('div.label', { style: 'flex: 0 0 120px' }, label),
    h('div.range-row', { style: 'flex: 1' },
      h('input', { type: 'range', min: 0, max: 100, value: t[key], oninput: (e) => {
        t[key] = +e.target.value;
        e.target.nextSibling.textContent = t[key] + '%';
        preview.style.background = themeBackground(t);
        applyGrain(preview.querySelector('.grain'), t);
        panel.setTheme(t);
      } }),
      h('span.val', {}, t[key] + '%')));

  return [
    h('h2', {}, 'Внешний вид'),
    h('p.lead', {}, `Тема для пространства ${ws.icon} ${ws.name}. У каждого пространства своя тема, как в Zen.`),
    preview,
    h('h3', {}, 'Готовые градиенты'),
    presets,
    h('h3', {}, 'Свои цвета (до трёх)'),
    colorInputs,
    h('h3', {}, 'Настройка'),
    h('div.card', {},
      range('Насыщенность', 'strength'),
      range('Зернистость', 'grain'),
      h('div.row', {}, h('div.label', {}, 'Режим'),
        h('div.seg', {},
          h('button' + (t.mode === 'dark' ? '.on' : ''), { onclick: () => update({ mode: 'dark' }) }, '🌙 Тёмный'),
          h('button' + (t.mode === 'light' ? '.on' : ''), { onclick: () => update({ mode: 'light' }) }, '☀️ Светлый')))),
    h('h3', {}, 'Пространство'),
    h('div.card', {},
      h('div.row', {}, h('div.label', {}, 'Название'),
        h('input', { type: 'text', value: ws.name, maxLength: 40, style: 'width: 240px', onchange: (e) => { ws.name = e.target.value; panel.updateWs(ws.id, { name: e.target.value }); } })),
      h('div.row', { style: 'display: block' },
        h('div.label', { style: 'margin-bottom: 8px' }, 'Иконка'),
        h('div.icons', {}, data.icons.map((i) => h('button' + (i === ws.icon ? '.on' : ''), {
          onclick: () => { ws.icon = i; panel.updateWs(ws.id, { icon: i }); render(); },
        }, i))))),
  ];
}

// ---------- Поиск ----------

function renderSearch() {
  const s = data.settings;
  return [
    h('h2', {}, 'Поиск'),
    h('p.lead', {}, 'Поисковик для адресной строки и подсказки.'),
    h('h3', {}, 'Поисковая система'),
    h('div.engines', {}, Object.entries(data.engines).map(([id, name]) => h('button.engine' + (s.searchEngine === id ? '.on' : ''), {
      onclick: () => { setSetting('searchEngine', id); render(); },
    }, name))),
    h('h3', {}, 'История запросов'),
    h('div.card', {},
      toggleRow('Запоминать поисковые запросы', 'Подсказываются в адресной строке. Shift+Delete удаляет запрос из подсказок.', s.rememberSearches, (v) => setSetting('rememberSearches', v)),
      h('div.row', {}, h('div.label', {}, 'Сохранено запросов', h('div.hint', {}, String(data.counts.searches))),
        h('button.btn', { onclick: async () => { await panel.clear({ searches: true }); data.counts.searches = 0; render(); } }, 'Очистить'))),
  ];
}

// ---------- Конфиденциальность ----------

function renderPrivacy() {
  const s = data.settings;
  const perm = (key, label) => h('div.row', {}, h('div.label', {}, label),
    h('select', { onchange: (e) => setSetting('permissions', { ...s.permissions, [key]: e.target.value }) },
      [['ask', 'Спрашивать'], ['allow', 'Разрешать'], ['block', 'Блокировать']].map(([v, l]) => h('option', { value: v, selected: s.permissions[key] === v }, l))));
  const c = data.counts;
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many}`;
  };
  const mb = (bytes) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`);
  const ITEMS = [
    { key: 'history', title: 'История', meta: plural(c.history, 'страница', 'страницы', 'страниц'), icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' },
    { key: 'searches', title: 'Поисковые запросы', meta: plural(c.searches, 'запрос', 'запроса', 'запросов'), icon: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>' },
    { key: 'cache', title: 'Кэш', meta: mb(c.cache), icon: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>' },
    { key: 'cookies', title: 'Cookies и данные сайтов', meta: `${plural(c.cookies, 'cookie', 'cookie', 'cookie')} · выйдет из аккаунтов`, icon: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9 3 3 0 0 0 4 4 3 3 0 0 0 5 5z"/><circle cx="8.5" cy="10.5" r="1"/><circle cx="14" cy="15" r="1"/><circle cx="9" cy="16" r="1"/></svg>' },
  ];
  const picked = new Set(['history', 'cache']);
  const button = h('button.btn.danger', {}, 'Очистить выбранное');
  const sync = () => {
    button.disabled = !picked.size;
    button.textContent = picked.size ? `Щёлкнуть пальцами · ${picked.size}` : 'Ничего не выбрано';
  };
  const tiles = ITEMS.map((it) => {
    const el = h('button.wipe' + (picked.has(it.key) ? '.on' : ''), {
      onclick: () => {
        picked.has(it.key) ? picked.delete(it.key) : picked.add(it.key);
        el.classList.toggle('on', picked.has(it.key));
        sync();
      },
    },
    h('div.wipe-ico', { html: it.icon }),
    h('div.wipe-title', {}, it.title),
    h('div.wipe-meta', {}, it.meta),
    h('div.wipe-tick', { html: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' }));
    el.dataset.key = it.key;
    return el;
  });
  button.onclick = async () => {
    const chosen = tiles.filter((t) => picked.has(t.dataset.key));
    button.disabled = true;
    const job = panel.clear(Object.fromEntries([...picked].map((k) => [k, true])));
    await Promise.all(chosen.map((t, i) => snap(t, i * 120)));
    await job;
    Object.assign(data.counts, await panel.counts());
    setTimeout(() => render(true), 250);
  };
  sync();
  return [
    h('h2', {}, 'Конфиденциальность'),
    h('p.lead', {}, 'Отслеживание, разрешения сайтов и очистка данных.'),
    h('div.card', {},
      toggleRow('Отправлять «Не отслеживать»', 'Заголовки DNT и Global Privacy Control', s.doNotTrack, (v) => setSetting('doNotTrack', v))),
    h('h3', {}, 'Разрешения сайтов'),
    h('div.card', {}, perm('notifications', 'Уведомления'), perm('media', 'Камера и микрофон'), perm('geolocation', 'Местоположение')),
    h('h3', {}, 'Очистить данные'),
    h('div.wipe-grid', {}, tiles),
    h('div', { style: 'display: flex; justify-content: flex-end; margin-top: 12px' }, button),
  ];
}

// ---------- щелчок Таноса ----------

// Снимаем скриншот плитки, раскладываем её пиксели по слоям и сдуваем слои пылью вправо-вверх
async function snap(el, delay = 0) {
  await new Promise((r) => setTimeout(r, delay));
  const r = el.getBoundingClientRect();
  const url = await panel.snapshot({ x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) });
  const img = new Image();
  img.src = url;
  await img.decode();

  const W = img.width;
  const H = img.height;
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(img, 0, 0);
  const src = bctx.getImageData(0, 0, W, H).data;

  const LAYERS = 28;
  const layers = Array.from({ length: LAYERS }, () => new ImageData(W, H));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!src[i + 3]) continue;
      // пиксели правее чаще попадают в поздние слои — плитка рассыпается слева направо
      const layer = Math.min(LAYERS - 1, Math.floor(LAYERS * (Math.random() + (2 * x) / W) / 3));
      const d = layers[layer].data;
      d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2]; d[i + 3] = src[i + 3];
    }
  }

  const box = document.createElement('div');
  box.className = 'dust';
  box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  for (const data of layers) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d').putImageData(data, 0, 0);
    box.append(c);
  }
  document.body.append(box);
  el.style.visibility = 'hidden';

  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  [...box.children].forEach((c, i) => {
    const angle = (Math.random() - 0.5) * 2 * Math.PI * 0.35 - Math.PI / 5;
    const dist = 60 + Math.random() * 90;
    c.style.transitionDelay = `${(1.1 * i) / LAYERS}s`;
    c.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) rotate(${(Math.random() - 0.5) * 30}deg)`;
    c.style.opacity = '0';
    c.style.filter = 'blur(1.5px)';
  });
  await new Promise((res) => setTimeout(res, 2300));
  box.remove();
}

// ---------- Устройства ----------

let devices = null;

async function loadDevices() {
  // названия устройств видны только после доступа к ним — разок открываем и сразу закрываем
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
    stream?.getTracks().forEach((t) => t.stop());
  } catch {}
  devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind !== 'audiooutput' && !['default', 'communications'].includes(d.deviceId));
}

function renderDevices() {
  const s = data.settings;
  const head = [
    h('h2', {}, 'Устройства'),
    h('p.lead', {}, 'Микрофон и камера, которые получат сайты: Discord, Meet, Zoom и другие. Если сайт сам выбирает устройство в своих настройках, его выбор главнее.'),
  ];
  if (!devices) {
    loadDevices().then(() => { if (section === 'devices') render(); });
    return [...head, h('div.card', {}, h('div.row', {}, h('span.spinner'), 'Ищем микрофоны и камеры…'))];
  }
  const select = (key, kind, label, icon) => {
    const list = devices.filter((d) => d.kind === kind);
    const missing = s[key] && !list.some((d) => d.label === s[key]);
    return h('div.row', {},
      h('div.label', {}, `${icon}  ${label}`, h('div.hint', {}, list.length ? `найдено: ${list.length}` : 'не найдено')),
      h('select', { style: 'max-width: 320px', onchange: (e) => setSetting(key, e.target.value) },
        h('option', { value: '', selected: !s[key] }, 'Как в Windows'),
        list.map((d) => h('option', { value: d.label, selected: s[key] === d.label }, d.label || 'Без названия')),
        missing && h('option', { value: s[key], selected: true }, `${s[key]} (не подключено)`)));
  };
  return [
    ...head,
    h('div.card', {},
      select('micLabel', 'audioinput', 'Микрофон', '🎙️'),
      select('camLabel', 'videoinput', 'Камера', '📷')),
    h('p.lead', { style: 'margin-top: 12px' }, 'Уже открытые сайты возьмут новое устройство после обновления страницы.'),
  ];
}

// ---------- Загрузки ----------

function renderDownloads() {
  const s = data.settings;
  const dir = h('div.hint', {}, s.downloadsDir || data.downloadsDefault);
  return [
    h('h2', {}, 'Загрузки'),
    h('p.lead', {}, 'Куда сохранять скачанные файлы.'),
    h('div.card', {},
      h('div.row', {}, h('div.label', {}, 'Папка', dir),
        h('button.btn', { onclick: () => panel.openDownloads() }, 'Открыть'),
        h('button.btn', { onclick: async () => { const p = await panel.pickFolder(); if (p) { s.downloadsDir = p; dir.textContent = p; } } }, 'Изменить')),
      toggleRow('Всегда спрашивать, куда сохранить', null, s.downloadsAsk, (v) => setSetting('downloadsAsk', v))),
  ];
}

// ---------- Chromium ----------

function renderSystem() {
  const s = data.settings;
  return [
    h('h2', {}, 'Chromium'),
    h('p.lead', {}, `Движок: Chromium ${data.versions.chromium}, Electron ${data.versions.electron}. Настройки открываются и по адресу essential://settings (или chrome://settings).`),
    changedRestart.size > 0 && h('div.banner', {},
      h('div.label', {}, 'Часть изменений заработает после перезапуска. Вкладки сохранятся.'),
      h('button.btn.primary', { onclick: () => panel.restart() }, 'Перезапустить')),
    h('div.card', {},
      toggleRow('Аппаратное ускорение', 'Использовать видеокарту для отрисовки', s.hardwareAcceleration, (v) => setSetting('hardwareAcceleration', v), true),
      toggleRow('Плавная прокрутка', null, s.smoothScrolling, (v) => setSetting('smoothScrolling', v), true),
      toggleRow('Тёмная тема для всех сайтов', 'Chromium сам затемняет светлые страницы (Force Dark)', s.forceDarkSites, (v) => setSetting('forceDarkSites', v), true),
      toggleRow('Проверка орфографии', 'Русский и английский', s.spellcheck, (v) => setSetting('spellcheck', v)),
      toggleRow('Восстанавливать вкладки при запуске', null, s.restoreSession, (v) => setSetting('restoreSession', v))),
    h('h3', {}, 'Windows'),
    h('div.card', {},
      h('div.row', {},
        h('div.label', {}, 'Браузер по умолчанию',
          h('div.hint', {}, data.system.isDefault ? 'Essential уже браузер по умолчанию' : 'Ссылки из других программ будут открываться в Essential')),
        h('button.btn', { onclick: () => system.makeDefault() }, data.system.isDefault ? 'Открыть параметры' : 'Сделать')),
      toggleRow('Запускать вместе с Windows', null, data.system.autostart, (v) => { data.system.autostart = v; system.setAutostart(v); })),
    h('h3', {}, 'Первый запуск'),
    h('div.card', {},
      h('div.row', {},
        h('div.label', {}, 'Пройти первую настройку заново', h('div.hint', {}, 'Интро, импорт, поиск, тема, автозагрузка')),
        h('button.btn', { onclick: () => system.restartOnboarding() }, 'Запустить'))),
  ];
}

// ---------- Импорт ----------

const opts = { history: true, bookmarks: true, searches: true, essentials: false };
const selected = new Set();

function renderImport() {
  const body = h('div');
  const head = [
    h('h2', {}, 'Импорт из других браузеров'),
    h('p.lead', {}, 'История, закладки и поисковые запросы переносятся за пару секунд. Пароли и cookies не переносятся: войти в аккаунты нужно заново.'),
  ];
  if (!importList) {
    body.append(h('div.card', {}, h('div.row', {}, h('span.spinner'), 'Ищем браузеры на компьютере…')));
    panel.detectImport().then((list) => {
      importList = list;
      for (const b of list) if (!b.error && (b.history || b.bookmarks)) selected.add(b.id);
      if (section === 'import') render();
    });
    return [...head, body];
  }
  if (!importList.length) return [...head, h('div.card', {}, h('div.row', {}, 'Других браузеров не найдено.'))];

  const result = h('div');
  const button = h('button.btn.primary', {
    onclick: async () => {
      button.disabled = true;
      button.textContent = 'Импортируем…';
      const r = await panel.runImport([...selected], opts);
      button.disabled = false;
      button.textContent = 'Импортировать';
      const a = r.added;
      result.replaceChildren(h('div.result', {},
        `Готово: ${a.history} страниц истории, ${a.bookmarks} закладок, ${a.searches} запросов` + (opts.essentials ? `, ${a.essentials} закреплено` : '') + '.'));
      if (r.errors.length) result.append(h('div.result.err', {}, r.errors.join('\n')));
      data.counts.history += a.history;
      data.counts.searches += a.searches;
    },
  }, 'Импортировать');

  const opt = (key, label) => h('label.row', { style: 'cursor: pointer' },
    h('input.check', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; } }),
    h('div.label', {}, label));

  return [
    ...head,
    h('h3', {}, 'Найденные браузеры'),
    h('div.card', {}, importList.map((b) => h('label.row.browser', { style: 'cursor: pointer' },
      h('input.check', { type: 'checkbox', checked: selected.has(b.id), onchange: (e) => { e.target.checked ? selected.add(b.id) : selected.delete(b.id); } }),
      (() => {
        const box = h('div.ico');
        const img = h('img', { src: b.iconFile || b.icon || `${new URL(b.site).origin}/favicon.ico`, alt: '' });
        img.onerror = () => { box.textContent = b.name[0]; };
        box.append(img);
        return box;
      })(),
      h('div.label', {}, b.name,
        h('div.hint' + (b.error ? '.err' : ''), {}, b.error || `${b.history} в истории · ${b.bookmarks} закладок · ${b.searches} запросов · профилей: ${b.profiles}`))))),
    h('h3', {}, 'Что перенести'),
    h('div.card', {},
      opt('history', 'История посещений'),
      opt('bookmarks', 'Закладки (ищутся через адресную строку)'),
      opt('searches', 'Поисковые запросы'),
      opt('essentials', 'Панель закладок → Закреплённые сайты')),
    h('div', { style: 'display: flex; justify-content: flex-end; margin-top: 14px' }, button),
    result,
  ];
}

// ---------- Горячие клавиши ----------

const HOTKEYS = [
  ['Вкладки', [
    ['Ctrl+T', 'Новая вкладка'], ['Ctrl+Shift+N', 'Приватная вкладка'], ['Ctrl+W, Ctrl+F4', 'Закрыть вкладку'],
    ['Ctrl+Shift+T', 'Вернуть закрытую вкладку'], ['Ctrl+Tab, Ctrl+PgDn', 'Следующая вкладка'], ['Ctrl+Shift+Tab, Ctrl+PgUp', 'Предыдущая вкладка'],
    ['Ctrl+1…8', 'Вкладка по номеру'], ['Ctrl+9', 'Последняя вкладка'], ['Ctrl+Shift+PgUp/PgDn', 'Сдвинуть вкладку'],
    ['Ctrl+Alt+1…9', 'Пространство по номеру'],
  ]],
  ['Адрес и поиск', [
    ['Ctrl+L, Alt+D, F6', 'Адресная строка'], ['Ctrl+K, Ctrl+E', 'Поиск'], ['Alt+Enter', 'Открыть в новой вкладке'],
    ['Ctrl+Enter', 'Дописать www. и .com'], ['Ctrl+F', 'Найти на странице'], ['F3, Ctrl+G', 'Следующее совпадение'],
    ['Shift+F3, Ctrl+Shift+G', 'Предыдущее совпадение'], ['Shift+Delete', 'Убрать подсказку'],
  ]],
  ['Навигация', [
    ['Alt+←, Alt+→', 'Назад / вперёд'], ['F5, Ctrl+R', 'Обновить'], ['Ctrl+F5, Shift+F5, Ctrl+Shift+R', 'Обновить без кэша'],
    ['Esc', 'Остановить загрузку'], ['Alt+Home', 'Новая вкладка в этой вкладке'],
  ]],
  ['Страница', [
    ['Ctrl+D', 'Закрепить сайт'], ['Ctrl+Shift+C', 'Копировать ссылку'], ['Ctrl+P', 'Печать'], ['Ctrl+O', 'Открыть файл'],
    ['Ctrl+U', 'Исходный код'], ['Ctrl+ +/−/0, Ctrl+колесо', 'Масштаб'], ['F12, Ctrl+Shift+I/J', 'Инструменты разработчика'],
  ]],
  ['Браузер', [
    ['Ctrl+S, Ctrl+Alt+C', 'Скрыть / показать сайдбар'], ['Ctrl+,', 'Настройки'], ['Ctrl+H', 'Недавние страницы'],
    ['Ctrl+J', 'Папка загрузок'], ['Ctrl+Shift+Delete', 'Очистить данные'], ['F11', 'Полный экран'], ['Ctrl+Shift+W', 'Закрыть окно'],
  ]],
];

function renderKeys() {
  return [
    h('h2', {}, 'Горячие клавиши'),
    h('p.lead', {}, 'Как в Chrome, плюс свои для сайдбара и пространств. Боковые кнопки мыши работают как «назад/вперёд».'),
    ...HOTKEYS.flatMap(([group, list]) => [
      h('h3', {}, group),
      h('div.card', {}, list.map(([keys, what]) => h('div.row', {},
        h('div.label', {}, what),
        h('div.kbd', {}, keys.split(', ').map((k) => h('kbd', {}, k)))))),
    ]),
  ];
}

// ---------- каркас ----------

const SECTIONS = { appearance: renderAppearance, search: renderSearch, privacy: renderPrivacy, devices: renderDevices, downloads: renderDownloads, system: renderSystem, import: renderImport, keys: renderKeys };

function movePill() {
  const active = document.querySelector(`nav button[data-section="${section}"]`);
  document.getElementById('pill').style.transform = `translateY(${active.offsetTop}px)`;
}

function render(animate = false) {
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.section === section);
  movePill();
  const scroll = content.scrollTop;
  content.replaceChildren(...SECTIONS[section]().filter(Boolean));
  content.scrollTop = scroll;
  if (animate) {
    content.classList.remove('enter');
    void content.offsetWidth; // перезапуск анимации
    content.classList.add('enter');
    [...content.children].forEach((n, i) => { n.style.animationDelay = `${Math.min(i, 10) * 25}ms`; });
  }
}

for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => {
    if (section === b.dataset.section) return;
    section = b.dataset.section;
    content.scrollTop = 0;
    render(true);
  });
}

function close() {
  document.body.classList.remove('open');
  panel.close();
}

panel.onOpen(async (s) => {
  data = await panel.get();
  document.documentElement.style.setProperty('--ws', data.workspace.theme.colors[0]);
  document.getElementById('version').textContent = `Essential ${data.versions.app}\nChromium ${data.versions.chromium}`;
  section = SECTIONS[s] ? s : 'appearance';
  content.scrollTop = 0;
  render(true);
  document.body.classList.add('open');
});

document.getElementById('x').addEventListener('click', close);
document.getElementById('backdrop').addEventListener('mousedown', close);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
