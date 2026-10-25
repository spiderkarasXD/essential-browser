// Оповещения о беспилотной опасности в выбранной области.
// Браузер раз в минуту скачивает ОБЩИЙ список по всем областям и сам находит в нём вашу — область никуда не отправляется.
// Источник — любой https-адрес с JSON такого вида (локально можно и http://127.0.0.1…):
//   { "updated": 1761400000,                      // когда источник последний раз обновлялся, секунды Unix
//     "regions": [ { "id": "belgorod", "name": "Белгородская область", "drone": true, "since": 1761399000 } ] }
// drone: true — в области сейчас объявлена беспилотная опасность. since — с какого момента (необязательно).
// Список для выбора — встроенный, из subjects-rf.json (89 субъектов). Область из ответа источника ищется
// по id или по названию; лучше всего, если источник пишет названия так же, как в subjects-rf.json.
//
// Это не официальная система оповещения. «Нет опасности» здесь никогда не значит «безопасно»:
// если источник молчит, устарел или недоступен, показываем это явно, а не «всё спокойно».
const { app, net } = require('electron');

// Адрес источника по умолчанию. Пока пуст: оповещения не работают, пока источник не задан
// (в настройках → «Тревога» или здесь). Своего адреса у проекта ещё нет, чужой закрытый адрес сюда не вписываем.
const DEFAULT_SOURCE = '';

// встроенный список субъектов: { id, name, kind, capital }; id — само название, чтобы совпадать с источником по имени
const KINDS = {
  kraja: 'край',
  oblasti: 'область',
  respubliki: 'республика',
  goroda_federalnogo_znachenija: 'город федерального значения',
  avtonomnaja_oblast: 'автономная область',
  avtonomnye_okruga: 'автономный округ',
};
const SUBJECTS = Object.entries(require('./subjects-rf.json').categories)
  .flatMap(([cat, list]) => list.map((x) => {
    const name = typeof x === 'string' ? x : x.name;
    return { id: name, name, kind: KINDS[cat] || '', capital: (typeof x === 'object' && x.capital) || '' };
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

// «Республика Татарстан» = «Татарстан», «Кемеровская область — Кузбасс» = «Кемеровская область (Кузбасс)».
// Только безопасные упрощения: регистр, ё, тире и скобки, слово «республика». Неуверенное совпадение хуже,
// чем никакого: ненайденная область показывается как ошибка, а не как «спокойно».
const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/республика/g, ' ').replace(/[()—–\-.,«»"]/g, ' ').replace(/\s+/g, ' ').trim();
const sameRegion = (feedRegion, mine) => feedRegion.id === mine || norm(feedRegion.name) === norm(mine);

const POLL_MS = 60 * 1000;
const STALE_MS = 10 * 60 * 1000; // данные старше — «источник не обновляется»
const LOST_MS = 10 * 60 * 1000; // столько без свежих данных — предупреждаем, что не стоит полагаться
const TIMEOUT_MS = 10 * 1000;

function validSource(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

// Ответ источника — это чужие данные: принимаем только то, что подходит под схему, остальное отбрасываем
function parse(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.regions) || json.regions.length > 400) throw new Error('неверный формат ответа');
  const updated = Number(json.updated);
  if (!Number.isFinite(updated) || updated <= 0) throw new Error('в ответе нет времени обновления');
  const regions = [];
  for (const r of json.regions) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || r.id.length > 64 || r.name.length > 120) continue;
    regions.push({ id: r.id, name: r.name, drone: r.drone === true, since: Number.isFinite(Number(r.since)) ? Number(r.since) : 0 });
  }
  if (!regions.length) throw new Error('в ответе нет областей');
  return { updated: updated > 1e12 ? Math.round(updated / 1000) : updated, regions };
}

async function fetchFeed(source) {
  const res = await net.fetch(source, {
    headers: { 'User-Agent': `Essential/${app.getVersion()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('источник ответил ' + res.status);
  const text = await res.text();
  if (text.length > 2_000_000) throw new Error('слишком большой ответ');
  return parse(JSON.parse(text));
}

// status: off | checking | ok | danger | stale | error
let cfg = () => ({ source: '', country: '', region: '' });
let emit = () => {};
let timer = null;
let seq = 0;
const state = { status: 'off', danger: false, since: 0, updated: 0, error: null, checkedAt: 0, lastGoodAt: 0, lostNotified: false };

const enabled = () => {
  const c = cfg();
  return c.country === 'ru' && !!c.region && validSource(c.source || DEFAULT_SOURCE);
};
const source = () => cfg().source || DEFAULT_SOURCE;

function set(patch, event) {
  Object.assign(state, patch);
  emit({ ...state }, event);
}

async function poll() {
  const mine = ++seq;
  if (!enabled()) return set({ status: 'off', error: null });
  try {
    const feed = await fetchFeed(source());
    if (mine !== seq) return; // за это время настройки поменялись
    const r = feed.regions.find((x) => sameRegion(x, cfg().region));
    const now = Date.now();
    state.checkedAt = now;
    if (!r) return set({ status: 'error', error: 'выбранной области нет в списке источника' });
    if (now - feed.updated * 1000 > STALE_MS) {
      // источник жив, но данные старые — это не «спокойно»; уже объявленную опасность не снимаем
      return set({ status: state.danger ? 'danger' : 'stale', updated: feed.updated, error: null }, lostEvent(now));
    }
    state.lastGoodAt = now;
    state.lostNotified = false;
    if (r.drone && !state.danger) set({ status: 'danger', danger: true, since: r.since, updated: feed.updated, error: null, regionName: r.name }, 'danger-start');
    else if (!r.drone && state.danger) set({ status: 'ok', danger: false, since: 0, updated: feed.updated, error: null, regionName: r.name }, 'danger-end');
    else set({ status: r.drone ? 'danger' : 'ok', updated: feed.updated, error: null, regionName: r.name });
  } catch (e) {
    if (mine !== seq) return;
    // при ошибке опасность не снимаем: нет связи — не повод считать, что опасность прошла
    set({ status: state.danger ? 'danger' : 'error', error: e.message, checkedAt: Date.now() }, lostEvent(Date.now()));
  }
}

// один раз за перебой: «мониторинг не работает, не полагайтесь на него»
function lostEvent(now) {
  const since = state.lastGoodAt || state.startedAt || now;
  if (state.lostNotified || now - since < LOST_MS) return undefined;
  state.lostNotified = true;
  return 'lost';
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await poll();
    schedule();
  }, POLL_MS * (0.9 + Math.random() * 0.2));
}

// (пере)запуск — после смены области, страны или адреса источника
function restart() {
  clearTimeout(timer);
  Object.assign(state, { danger: false, since: 0, updated: 0, error: null, lastGoodAt: 0, lostNotified: false, startedAt: Date.now(), status: enabled() ? 'checking' : 'off' });
  emit({ ...state });
  if (!enabled()) return;
  poll().then(schedule);
}

// список для выбора — встроенный: не зависит от сети и от того, подключён ли источник
async function regions() {
  return { ok: true, regions: SUBJECTS };
}

function setup({ getConfig, onChange }) {
  cfg = getConfig;
  emit = onChange;
  restart();
}

module.exports = { setup, restart, regions, validSource, getState: () => ({ ...state }), available: () => validSource(source()) };
