const stage = document.getElementById('stage');
const dotsEl = document.getElementById('dots');
document.getElementById('noise').style.backgroundImage = GRAIN_URL;

let info = null;
let step = 0;
let current = null;
let theme = null;
let importList = null;

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

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

const tick = () => h('div.tick', { html: CHECK });

// Иконка в плитке: картинка, а если не загрузилась — первая буква
function iconImg(src, letter, extraClass = '') {
  const box = h('div.ico.img' + extraClass);
  const img = h('img', { src, alt: '', draggable: false });
  img.onerror = () => { box.classList.remove('img'); box.textContent = letter; };
  box.append(img);
  return box;
}

const browserIcon = (b) => iconImg(b.iconFile || b.icon || `${new URL(b.site).origin}/favicon.ico`, b.name[0]);

const ENGINE_ICONS = {
  google: 'https://www.google.com/favicon.ico',
  yandex: 'https://ya.ru/favicon.ico',
  duckduckgo: 'https://duckduckgo.com/favicon.ico',
  bing: 'https://www.bing.com/favicon.ico',
};

const SVG = {
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v8"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/></svg>',
};
const eyebrow = (n) => h('div.eyebrow', {}, `Шаг ${n} из 5`);

function setAurora(colors) {
  const [c1, c2, c3] = colors;
  const root = document.documentElement.style;
  root.setProperty('--c1', c1);
  root.setProperty('--c2', c2 || '#1fa2ff');
  root.setProperty('--c3', c3 || c2 || '#ff5fa2');
}

// ---------- шаги ----------

function intro() {
  const word = 'Essential';
  return [
    h('div.logo', {}, h('div.ring'), h('div.ring'), h('img.mark', { src: 'build/icon.png', alt: '' })),
    h('h1.title-anim', { style: 'font-size: 64px' },
      [...word].map((ch, i) => h('span', { style: `animation-delay: ${0.35 + i * 0.07}s` }, ch))),
    h('p.sub.intro-sub', {}, 'Быстрый браузер на Chromium. Настроим его под вас — это займёт минуту.'),
    h('div.actions.intro-actions', {}, h('button.btn.primary', { onclick: () => go(1) }, 'Начать')),
  ];
}

function importStep() {
  const list = h('div.list');
  const next = h('button.btn.primary', { disabled: true }, 'Перенести');
  const note = h('div.note');
  const selected = new Set();

  const fill = () => {
    if (!importList.length) {
      list.replaceChildren(h('div.option', {}, h('div.text', {}, h('div.name', {}, 'Других браузеров не нашли'), h('div.meta', {}, 'Ничего страшного — начнём с чистого листа.'))));
      next.textContent = 'Дальше';
      next.disabled = false;
      next.onclick = () => go(2);
      return;
    }
    for (const b of importList) if (!b.error && (b.history || b.bookmarks)) selected.add(b.id);
    list.replaceChildren(...importList.map((b) => {
      const el = h('button.option' + (selected.has(b.id) ? '.on' : ''), {
        onclick: () => {
          selected.has(b.id) ? selected.delete(b.id) : selected.add(b.id);
          el.classList.toggle('on', selected.has(b.id));
          next.disabled = !selected.size;
        },
      },
      browserIcon(b),
      h('div.text', {}, h('div.name', {}, b.name),
        h('div.meta', {}, b.error || `${b.history} страниц · ${b.bookmarks} закладок · ${b.searches} запросов`)),
      tick());
      return el;
    }));
    next.disabled = !selected.size;
    next.onclick = async () => {
      next.disabled = true;
      next.replaceChildren(h('span.spinner'), 'Переносим…');
      const r = await panel.runImport([...selected], { history: true, bookmarks: true, searches: true, essentials: true });
      const a = r.added;
      next.textContent = 'Готово ✓';
      note.textContent = `Перенесено: ${a.history} страниц, ${a.bookmarks} закладок, ${a.searches} запросов.`;
      setTimeout(() => go(2), 1100);
    };
  };

  if (importList) fill();
  else {
    list.append(h('div.option', {}, h('span.spinner'), 'Ищем браузеры на компьютере…'));
    panel.detectImport().then((l) => { importList = l; fill(); });
  }

  return [
    eyebrow(1),
    h('h1', {}, 'Переедем из старого браузера'),
    h('p.sub', {}, 'История, закладки и поисковые запросы. Пароли останутся там, где были.'),
    list,
    note,
    h('div.actions', {}, h('button.link', { onclick: () => go(2) }, 'Пропустить'), next),
  ];
}

