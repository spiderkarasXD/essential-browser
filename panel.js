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

const CLOCK_STYLES = [['thin', 'Тонкий'], ['bold', 'Жирный'], ['stacked', 'Столбиком'], ['outline', 'Контур'], ['mono', 'Моно'], ['analog', 'Стрелки'], ['hidden', 'Скрыты']];

// Два вида новой вкладки с мини-превью: страница с часами и плитками или всплывающая строка поиска
function newTabChoice(value, onpick) {
  const card = (id, title, hint, mock) => h('button.nt' + (value === id ? '.on' : ''), { onclick: () => onpick(id) },
    h('div.nt-mock', { html: mock }), h('div.nt-title', {}, title), h('div.nt-hint', {}, hint));
  return h('div.nt-grid', {},
    card('page', 'Страница', 'Часы, поиск и закреплённые сайты',
      '<div class="m-clock">00:16</div><div class="m-bar"></div><div class="m-tiles"><i></i><i></i><i></i><i></i></div>'),
    card('spotlight', 'Строка поиска', 'Всплывает поверх, как в Arc',
      '<div class="m-pop"><div class="m-bar"></div><div class="m-row"></div><div class="m-row"></div><div class="m-row short"></div></div>'));
}

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
    t.colors.length < 4 && h('button.add-color', { title: 'Добавить цвет', onclick: () => update({ colors: [...t.colors, t.colors[t.colors.length - 1]] }) }, '+'));

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
    h('h3', {}, 'Новая вкладка (Ctrl+T)'),
    newTabChoice(data.settings.newTabStyle, (v) => { setSetting('newTabStyle', v); render(); }),
    h('h3', {}, 'Часы на новой вкладке'),
    h('div.card', {},
      h('div.row', {}, h('div.label', {}, 'Стиль', h('div.hint', {}, 'Ещё больше — щелчком по часам на новой вкладке')),
        h('select', { onchange: (e) => setSetting('clock', { ...data.settings.clock, style: e.target.value }) },
          CLOCK_STYLES.map(([v, l]) => h('option', { value: v, selected: data.settings.clock.style === v }, l)))),
      h('div.row', {}, h('div.label', {}, 'Цвет'),
        h('select', { onchange: (e) => setSetting('clock', { ...data.settings.clock, color: e.target.value }) },
          [['white', 'Белый'], ['accent', 'Цвет темы'], ['gradient', 'Градиент']].map(([v, l]) => h('option', { value: v, selected: data.settings.clock.color === v }, l)))),
      toggleRow('Секунды', null, data.settings.clock.seconds, (v) => setSetting('clock', { ...data.settings.clock, seconds: v })),
      toggleRow('12-часовой формат', null, data.settings.clock.h12, (v) => setSetting('clock', { ...data.settings.clock, h12: v })),
      toggleRow('Приветствие и дата', null, data.settings.clock.date, (v) => setSetting('clock', { ...data.settings.clock, date: v }))),
    h('h3', {}, 'Готовые градиенты'),
    presets,
    h('h3', {}, 'Свои цвета (до четырёх)'),
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
    { key: 'autofill', title: 'Автозаполнение', meta: plural(c.autofill, 'значение', 'значения', 'значений'), icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h6M7 14h3M16 13l1.5 1.5L20 12"/></svg>' },
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
      toggleRow('Отправлять «Не отслеживать»', 'Заголовки DNT и Global Privacy Control', s.doNotTrack, (v) => setSetting('doNotTrack', v)),
      toggleRow('Предупреждать о сайтах без HTTPS', 'Перед сайтом без сертификата спросит, точно ли туда идти. Роутеры и домашняя сеть — без вопросов', s.httpsWarning, (v) => setSetting('httpsWarning', v)),
      s.httpAllowed.length > 0 && h('div.row', {},
        h('div.label', {}, 'Разрешённые сайты без HTTPS', h('div.hint', {}, s.httpAllowed.slice(-4).join(', ') + (s.httpAllowed.length > 4 ? ` и ещё ${s.httpAllowed.length - 4}` : ''))),
        h('button.btn', { onclick: () => { setSetting('httpAllowed', []); render(); } }, 'Сбросить'))),
    h('h3', {}, 'Автозаполнение'),
    h('div.card', {},
      toggleRow('Запоминать данные форм', 'Почта, имя, телефон, адрес — подсказываются в полях на сайтах, как в Chrome. Пароли и карты не сохраняются', s.autofill, (v) => setSetting('autofill', v)),
      h('div.row', {}, h('div.label', {}, 'Сохранено', h('div.hint', {}, plural(c.autofill, 'значение', 'значения', 'значений'))),
        h('button.btn', { onclick: async () => { await panel.clear({ autofill: true }); data.counts.autofill = 0; render(); } }, 'Очистить'))),
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

