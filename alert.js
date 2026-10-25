// Карточка тревоги: текст, мигающая рамка и короткая сирена (звук рисуем сами, без аудиофайлов)
const $ = (id) => document.getElementById(id);

const TEXTS = {
  danger: {
    title: 'Опасность в вашей области',
    text: 'Объявлена угроза БПЛА. Отойдите от окон, пройдите в помещение без окон или в укрытие, на улицу не выходите. '
      + 'Следите за сообщениями МЧС и местных властей: это сообщение браузера не заменяет официальное оповещение.',
  },
  clear: {
    title: 'Опасность снята',
    text: 'По данным источника, в вашей области опасность больше не объявлена. Дождитесь официального отбоя от МЧС или местных властей, прежде чем выходить.',
  },
  lost: {
    title: 'Мониторинг тревоги не работает',
    text: 'Уже давно нет свежих данных от источника. Сейчас на этот сигнал полагаться нельзя — следите за официальными оповещениями МЧС и местных властей.',
  },
  test: {
    title: 'Проверка сигнала',
    text: 'Так будет выглядеть и звучать тревога, если в вашей области объявят опасность. Это только проверка, ничего не случилось.',
  },
};
const SIREN_SECONDS = 12; // «мини-тревога»: недолгий сигнал, а карточка остаётся, пока её не закроют

let ctx = null;
let master = null;
let autoHide = null;

function stopSiren() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  try { master.gain.setTargetAtTime(0, c.currentTime, 0.05); } catch {}
  setTimeout(() => c.close().catch(() => {}), 300);
}

// две ноты по очереди, как сирена: 660 и 880 Гц, переключение каждые 0,55 с
function startSiren() {
  stopSiren();
  ctx = new AudioContext();
  ctx.resume().catch(() => {});
  master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.connect(master);
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i * 0.55 < SIREN_SECONDS; i++) osc.frequency.setValueAtTime(i % 2 ? 880 : 660, t0 + i * 0.55);
  osc.start(t0);
  osc.stop(t0 + SIREN_SECONDS);
  osc.onended = stopSiren;
  window.__siren = { frequencySteps: Math.ceil(SIREN_SECONDS / 0.55) };
}

function hide() {
  clearTimeout(autoHide);
  stopSiren();
  document.body.classList.remove('open');
}

alerts.onShow(({ kind, region, sound }) => {
  clearTimeout(autoHide);
  const t = TEXTS[kind] || TEXTS.danger;
  document.body.className = kind;
  $('title').textContent = t.title;
  $('region').textContent = region ? region + (kind === 'test' ? ' · проверка' : '') : '';
  $('text').textContent = t.text;
  $('mute').hidden = !(sound && (kind === 'danger' || kind === 'test'));
  requestAnimationFrame(() => document.body.classList.add('open'));
  if (sound && (kind === 'danger' || kind === 'test')) startSiren();
  else stopSiren();
  // «снято» и проверка исчезают сами; опасность и сбой мониторинга — только когда их закрыли
  if (kind === 'clear' || kind === 'test') autoHide = setTimeout(() => alerts.close(), 20000);
});
alerts.onHide(hide);

$('ok').onclick = () => alerts.close();
$('mute').onclick = () => { stopSiren(); $('mute').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') alerts.close(); });