function searchStep() {
  const grid = h('div.grid4');
  const draw = () => grid.replaceChildren(...Object.entries(info.engines).map(([id, name]) => h(
    'button.option' + (info.settings.searchEngine === id ? '.on' : ''),
    { onclick: () => { info.settings.searchEngine = id; panel.set('searchEngine', id); draw(); } },
    iconImg(ENGINE_ICONS[id], name[0], '.light'),
    h('div.name', {}, name),
    tick(),
  )));
  draw();
  return [
    eyebrow(2),
    h('h1', {}, 'Где будем искать?'),
    h('p.sub', {}, 'Поисковик для адресной строки. Поменять можно в любой момент в настройках.'),
    grid,
    h('div.actions', {}, h('button.link', { onclick: () => go(1) }, 'Назад'), h('button.btn.primary', { onclick: () => go(3) }, 'Дальше')),
  ];
}

function themeStep() {
  const preview = h('div.preview', {}, h('div.mock', {}, h('div.side', {}, h('i'), h('i'), h('i'), h('i')), h('div.page')));
  const swatches = h('div.swatches');
  const seg = h('div.seg');
  const same = (a, b) => a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i].toLowerCase());

  const apply = () => {
    preview.style.background = themeBackground(theme);
    preview.classList.toggle('light', theme.mode === 'light');
    setAurora(theme.colors);
    panel.setTheme(theme);
    swatches.replaceChildren(...info.presets.map((colors) => h('button.swatch' + (same(colors, theme.colors) ? '.on' : ''), {
      style: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1] || colors[0]}${colors[2] ? ', ' + colors[2] : ''})`,
      onclick: () => { theme.colors = [...colors]; apply(); },
    })));
    seg.replaceChildren(
      h('button' + (theme.mode === 'dark' ? '.on' : ''), { onclick: () => { theme.mode = 'dark'; apply(); } }, '🌙 Тёмная'),
      h('button' + (theme.mode === 'light' ? '.on' : ''), { onclick: () => { theme.mode = 'light'; apply(); } }, '☀️ Светлая'));
  };
  apply();

  return [
    eyebrow(3),
    h('h1', {}, 'Выберите настроение'),
    h('p.sub', {}, 'Цвет пространства. Потом можно собрать свой градиент из четырёх цветов.'),
    preview,
    h('div', { style: 'width: 100%; display: flex; flex-direction: column; align-items: center; gap: 12px' }, swatches, seg),
    h('div.actions', {}, h('button.link', { onclick: () => go(2) }, 'Назад'), h('button.btn.primary', { onclick: () => go(4) }, 'Дальше')),
  ];
}

// Ctrl+T: страница новой вкладки (часы, поиск, плитки) или всплывающая строка поиска поверх, как в Arc
function newTabStep() {
  const grid = h('div.nt-grid');
  const card = (id, title, hint, mock) => h('button.option.nt' + (info.settings.newTabStyle === id ? '.on' : ''), {
    onclick: () => { info.settings.newTabStyle = id; panel.set('newTabStyle', id); draw(); },
  }, h('div.nt-mock', { html: mock }), h('div.name', {}, title), h('div.meta', {}, hint), tick());
  const draw = () => grid.replaceChildren(
    card('page', '1 · Страница', 'Часы, поиск и закреплённые сайты',
      '<div class="m-clock">00:16</div><div class="m-sub">Доброй ночи · понедельник</div><div class="m-bar"></div><div class="m-tiles"><i></i><i></i><i></i><i></i><i></i></div>'),
    card('spotlight', '2 · Строка поиска', 'Всплывает поверх, сразу с недавними запросами',
      '<div class="m-pop"><div class="m-bar"></div><div class="m-row on"></div><div class="m-row"></div><div class="m-row"></div><div class="m-row short"></div></div>'));
  draw();
  return [
    eyebrow(4),
    h('h1', {}, 'Как открывать новую вкладку?'),
    h('p.sub', {}, 'Что появится по Ctrl+T и кнопке «+». Поменять можно в настройках → Внешний вид.'),
    grid,
    h('div.actions', {}, h('button.link', { onclick: () => go(3) }, 'Назад'), h('button.btn.primary', { onclick: () => go(5) }, 'Дальше')),
  ];
}

function systemStep() {
  const note = h('div.note');
  const def = h('button.option' + (info.system.isDefault ? '.on' : ''), {
    onclick: async () => {
      await system.makeDefault();
      def.classList.add('on');
      note.textContent = 'Открылись параметры Windows — выберите там Essential для веб-браузера.';
    },
  }, h('div.ico.glyph', { html: SVG.globe }),
  h('div.text', {}, h('div.name', {}, 'Браузер по умолчанию'), h('div.meta', {}, 'Ссылки из Telegram, Discord и других программ будут открываться в Essential')),
  tick());

  let autostart = info.system.autostart;
  const auto = h('button.option' + (autostart ? '.on' : ''), {
    onclick: () => {
      autostart = !autostart;
      system.setAutostart(autostart);
      auto.classList.toggle('on', autostart);
    },
  }, h('div.ico.glyph', { html: SVG.power }),
  h('div.text', {}, h('div.name', {}, 'Запускать вместе с Windows'), h('div.meta', {}, 'Essential будет готов сразу после входа в систему')),
  tick());

  return [
    eyebrow(5),
    h('h1', {}, 'Сделать Essential главным?'),
    h('p.sub', {}, 'Можно пропустить — оба пункта есть в настройках.'),
    h('div.list', {}, def, auto),
    note,
    h('div.actions', {}, h('button.link', { onclick: () => go(4) }, 'Назад'), h('button.btn.primary', { onclick: () => go(6) }, 'Дальше')),
  ];
}

function doneStep() {
  setTimeout(confetti, 350);
  return [
    h('div', { html: '<svg class="done-mark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><circle class="arc" cx="50" cy="50" r="46" transform="rotate(-90 50 50)"/><path d="M31 51l13 13 26-28"/></svg>' }),
    h('h1', {}, 'Всё готово'),
    h('p.sub', {}, 'Пара сочетаний, которые пригодятся:'),
    h('div.keys', {},
      h('div.key', {}, h('b', {}, 'Ctrl + T'), 'новая вкладка'),
      h('div.key', {}, h('b', {}, 'Ctrl + S'), 'скрыть панель'),
      h('div.key', {}, h('b', {}, 'Ctrl + ,'), 'настройки')),
    h('div.actions', {}, h('button.btn.primary', { onclick: finish }, 'Поехали')),
  ];
}

function confetti() {
  const box = h('div.confetti');
  const colors = [...theme.colors, '#ffffff', '#ffd166'];
  for (let i = 0; i < 70; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 160 + Math.random() * 320;
    box.append(h('i', {
      style: `background: ${colors[i % colors.length]}; --x: ${Math.cos(angle) * dist}px; --y: ${Math.sin(angle) * dist + 120}px; --r: ${Math.random() * 720 - 360}deg; animation-delay: ${Math.random() * 0.15}s`,
    }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2000);
}

function finish() {
  document.body.classList.add('out');
  setTimeout(() => system.finish(), 650);
}

// ---------- переходы ----------

const STEPS = [intro, importStep, searchStep, themeStep, newTabStep, systemStep, doneStep];

function go(n) {
  const back = n < step;
  if (current) {
    const old = current;
    old.classList.remove('enter', 'back');
    old.classList.add('leave');
    if (back) old.classList.add('back');
    setTimeout(() => old.remove(), 450);
  }
  step = n;
  current = h('section.step.enter' + (back ? '.back' : ''), {}, ...STEPS[n]());
  stage.append(current);
  document.body.classList.toggle('intro', n === 0);
  dotsEl.replaceChildren(...[1, 2, 3, 4, 5, 6].map((i) => h('i' + (i === n ? '.on' : ''))));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && step === 0) go(1);
});

system.onOnboarding(async () => {
  info = await system.info();
  theme = JSON.parse(JSON.stringify(info.workspace.theme));
  setAurora(theme.colors);
  document.body.classList.remove('out');
  stage.replaceChildren();
  current = null;
  step = 0;
  go(0);
});