// ---------- Тревога (оповещения о беспилотной опасности) ----------

let alertInfo = null;
let alertRegions = null; // { ok, regions } | { ok: false, error }
alerts.onState((s) => { if (alertInfo) alertInfo.state = s; if (section === 'alerts') render(); });

function alertStatus(a) {
  const s = a.state;
  const hhmm = (sec) => new Date(sec * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (!a.available) return ['Источник данных не подключён — оповещения не работают.', ''];
  if (a.country !== 'ru') return ['Выключено.', ''];
  if (!a.region) return ['Выберите область — тогда начнём следить.', ''];
  switch (s.status) {
    case 'danger': return [`⚠ В области «${a.regionName}» объявлена опасность.`, 'bad'];
    case 'ok': return [`Слежу за областью «${a.regionName}». Данные от ${hhmm(s.updated)}. Сообщений об опасности нет — это не гарантия безопасности.`, 'ok'];
    case 'stale': return ['Источник давно не обновлялся. Сейчас на сигнал полагаться нельзя.', 'warn'];
    case 'error': return [`Нет данных от источника: ${s.error}. Сейчас на сигнал полагаться нельзя.`, 'warn'];
    case 'checking': return ['Проверяем источник…', ''];
    default: return ['Выключено.', ''];
  }
}

function renderAlerts() {
  const a = alertInfo;
  if (!a) return [h('h2', {}, 'Тревога'), h('div.card', {}, h('div.row', {}, h('span.spinner'), 'Загружаем…'))];
  const [text, tone] = alertStatus(a);
  const save = (patch) => { Object.assign(a, patch); alerts.set(patch); render(); };

  const pickers = [];
  if (a.country === 'ru') { // список встроенный — выбрать область можно и до подключения источника
    if (!alertRegions) {
      alerts.regions().then((r) => { alertRegions = r; if (section === 'alerts') render(); });
      pickers.push(h('div.card', {}, h('div.row', {}, h('span.spinner'), 'Загружаем список областей…')));
    } else if (!alertRegions.ok) {
      pickers.push(h('div.card', {}, h('div.row', {}, h('div.label', {}, 'Не удалось загрузить список областей', h('div.hint.err', {}, alertRegions.error)),
        h('button.btn', { onclick: () => { alertRegions = null; render(); } }, 'Повторить'))));
    } else {
      pickers.push(h('h3', {}, 'Ваша область или край'), h('div.card', { style: 'padding: 12px' }, regionPicker(alertRegions.regions, a.region, (r) => {
        a.region = r.id; a.regionName = r.name;
        alerts.set({ region: r.id, regionName: r.name });
        render();
      })));
    }
  }

  return [
    h('h2', {}, 'Тревога'),
    h('p.lead', {}, 'Сигнал и сообщение, если в вашей области объявлена беспилотная опасность.'),
    h('div.card.why-card', {}, ALERTS_WHY.map(([title, body]) => h('div.why-row', {}, h('b', {}, title), h('span', {}, body)))),
    h('div.card', {},
      h('div.row', {}, h('div.label', {}, 'Статус', h('div.hint' + (tone === 'bad' || tone === 'warn' ? '.err' : ''), {}, text))),
      h('div.row', {}, h('div.label', {}, 'Вы находитесь в России?'),
        h('div.seg', {},
          h('button' + (a.country === 'ru' ? '.on' : ''), { onclick: () => save({ country: 'ru' }) }, 'Да'),
          h('button' + (a.country === 'other' ? '.on' : ''), { onclick: () => save(a.country === 'other' ? {} : { country: 'other', region: '', regionName: '' }) }, 'Нет'))),
      toggleRow('Звуковой сигнал', 'Короткая сирена вместе с сообщением', a.sound, (v) => { a.sound = v; alerts.set({ sound: v }); }),
      h('div.row', {}, h('div.label', {}, 'Проверить сигнал', h('div.hint', {}, 'Покажет сообщение и сыграет сирену — это только проверка')),
        h('button.btn', { onclick: () => alerts.test() }, 'Проверить'))),
    ...pickers,
    h('h3', {}, 'Источник данных'),
    h('div.card', {},
      h('div.row', {}, h('div.label', {}, 'Адрес источника', h('div.hint', {}, 'JSON со списком областей и их статусом (https). Пусто — источник по умолчанию')),
        h('input', { type: 'text', value: a.source, placeholder: 'https://…', style: 'width: 260px',
          onchange: (e) => { const v = e.target.value.trim(); alertRegions = null; save({ source: v }); } }))),
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

// Обновления с GitHub: статус, «проверить», «перезапустить и обновить»
let update = null;
panel.onUpdate((u) => { update = u; if (section === 'system') render(); });

function renderUpdates(s) {
  const u = update || { status: 'idle', current: data.versions.app };
  const text = {
    idle: `Essential ${u.current}`,
    checking: 'Проверяем…',
    downloading: `Скачиваем Essential ${u.version}… ${u.progress || 0}%`,
    ready: `Essential ${u.version} скачан — установится при перезапуске`,
    latest: `Essential ${u.current} — последняя версия`,
    available: `Вышел Essential ${u.version}. Portable-версия обновляется вручную`,
    error: `Не удалось проверить: ${u.error || 'нет связи с GitHub'}`,
  }[u.status] || `Essential ${u.current}`;
  const action = u.status === 'ready' ? h('button.btn.primary', { onclick: () => panel.installUpdate() }, 'Перезапустить и обновить')
    : u.status === 'available' ? h('button.btn.primary', { onclick: () => panel.installUpdate() }, 'Скачать')
      : h('button.btn', { disabled: u.status === 'checking' || u.status === 'downloading', onclick: () => panel.checkUpdate() }, 'Проверить');
  return h('div.card', {},
    h('div.row', {}, h('div.label', {}, 'Версия', h('div.hint', {}, text)), action),
    toggleRow('Обновлять автоматически', 'Новая версия скачивается в фоне и ставится при перезапуске. Вкладки и настройки сохраняются', s.autoUpdate, (v) => setSetting('autoUpdate', v)));
}

// Как chrome://settings/fonts и /languages: шрифты, размеры, масштаб страниц и язык сайтов
const ZOOMS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
const LANGS = [
  ['ru-RU,ru,en-US,en', 'Русский, затем английский'],
  ['en-US,en,ru-RU,ru', 'Английский, затем русский'],
  ['ru-RU,ru', 'Только русский'],
  ['en-US,en', 'Только английский'],
  ['uk-UA,uk,ru-RU,ru,en-US,en', 'Українська, русский, английский'],
  ['be-BY,be,ru-RU,ru,en-US,en', 'Беларуская, русский, английский'],
  ['kk-KZ,kk,ru-RU,ru,en-US,en', 'Қазақ тілі, русский, английский'],
  ['de-DE,de,en-US,en', 'Немецкий, английский'],
];

function renderFonts(s) {
  const fontSelect = (key) => h('select', { style: 'max-width: 240px', onchange: (e) => setSetting(key, e.target.value) },
    h('option', { value: '', selected: !s[key] }, 'По умолчанию'),
    (data.fonts || []).map((f) => h('option', { value: f, selected: s[key] === f, style: `font-family: "${f}"` }, f)));
  const size = (key, label, min, max, hint) => h('div.row', {},
    h('div.label', { style: 'flex: 0 0 200px' }, label, hint && h('div.hint', {}, hint)),
    h('div.range-row', { style: 'flex: 1' },
      h('input', { type: 'range', min, max, value: s[key], oninput: (e) => { e.target.nextSibling.textContent = e.target.value === '0' ? 'нет' : e.target.value + ' px'; }, onchange: (e) => setSetting(key, +e.target.value) }),
      h('span.val', {}, s[key] === 0 ? 'нет' : s[key] + ' px')));
  const sample = h('div.font-sample', { style: `font-size: ${s.fontSize}px; font-family: ${s.fontStandard ? `"${s.fontStandard}"` : 'serif'}` },
    'Съешь же ещё этих мягких французских булок, да выпей чаю. The quick brown fox.');
  return [
    h('h3', {}, 'Шрифты и масштаб'),
    h('p.hint', { style: 'margin: -4px 2px 10px' }, 'Как в chrome://settings/fonts. Применяется к новым вкладкам и после перезагрузки страницы.'),
    h('div.card', {},
      h('div.row', {}, h('div.label', {}, 'Масштаб страниц'),
        h('select', { onchange: (e) => setSetting('defaultZoom', +e.target.value) }, ZOOMS.map((z) => h('option', { value: z, selected: s.defaultZoom === z }, z + '%')))),
      size('fontSize', 'Размер шрифта', 9, 32),
      size('monoFontSize', 'Моноширинный шрифт', 9, 32),
      size('minFontSize', 'Минимальный размер', 0, 24, 'Мельче сайты писать не смогут'),
      h('div.row', {}, h('div.label', {}, 'Стандартный шрифт'), fontSelect('fontStandard')),
      h('div.row', {}, h('div.label', {}, 'С засечками (Serif)'), fontSelect('fontSerif')),
      h('div.row', {}, h('div.label', {}, 'Без засечек (Sans-serif)'), fontSelect('fontSans')),
      h('div.row', {}, h('div.label', {}, 'Моноширинный'), fontSelect('fontMono')),
      h('div.row', { style: 'display: block' }, sample)),
    h('h3', {}, 'Языки'),
    h('div.card', {},
      h('div.row', {}, h('div.label', {}, 'Язык сайтов', h('div.hint', {}, 'На каком языке сайты показывают себя (Accept-Language)')),
        h('select', { onchange: (e) => setSetting('languages', e.target.value) },
          (LANGS.some(([v]) => v === s.languages) ? LANGS : [[s.languages, s.languages], ...LANGS]).map(([v, l]) => h('option', { value: v, selected: s.languages === v }, l))))),
  ];
}

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
    ...renderFonts(s),
    h('h3', {}, 'Обновления'),
    renderUpdates(s),
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
    ['Ctrl+J', 'Загрузки'], ['Ctrl+Shift+Delete', 'Очистить данные'], ['F11', 'Полный экран'], ['Ctrl+Shift+W', 'Закрыть окно'],
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

const SECTIONS = { appearance: renderAppearance, search: renderSearch, privacy: renderPrivacy, devices: renderDevices, alerts: renderAlerts, downloads: renderDownloads, system: renderSystem, import: renderImport, keys: renderKeys };

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
  update = await panel.updateState();
  alertInfo = await alerts.info();
  alertRegions = null;
  // раздел «Тревога» виден, только когда подключён источник данных; по адресу essential://settings/alerts открывается всегда
  document.querySelector('nav button[data-section="alerts"]').hidden = !alertInfo.available && s !== 'alerts';
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
