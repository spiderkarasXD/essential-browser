// Иконка сайта для любого списка (вкладки, закреплённые, новая вкладка, адресная строка).
// Пробуем по очереди: иконку, которую сайт сам показывал во вкладке (её помнит браузер),
// /favicon.ico сайта и сервис иконок Google, который знает иконки почти всех сайтов.
// Если ничего не подошло — onFail рисует букву.
function faviconSources(url, known) {
  let u = null;
  try { u = new URL(url); } catch {}
  const list = [known];
  if (u && /^https?:$/.test(u.protocol)) {
    list.push(`${u.origin}/favicon.ico`, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`);
  }
  return [...new Set(list.filter(Boolean))];
}

function loadFavicon(img, url, known, onFail) {
  const list = faviconSources(url, known);
  let i = 0;
  const next = () => {
    if (i < list.length) img.src = list[i++];
    else if (onFail) onFail();
  };
  img.onerror = next;
  next();
  return img;
}
