const list = document.getElementById('list');
const pop = document.getElementById('pop');

const ICON = {
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  resume: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>',
  cancel: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  show: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  empty: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>',
};

const units = ['Б', 'КБ', 'МБ', 'ГБ'];
function size(n) {
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
function eta(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.ceil(sec)} с`;
  if (sec < 3600) return `${Math.ceil(sec / 60)} мин`;
  return `${(sec / 3600).toFixed(1)} ч`;
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function status(d) {
  const of = d.total > 0 ? `${size(d.received)} из ${size(d.total)}` : size(d.received);
  switch (d.state) {
    case 'progressing': {
      const left = d.total > 0 && d.speed > 0 ? eta((d.total - d.received) / d.speed) : '';
      return [of, d.speed > 0 ? `${size(d.speed)}/с` : '', left && `осталось ${left}`].filter(Boolean).join(' · ');
    }
    case 'paused': return `Пауза · ${of}`;
    case 'completed': return [size(d.total || d.received), host(d.url)].filter(Boolean).join(' · ');
    case 'cancelled': return 'Отменено';
    default: return 'Ошибка загрузки';
  }
}

function button(kind, title, id) {
  const b = document.createElement('button');
  b.innerHTML = ICON[kind];
  b.title = title;
  b.onclick = (e) => { e.stopPropagation(); dl.action(id, kind); };
  return b;
}

function render(items) {
  if (!items.length) {
    list.innerHTML = `<div class="empty">${ICON.empty}Загрузок пока нет</div>`;
    return;
  }
  // переиспользуем строки по id, чтобы прогресс плавно двигался, а не перерисовывался
  const old = new Map([...list.querySelectorAll('.item')].map((el) => [+el.dataset.id, el]));
  list.replaceChildren(...items.map((d) => {
    const active = d.state === 'progressing' || d.state === 'paused';
    let el = old.get(d.id);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = d.id;
      el.innerHTML = '<div class="ico"></div><div class="info"><div class="name"></div><div class="status"></div></div><div class="acts"></div>';
    }
    el.className = 'item' + (active ? ' active' : '') + (d.state === 'paused' ? ' paused' : '')
      + (d.state === 'completed' ? ' done' : '') + (['cancelled', 'interrupted'].includes(d.state) ? ' bad' : '');
    el.querySelector('.name').textContent = d.name;
    el.querySelector('.status').textContent = status(d);
    el.title = d.path || d.name;

    const ico = el.querySelector('.ico');
    const ext = (d.name.split('.').pop() || '').slice(0, 4).toUpperCase();
    const key = `${d.icon ? 'i' : ext}|${active}`;
    if (ico.dataset.key !== key) {
      ico.dataset.key = key;
      ico.innerHTML = d.icon ? `<img src="${d.icon}" alt="">` : ext;
      if (active) ico.insertAdjacentHTML('beforeend', '<svg class="ring" viewBox="0 0 42 42"><circle class="track" cx="21" cy="21" r="19"/><circle class="bar" cx="21" cy="21" r="19" pathLength="100"/></svg>');
    }
    const bar = ico.querySelector('.bar');
    if (bar) bar.style.strokeDashoffset = d.total > 0 ? 100 - (d.received / d.total) * 100 : 75;

    const acts = el.querySelector('.acts');
    acts.replaceChildren(...(
      d.state === 'progressing' ? [button('pause', 'Пауза', d.id), button('cancel', 'Отменить', d.id)]
        : d.state === 'paused' ? [button('resume', 'Продолжить', d.id), button('cancel', 'Отменить', d.id)]
          : d.state === 'completed' ? [button('show', 'Показать в папке', d.id), button('remove', 'Убрать из списка', d.id)]
            : [button('retry', 'Скачать снова', d.id), button('remove', 'Убрать из списка', d.id)]
    ));
    el.onclick = d.state === 'completed' ? () => { close(); dl.action(d.id, 'open'); } : null;
    return el;
  }));
}

function place(x) {
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  pop.style.left = left + 'px';
  pop.style.setProperty('--ox', Math.max(18, Math.min(w - 18, x - left)) + 'px');
}

function close() {
  document.body.classList.remove('open');
  dl.close();
}

dl.onOpen(({ x, list: items, color }) => {
  if (color) document.documentElement.style.setProperty('--ws', color);
  render(items);
  place(x);
  requestAnimationFrame(() => document.body.classList.add('open'));
});
dl.onList(render);

document.getElementById('folder').onclick = () => { document.body.classList.remove('open'); dl.folder(); };
document.getElementById('clear').onclick = () => dl.clear();
document.getElementById('backdrop').addEventListener('mousedown', close);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
window.addEventListener('blur', () => { if (document.body.classList.contains('open')) close(); });
