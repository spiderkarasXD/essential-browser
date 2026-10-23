const q = document.getElementById('q');
const list = document.getElementById('list');
const modeEl = document.getElementById('mode');

let mode = 'new';
let items = [];
let sel = 0;
let reqId = 0;

const ICON = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  url: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  query: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>',
  page: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
};
const GROUP = { query: 'Недавние запросы', tab: 'Открытые вкладки', essential: 'Закреплённые', bookmark: 'Закладки', history: 'История' };
const ACTION = { search: 'Искать', url: 'Открыть', query: 'Искать', tab: 'Перейти', essential: 'Открыть', bookmark: 'Открыть', history: 'Открыть' };

const originOf = (url) => { try { return new URL(url).origin; } catch { return ''; } };
const prettyUrl = (url) => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? decodeURI(u.pathname) : '');
  } catch {
    return url;
  }
};

function iconFor(it) {
  const ico = document.createElement('div');
  ico.className = 'ico';
  if (ICON[it.type]) {
    ico.innerHTML = ICON[it.type];
  } else {
    const img = new Image();
    img.src = originOf(it.url) + '/favicon.ico';
    img.onerror = () => { ico.innerHTML = ICON.page; };
    ico.append(img);
  }
  return ico;
}

function render() {
  const nodes = [];
  let group = null;
  items.forEach((it, i) => {
    if (GROUP[it.type] && it.type !== group) {
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = GROUP[it.type];
      nodes.push(h);
    }
    group = it.type;

    const el = document.createElement('div');
    el.className = 'item' + (i === sel ? ' sel' : '');

    const text = document.createElement('div');
    text.className = 'text';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.type === 'url' ? prettyUrl(it.url) : it.title;
    text.append(title);
    if (['tab', 'essential', 'bookmark', 'history'].includes(it.type)) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = (it.type === 'tab' ? it.ws + '  ' : '') + prettyUrl(it.url);
      text.append(sub);
    }

    const action = document.createElement('span');
    action.className = 'action';
    action.textContent = it.type === 'search' ? `Искать в ${it.engine}` : ACTION[it.type];

    el.append(iconFor(it), text, action);
    el.addEventListener('mousemove', () => {
      if (sel === i) return;
      sel = i;
      for (const n of list.querySelectorAll('.item')) n.classList.toggle('sel', n === el);
    });
    el.addEventListener('mousedown', (e) => { e.preventDefault(); choose(it); });
    nodes.push(el);
  });
  list.replaceChildren(...nodes);
  if (list.classList.contains('fresh')) nodes.forEach((n, i) => { n.style.animationDelay = `${i * 22}ms`; });
  list.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
}

async function update() {
  const id = ++reqId;
  const res = await spotlight.suggest(q.value);
  if (id !== reqId) return;
  items = res;
  sel = 0;
  render();
}

function choose(it, newTab = false) {
  close();
  if (it) spotlight.go({ url: it.url, tabId: newTab ? null : it.tabId, mode, newTab });
  else spotlight.go({ text: q.value, mode, newTab });
}

function close() {
  document.body.classList.remove('open');
}

spotlight.onOpen((data) => {
  mode = data.mode;
  if (data.color) document.documentElement.style.setProperty('--ws', data.color);
  modeEl.textContent = mode === 'new' ? 'Новая вкладка' : '';
  q.value = data.url || '';
  document.body.classList.add('open');
  list.classList.add('fresh');
  setTimeout(() => list.classList.remove('fresh'), 450);
  q.focus();
  q.select();
  update();
});

q.addEventListener('input', update);
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (!q.value.trim() && !items.length) return;
    // Ctrl+Enter дописывает www. и .com, как в Chrome: «youtube» → www.youtube.com
    if ((e.ctrlKey || e.metaKey) && /^[\w-]+$/.test(q.value.trim())) {
      return choose({ url: `https://www.${q.value.trim()}.com/` }, e.altKey);
    }
    choose(items[sel], e.altKey); // Alt+Enter — в новой вкладке
  } else if (e.key === 'Delete' && e.shiftKey) {
    // Shift+Delete — убрать запрос или страницу из подсказок
    const it = items[sel];
    if (it && (it.type === 'query' || it.type === 'history')) {
      e.preventDefault();
      spotlight.forget(it);
      update();
    }
  } else if (e.key === 'Escape') {
    close();
    spotlight.close();
  }
});

document.getElementById('backdrop').addEventListener('mousedown', () => {
  close();
  spotlight.close();
});
window.addEventListener('blur', () => {
  if (document.body.classList.contains('open')) {
    close();
    spotlight.close();
  }
});
