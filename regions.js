// Общее для первого запуска и настроек: пояснение, зачем нужны страна и область, и выбор области из списка.
// Список областей приходит от источника оповещений (alerts.regions()), браузер ничего не придумывает сам.

const ALERTS_WHY = [
  ['Зачем это нужно', 'Страна и область нужны для одного: показать тревогу и подать сигнал, если в вашей области объявлена беспилотная опасность.'],
  ['Куда это уходит', 'Ответы хранятся только на вашем компьютере. Браузер скачивает общий список по всем областям и сам находит вашу — область никуда не отправляется.'],
  ['Чего это не заменяет', 'Это не официальная система оповещения: данные берутся из открытых источников и могут запаздывать. Следите за сообщениями МЧС и местных властей. Работает, пока открыт Essential.'],
];

// regionPicker(root, { regions, value, onpick }) — поле поиска и прокручиваемый список; value — id выбранной области
function regionPicker(regions, value, onpick) {
  const box = document.createElement('div');
  box.className = 'rp';
  const search = document.createElement('input');
  search.className = 'rp-search';
  search.placeholder = 'Область, край, республика или город';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const list = document.createElement('div');
  list.className = 'rp-list';
  let picked = value;

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    // ищем и по названию, и по столице: «Барнаул» находит Алтайский край
    const shown = regions.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.capital || '').toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown : [Object.assign(document.createElement('div'), { className: 'rp-empty', textContent: 'Ничего не нашлось' })]).map((r) => {
      if (!r.id) return r;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rp-item' + (r.id === picked ? ' on' : '');
      b.textContent = r.name;
      const meta = [r.kind, r.capital].filter((x) => x && !r.name.toLowerCase().includes(x)).join(' · ');
      if (meta) b.append(Object.assign(document.createElement('span'), { className: 'rp-kind', textContent: meta }));
      b.onclick = () => { picked = r.id; draw(); onpick(r); };
      return b;
    }));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  search.addEventListener('input', draw);
  box.append(search, list);
  draw();
  return box;
}
