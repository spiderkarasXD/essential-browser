// Автозаполнение форм, как в Chrome: запоминаем, что вводишь в поля (почта, имя, телефон, адрес, логин),
// и подсказываем это в похожих полях на любых сайтах. Пароли, карты и одноразовые коды не запоминаются.
// Работает в изолированном мире: скрипты сайта не видят ни список, ни сохранённые значения.
const { ipcRenderer } = require('electron');

const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', '']);
const SECRET = /pass|pwd|card|cc-?(num|csc|exp)|cvv|cvc|csc|otp|one-?time|pin\b|code|captcha|secret|token|ssn|iban/i;
// autocomplete-токены Chrome, которые объединяем между сайтами
const KNOWN = new Set(['name', 'given-name', 'family-name', 'additional-name', 'nickname', 'username', 'email', 'tel', 'tel-national',
  'organization', 'organization-title', 'street-address', 'address-line1', 'address-line2', 'address-level1', 'address-level2',
  'postal-code', 'country', 'country-name', 'bday', 'url']);
// догадки по name/id/placeholder, если сайт не указал autocomplete
const GUESS = [
  [/e-?mail|почт/i, 'email'], [/phone|tel|телеф|мобил/i, 'tel'], [/login|user(name)?|логин|ник/i, 'username'],
  [/first.?name|given|имя/i, 'given-name'], [/last.?name|surname|family|фамил/i, 'family-name'], [/full.?name|^name$|фио/i, 'name'],
  [/zip|postal|индекс/i, 'postal-code'], [/city|town|город/i, 'address-level2'], [/street|address|адрес|улиц/i, 'address-line1'],
  [/company|organi[sz]ation|компан|организац/i, 'organization'],
];

function kindOf(input) {
  if (!(input instanceof HTMLInputElement) || input.readOnly || input.disabled) return null;
  const type = (input.getAttribute('type') || '').toLowerCase();
  if (!TEXT_TYPES.has(type)) return null;
  const ac = (input.getAttribute('autocomplete') || '').toLowerCase().trim();
  if (ac === 'off' || ac === 'new-password' || ac === 'current-password' || ac.startsWith('cc-') || ac === 'one-time-code') return null;
  const hints = [input.name, input.id, input.getAttribute('placeholder'), input.getAttribute('aria-label')].filter(Boolean).join(' ');
  if (SECRET.test(hints)) return null;
  const token = ac.split(/\s+/).pop();
  if (KNOWN.has(token)) return token;
  if (type === 'email') return 'email';
  if (type === 'tel') return 'tel';
  if (type === 'search') return null; // поиск по сайту — не данные пользователя
  for (const [re, kind] of GUESS) if (re.test(hints)) return kind;
  return input.name ? 'field:' + input.name.toLowerCase().slice(0, 40) : null;
}

// только сайты: свои страницы браузера и расширения не трогаем
if (/^https?:$/.test(location.protocol)) {
// ---------- запоминание ----------

const remember = (input) => {
  const kind = kindOf(input);
  if (kind && input.value.trim()) ipcRenderer.send('autofill:save', kind, input.value);
};
document.addEventListener('change', (e) => remember(e.target), true);
document.addEventListener('submit', (e) => {
  for (const el of e.target.querySelectorAll?.('input') || []) remember(el);
}, true);

// ---------- выпадающий список ----------

let host = null;
let box = null;
let field = null;
let items = [];
let active = -1;

function ensureBox() {
  if (host?.isConnected) return;
  host = document.createElement('essential-autofill');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .box { display: none; min-width: 220px; max-width: 420px; padding: 5px; border-radius: 12px; background: rgba(30, 30, 37, .98);
      box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08); font: 13px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      color: #ecebf2; animation: in .16s cubic-bezier(.22,1,.36,1); }
    .box.open { display: block; }
    @keyframes in { from { opacity: 0; transform: translateY(-4px); } }
    .it { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; cursor: default; }
    .it.on { background: rgba(47, 123, 255, .28); }
    .v { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .x { opacity: 0; width: 18px; height: 18px; border: 0; border-radius: 5px; background: none; color: inherit; cursor: pointer; font-size: 14px; line-height: 1; }
    .it:hover .x, .it.on .x { opacity: .6; }
    .x:hover { opacity: 1 !important; background: rgba(255,255,255,.12); }
    .foot { padding: 5px 9px 3px; font-size: 11px; color: rgba(236,235,242,.45); }
  </style><div class="box"></div>`;
  box = root.querySelector('.box');
  box.addEventListener('mousedown', (e) => e.preventDefault()); // не забираем фокус у поля
  document.documentElement.append(host);
}

function hide() {
  box?.classList.remove('open');
  items = [];
  active = -1;
}

function fill(value) {
  if (!field) return;
  // через встроенный сеттер, чтобы React/Vue заметили изменение
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  hide();
}

function render() {
  box.replaceChildren(...items.map((v, i) => {
    const it = document.createElement('div');
    it.className = 'it' + (i === active ? ' on' : '');
    const t = document.createElement('span');
    t.className = 'v';
    t.textContent = v;
    const x = document.createElement('button');
    x.className = 'x';
    x.title = 'Удалить из автозаполнения';
    x.textContent = '×';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      ipcRenderer.send('autofill:remove', kindOf(field), v);
      items = items.filter((y) => y !== v);
      active = Math.min(active, items.length - 1);
      items.length ? render() : hide();
    });
    it.append(t, x);
    it.addEventListener('mouseenter', () => { active = i; render(); });
    it.addEventListener('click', () => fill(v));
    return it;
  }));
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.textContent = 'Автозаполнение Essential';
  box.append(foot);
}

function place() {
  const r = field.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > innerHeight) return hide();
  const below = innerHeight - r.bottom > 220 || r.top < 220;
  host.style.left = Math.max(4, Math.min(innerWidth - 230, r.left)) + 'px';
  host.style.top = (below ? r.bottom + 4 : Math.max(4, r.top - 4 - box.offsetHeight)) + 'px';
  box.style.minWidth = Math.max(220, Math.min(420, r.width)) + 'px';
}

let seq = 0;
async function suggest(input) {
  const kind = kindOf(input);
  if (!kind) return hide();
  const n = ++seq;
  const list = await ipcRenderer.invoke('autofill:query', kind, input.value);
  if (n !== seq || document.activeElement !== input) return;
  field = input;
  items = list;
  active = -1;
  if (!items.length) return hide();
  ensureBox();
  render();
  box.classList.add('open');
  place();
}

document.addEventListener('focusin', (e) => { if (e.target instanceof HTMLInputElement) suggest(e.target); }, true);
document.addEventListener('input', (e) => { if (e.isTrusted && e.target instanceof HTMLInputElement) suggest(e.target); }, true);
document.addEventListener('focusout', () => setTimeout(() => { if (document.activeElement !== field) hide(); }, 120), true);
document.addEventListener('scroll', () => { if (items.length && field) place(); }, true);
addEventListener('resize', hide);
document.addEventListener('keydown', (e) => {
  if (!items.length || e.target !== field) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    // -1 — «ничего не выбрано», стрелки ходят по кругу через него
    const n = items.length + 1;
    active = ((active + 1 + (e.key === 'ArrowDown' ? 1 : -1) + n) % n) - 1;
    render();
  } else if (e.key === 'Enter' && active >= 0) {
    e.preventDefault();
    e.stopPropagation();
    fill(items[active]);
  } else if (e.key === 'Escape') {
    hide();
  }
}, true);
}
